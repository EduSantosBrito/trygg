/**
 * Behavior contract: a docs hard refresh must commit stable docs chrome while
 * the lazy leaf route module is still loading.
 *
 * This models the actual Vite-transformed docs route shape in apps/www:
 * `/docs` has an eager layout, while `/docs/:slug+` is a lazy component loader.
 * The user-visible law is that the parent docs shell is not allowed to remain
 * blank just because the leaf article module has not resolved yet.
 *
 * @internal
 */
import { Deferred, Effect, Fiber, Layer } from "effect";
import { Component, Renderer, browserLayer } from "trygg";
import * as Router from "trygg/router";

import * as ContractTrace from "../../../../packages/core/src/contract/trace.js";

interface ContractViolation {
  readonly code: string;
  readonly law: string;
  readonly message: string;
  readonly firstDivergenceSeq: number;
  readonly expected: string;
  readonly actual: string;
}

interface ContractRunOptions {
  readonly runId: string;
  readonly scenario?: string;
}

interface ContractRunResult {
  readonly status: "passed" | "failed";
  readonly contract: string;
  readonly scenario: string;
  readonly failureCode?: string;
  readonly summary: Record<string, unknown>;
  readonly trace: ReadonlyArray<Record<string, unknown>>;
}

interface LazyRouteObservation {
  readonly phase: string;
  readonly hasHeader: boolean;
  readonly hasShell: boolean;
  readonly hasSidebar: boolean;
  readonly hasMain: boolean;
  readonly hasResourcesArticle: boolean;
  readonly text: string;
  readonly html: string;
}

const scenarioName = "resources-refresh-lazy-route-module";
const lazyModuleFailureCode = "DOCS_REFRESH_SHELL_NOT_VISIBLE_DURING_LAZY_ROUTE_LOAD";
const settleFailureCode = "DOCS_REFRESH_LAZY_ROUTE_DID_NOT_SETTLE";

export const contract = {
  name: "docs-lazy-route-commits-shell",
  suspectedFiles: [
    "packages/core/src/router/outlet.ts",
    "packages/core/src/router/outlet-services.ts",
    "packages/core/src/primitives/render-component.ts",
    "packages/core/src/primitives/render-fragment.ts",
    "packages/core/src/primitives/render-intrinsic.ts",
  ],
  laws: [
    {
      id: "docs-refresh-commits-shell-before-lazy-leaf-module",
      failureCode: lazyModuleFailureCode,
      description:
        "A hard refresh of a docs topic must show the parent docs shell/chrome while the lazy leaf route module is still loading.",
      failureHints: [
        "The Outlet currently awaits the lazy leaf route component before publishing the parent layout element.",
        "Create a route child placeholder/signal for lazy leaf modules so eager parent layouts can mount immediately.",
        "The eventual lazy child must settle inside the existing layout without remounting docs chrome.",
      ],
    },
  ],
  scenarios: [
    {
      name: scenarioName,
      fixedTrace: [
        { kind: "render", path: "/docs/resources" },
        { kind: "observe", phase: "lazy-module-pending" },
        { kind: "release", target: "resources-module" },
        { kind: "observe", phase: "final" },
      ],
    },
  ],
} as const;

const flushDom = (ms: number): Effect.Effect<void> =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)));

const observe = (phase: string, container: HTMLElement): LazyRouteObservation => ({
  phase,
  hasHeader: container.querySelector("[data-testid='docs-header']") !== null,
  hasShell: container.querySelector("[data-testid='docs-shell']") !== null,
  hasSidebar: container.querySelector("[data-testid='docs-sidebar']") !== null,
  hasMain: container.querySelector("#main-content") !== null,
  hasResourcesArticle: container.querySelector("[data-testid='resources-article']") !== null,
  text: container.textContent?.replace(/\s+/g, " ").trim() ?? "",
  html: container.innerHTML,
});

const emitObservation = (observation: LazyRouteObservation) =>
  ContractTrace.emit({
    event: "contract.observation",
    level: "diagnostic",
    payload: { ...observation, html: observation.html.slice(0, 2000) },
  });

const hasVisibleShell = (observation: LazyRouteObservation): boolean =>
  observation.hasHeader && observation.hasShell && observation.hasSidebar && observation.hasMain;

const stringifyObservation = (observation: LazyRouteObservation): string =>
  JSON.stringify({
    phase: observation.phase,
    hasHeader: observation.hasHeader,
    hasShell: observation.hasShell,
    hasSidebar: observation.hasSidebar,
    hasMain: observation.hasMain,
    hasResourcesArticle: observation.hasResourcesArticle,
    text: observation.text,
  });

const violation = (
  code: string,
  law: string,
  message: string,
  expected: string,
  actual: string,
): ContractViolation => ({
  code,
  law,
  message,
  firstDivergenceSeq: 0,
  expected,
  actual,
});

const testLayerAt = (path: string) => Layer.merge(browserLayer, Router.testLayer(path));

const runScenario = Effect.scoped(
  Effect.gen(function* () {
    const moduleRequested = yield* Deferred.make<void>();
    const releaseModule = yield* Deferred.make<void>();

    const DocsLikeLayout = Component.gen(function* () {
      return (
        <>
          <header data-testid="docs-header">trygg docs</header>
          <section data-testid="docs-shell">
            <aside data-testid="docs-sidebar">Docs sidebar</aside>
            <main id="main-content">
              <Router.Outlet />
            </main>
          </section>
        </>
      );
    });

    const ResourcesPage = Component.gen(function* () {
      return (
        <article data-testid="resources-article">
          <h1>Resources</h1>
          <p>Async data fetching with cache keys and refresh semantics.</p>
        </article>
      );
    });

    const context = yield* Effect.context<never>();
    const LazyResourcesPage = () =>
      Effect.runPromiseWith(context)(
        Effect.gen(function* () {
          yield* Deferred.succeed(moduleRequested, void 0);
          yield* Deferred.await(releaseModule);
          return { default: ResourcesPage };
        }),
      );

    const routes = Router.Routes.make().add(
      Router.Route.make("/docs")
        .layout(DocsLikeLayout)
        .children(Router.Route.make("/resources").component(LazyResourcesPage)),
    ).manifest;

    const container = document.createElement("div");
    container.setAttribute("data-testid", "contract-container");
    document.body.appendChild(container);
    yield* Effect.addFinalizer(() => Effect.sync(() => container.remove()));

    const renderer = yield* Renderer;
    const mountFiber = yield* ContractTrace.withAction(
      "a1",
      { kind: "render", path: "/docs/resources" },
      Effect.forkScoped(renderer.mount(container, <Router.Outlet routes={routes} />)),
    );

    yield* Deferred.await(moduleRequested);
    yield* flushDom(25);

    const pendingObservation = observe("lazy-module-pending", container);
    yield* emitObservation(pendingObservation);

    if (!hasVisibleShell(pendingObservation) || pendingObservation.hasResourcesArticle) {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "docs shell/header/sidebar/main visible before lazy resources module resolves",
          actual: stringifyObservation(pendingObservation),
        },
      });

      yield* Deferred.succeed(releaseModule, void 0);
      yield* Fiber.join(mountFiber).pipe(Effect.catchCause(() => Effect.void));

      return [
        violation(
          lazyModuleFailureCode,
          "docs-refresh-commits-shell-before-lazy-leaf-module",
          "Docs refresh stayed blank while the lazy leaf route module was pending",
          "visible docs shell without resources article while lazy route module is pending",
          stringifyObservation(pendingObservation),
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    yield* ContractTrace.withAction(
      "a2",
      { kind: "release", target: "resources-module" },
      Deferred.succeed(releaseModule, void 0),
    );
    yield* Fiber.join(mountFiber);
    yield* flushDom(25);

    const finalObservation = observe("final", container);
    yield* emitObservation(finalObservation);

    if (!hasVisibleShell(finalObservation) || !finalObservation.hasResourcesArticle) {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "docs shell and resources article visible after lazy module resolves",
          actual: stringifyObservation(finalObservation),
        },
      });
      return [
        violation(
          settleFailureCode,
          "docs-refresh-commits-shell-before-lazy-leaf-module",
          "Docs refresh did not settle after the lazy leaf route module resolved",
          "visible docs shell and resources article",
          stringifyObservation(finalObservation),
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    return [] satisfies ReadonlyArray<ContractViolation>;
  }).pipe(Effect.provide(testLayerAt("/docs/resources"))),
);

const normalizeViolations = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
  violations: ReadonlyArray<ContractViolation>,
): ReadonlyArray<ContractViolation> => {
  const firstDivergenceSeq =
    records.find((record) => record.event.event === "contract.firstDivergence")?.seq ?? 0;

  return violations.map((item) => ({
    ...item,
    firstDivergenceSeq:
      item.firstDivergenceSeq === 0 ? firstDivergenceSeq : item.firstDivergenceSeq,
  }));
};

const toTraceLines = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
  violations: ReadonlyArray<ContractViolation>,
): ReadonlyArray<Record<string, unknown>> => [
  ...records.map((record): Record<string, unknown> => {
    const event = record.event.event;
    const payload = record.event.payload ?? {};
    if (event === "contract.action.start") {
      return {
        schemaVersion: 1,
        lineType: "action",
        seq: record.seq,
        actionId: record.actionId,
        action: payload,
      };
    }
    if (event === "contract.observation") {
      return {
        schemaVersion: 1,
        lineType: "observation",
        seq: record.seq,
        actionId: record.actionId,
        observation: payload,
      };
    }
    return {
      schemaVersion: 1,
      lineType: "effect",
      seq: record.seq,
      actionId: record.actionId,
      event,
      level: record.event.level ?? "semantic",
      payload,
    };
  }),
  ...violations.map(
    (item, index): Record<string, unknown> => ({
      schemaVersion: 1,
      lineType: "violation",
      seq: records.length + index + 1,
      failureCode: item.code,
      law: item.law,
      message: item.message,
      firstDivergenceSeq: item.firstDivergenceSeq,
      expected: item.expected,
      actual: item.actual,
    }),
  ),
];

export const runContract = async (options: ContractRunOptions): Promise<ContractRunResult> => {
  const collector = await Effect.runPromise(ContractTrace.createInMemoryCollector(options.runId));
  const rawViolations = await Effect.runPromise(
    ContractTrace.withCollector(runScenario, collector),
  );
  const records = await Effect.runPromise(collector.snapshot);
  const violations = normalizeViolations(records, rawViolations);
  const trace = toTraceLines(records, violations);
  const firstViolation = violations[0];
  const status = firstViolation === undefined ? "passed" : "failed";

  return {
    status,
    contract: contract.name,
    scenario: scenarioName,
    ...(firstViolation === undefined ? {} : { failureCode: firstViolation.code }),
    summary: {
      schemaVersion: 1,
      tool: "assert-ui",
      status,
      contract: contract.name,
      scenario: scenarioName,
      suspectedFiles: contract.suspectedFiles,
      laws: contract.laws,
      ...(firstViolation === undefined
        ? {}
        : {
            failure: {
              code: firstViolation.code,
              law: firstViolation.law,
              message: firstViolation.message,
              firstDivergenceSeq: firstViolation.firstDivergenceSeq,
              expected: firstViolation.expected,
              actual: firstViolation.actual,
            },
          }),
      nextActions:
        firstViolation === undefined
          ? []
          : [
              "Replay the trace.",
              "Inspect lazy route component resolution in Outlet buildRouteElement.",
              "Publish eager parent layouts with a lazy child placeholder before awaiting the leaf module.",
            ],
    },
    trace,
  };
};
