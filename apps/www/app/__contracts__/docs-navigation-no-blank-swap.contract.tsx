/**
 * Behavior contract: docs navigation swaps must be visually atomic.
 *
 * The screenshots show one navigation producing complete docs content, then a
 * black/empty frame, then the completed docs shell. This contract proves the
 * framework-level invariant directly: during a route SignalElement swap, cleanup
 * of the previous docs layout must not run while the visible container has no
 * complete docs shell for the latest route.
 *
 * @internal
 */
import { Effect, Layer, SubscriptionRef } from "effect";
import * as Context from "effect/Context";
import { Component, Signal } from "trygg";
import { click, render, waitFor } from "trygg/testing";
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

interface SwapSnapshot {
  readonly phase: string;
  readonly currentPath: string;
  readonly shellPaths: ReadonlyArray<string>;
  readonly hasSignalsArticle: boolean;
  readonly hasResourcesArticle: boolean;
  readonly hasHeader: boolean;
  readonly hasSidebar: boolean;
  readonly hasRail: boolean;
  readonly text: string;
  readonly html: string;
}

const scenarioName = "signals-to-resources-sidebar-click";
const blankFrameFailureCode = "DOCS_NAVIGATION_BLANK_FRAME_DURING_SWAP";
const settleFailureCode = "DOCS_NAVIGATION_DID_NOT_SETTLE_TO_LATEST_ROUTE";

export const contract = {
  name: "docs-navigation-no-blank-swap",
  suspectedFiles: [
    "packages/core/src/primitives/render-signal-element.ts",
    "packages/core/src/primitives/render-component.ts",
    "packages/core/src/router/outlet.ts",
    "packages/core/src/router/outlet-services.ts",
    "apps/www/app/components/docs-layout.tsx",
  ],
  laws: [
    {
      id: "docs-route-swap-is-atomic",
      failureCode: blankFrameFailureCode,
      description:
        "A docs route swap must keep either the previous complete docs shell or the latest complete docs shell visible while old route cleanup runs.",
      failureHints: [
        "SignalElement currently cleans the old rendered tree before inserting the fully rendered replacement fragment.",
        "If old cleanup is expensive, the browser can paint an empty or partially cleaned docs frame.",
        "Commit the new fragment before running old cleanup, then dispose the old tree.",
      ],
    },
  ],
  scenarios: [
    {
      name: scenarioName,
      fixedTrace: [
        { kind: "render", path: "/docs/signals" },
        { kind: "click", target: "sidebar:/docs/resources" },
        { kind: "observe", phase: "old-layout-cleanup" },
        { kind: "observe", phase: "navigation-settled" },
      ],
    },
  ],
} as const;

interface ContractStateService {
  readonly headings: Signal.Signal<ReadonlyArray<string>>;
}

class ContractState extends Context.Service<ContractState, ContractStateService>()(
  "www/DocsNavigationNoBlankSwapState",
) {}

const ContractStateLive = Layer.effect(
  ContractState,
  Signal.make<ReadonlyArray<string>>([]).pipe(
    Effect.orDie,
    Effect.map((headings): ContractStateService => ({ headings })),
  ),
);

const cleanupSnapshots: Array<SwapSnapshot> = [];
let observedContainer: HTMLElement | null = null;

const flushDom = (ms: number): Effect.Effect<void> =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)));

const currentPathSnapshot = Effect.gen(function* () {
  const router = yield* Router.get;
  const route = yield* SubscriptionRef.get(router.current._ref);
  return route.path;
});

const snapshotVisibleDocs = (phase: string, currentPath: string): SwapSnapshot => {
  const container = observedContainer;
  const html = container?.innerHTML ?? "";
  const shellPaths = Array.from(
    container?.querySelectorAll("[data-testid='docs-shell']") ?? [],
  ).map((node) => node.getAttribute("data-path") ?? "<missing>");

  return {
    phase,
    currentPath,
    shellPaths,
    hasSignalsArticle: container?.querySelector("[data-testid='signals-article']") !== null,
    hasResourcesArticle: container?.querySelector("[data-testid='resources-article']") !== null,
    hasHeader: container?.querySelector("[data-testid='docs-header']") !== null,
    hasSidebar: container?.querySelector("[data-testid='docs-sidebar']") !== null,
    hasRail: container?.querySelector("[data-testid='docs-rail']") !== null,
    text: container?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    html,
  };
};

const isLatestShellVisible = (snapshot: SwapSnapshot): boolean =>
  snapshot.currentPath === "/docs/resources" &&
  snapshot.shellPaths.includes("/docs/resources") &&
  snapshot.hasResourcesArticle &&
  snapshot.hasHeader &&
  snapshot.hasSidebar &&
  snapshot.hasRail;

const stringifySnapshot = (snapshot: SwapSnapshot): string =>
  JSON.stringify({
    phase: snapshot.phase,
    currentPath: snapshot.currentPath,
    shellPaths: snapshot.shellPaths,
    hasSignalsArticle: snapshot.hasSignalsArticle,
    hasResourcesArticle: snapshot.hasResourcesArticle,
    hasHeader: snapshot.hasHeader,
    hasSidebar: snapshot.hasSidebar,
    hasRail: snapshot.hasRail,
    text: snapshot.text,
  });

const recordCleanupSnapshot = (phase: string) =>
  Effect.gen(function* () {
    const currentPath = yield* currentPathSnapshot;
    const snapshot = snapshotVisibleDocs(phase, currentPath);
    cleanupSnapshots.push(snapshot);
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: { ...snapshot, html: snapshot.html.slice(0, 2000) },
    });
  });

const DocsLikeLayout = Component.gen(function* () {
  const route = yield* Router.currentRoute;
  const { headings } = yield* ContractState;

  if (route.path === "/docs/signals") {
    yield* Effect.addFinalizer(() => recordCleanupSnapshot("old-signals-layout-cleanup"));
  }

  return (
    <>
      <header data-testid="docs-header">trygg docs</header>
      <section data-testid="docs-shell" data-path={route.path}>
        <aside data-testid="docs-sidebar">
          <nav aria-label="Docs navigation">
            <Router.Link
              to="/docs/signals"
              className={route.path === "/docs/signals" ? "active" : ""}
            >
              Signals
            </Router.Link>
            <Router.Link
              to="/docs/resources"
              className={route.path === "/docs/resources" ? "active" : ""}
            >
              Resources
            </Router.Link>
          </nav>
        </aside>
        <main id="main-content">
          <Router.Outlet />
        </main>
        <aside data-testid="docs-rail" aria-label="On this page">
          {Signal.each(
            headings,
            (heading) => Effect.succeed(<a href={`#${heading}`}>{heading}</a>),
            { key: (heading) => heading },
          )}
        </aside>
      </section>
    </>
  );
});

const SignalsPage = Component.gen(function* () {
  const { headings } = yield* ContractState;
  yield* Signal.set(headings, ["When to use", "Behavior", "Related exports"]);
  return (
    <article data-testid="signals-article">
      <h1>Signal</h1>
      <p>Fine-grained reactive state that updates DOM nodes directly.</p>
    </article>
  );
});

const ResourcesPage = Component.gen(function* () {
  const { headings } = yield* ContractState;
  yield* Signal.set(headings, ["When to use", "Behavior", "Related exports"]);
  // Keep the replacement render in flight long enough to mirror the real docs
  // page, where markdown/code rendering is expensive. The invariant is about
  // the later commit point: no blank/partial frame while old cleanup runs.
  yield* flushDom(50);
  return (
    <article data-testid="resources-article">
      <h1>Resource</h1>
      <p>Async data fetching with cache keys, invalidation, and refresh semantics.</p>
    </article>
  );
});

const routes = Router.Routes.make().add(
  Router.Route.make("/docs")
    .layout(DocsLikeLayout)
    .children(
      Router.Route.make("/signals").component(SignalsPage),
      Router.Route.make("/resources").component(ResourcesPage),
    ),
).manifest;

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

const runScenario = Effect.scoped(
  Effect.gen(function* () {
    cleanupSnapshots.length = 0;
    observedContainer = null;
    const { headings } = yield* ContractState;
    yield* Signal.set(headings, []);

    const result = yield* ContractTrace.withAction(
      "a1",
      { kind: "render", path: "/docs/signals" },
      render(Router.Outlet({ routes })),
    );
    observedContainer = result.container;

    yield* waitFor(
      () => {
        const shell = result.container.querySelector(
          "[data-testid='docs-shell'][data-path='/docs/signals']",
        );
        const article = result.container.querySelector("[data-testid='signals-article']");
        if (shell === null || article === null) {
          throw new Error("Signals docs route is not ready");
        }
        return true;
      },
      { timeout: 5000, interval: 50 },
    );

    const initialPath = yield* currentPathSnapshot;
    const initialSnapshot = snapshotVisibleDocs("initial", initialPath);
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: { ...initialSnapshot, html: initialSnapshot.html.slice(0, 2000) },
    });

    const resourcesLink = yield* waitFor(
      () => {
        const link = result.container.querySelector<HTMLAnchorElement>('a[href="/docs/resources"]');
        if (link === null) throw new Error("Resources link is not ready");
        return link;
      },
      { timeout: 5000, interval: 50 },
    );

    yield* ContractTrace.withAction(
      "a2",
      { kind: "click", target: "sidebar:/docs/resources", href: "/docs/resources" },
      click(resourcesLink),
    );

    yield* waitFor(
      () => {
        const shell = result.container.querySelector(
          "[data-testid='docs-shell'][data-path='/docs/resources']",
        );
        const article = result.container.querySelector("[data-testid='resources-article']");
        if (shell === null || article === null) {
          throw new Error("Resources docs route did not settle");
        }
        return true;
      },
      { timeout: 5000, interval: 50 },
    );

    yield* flushDom(25);

    const finalPath = yield* currentPathSnapshot;
    const finalSnapshot = snapshotVisibleDocs("final", finalPath);
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: { ...finalSnapshot, html: finalSnapshot.html.slice(0, 2000) },
    });

    if (!isLatestShellVisible(finalSnapshot)) {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "latest /docs/resources docs shell visible after navigation",
          actual: stringifySnapshot(finalSnapshot),
        },
      });
      return [
        violation(
          settleFailureCode,
          "docs-route-swap-is-atomic",
          "Docs navigation did not settle to the latest route",
          "complete /docs/resources docs shell visible",
          stringifySnapshot(finalSnapshot),
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    const blankSnapshot = cleanupSnapshots.find((snapshot) => !isLatestShellVisible(snapshot));
    if (blankSnapshot !== undefined) {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected:
            "latest /docs/resources docs shell already visible while old route cleanup runs",
          actual: stringifySnapshot(blankSnapshot),
        },
      });
      return [
        violation(
          blankFrameFailureCode,
          "docs-route-swap-is-atomic",
          "Old docs route cleanup ran while the visible container lacked a complete latest docs shell",
          "complete /docs/resources docs shell visible during old route cleanup",
          stringifySnapshot(blankSnapshot),
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    return [] satisfies ReadonlyArray<ContractViolation>;
  }).pipe(Effect.provide(Layer.merge(Router.testLayer("/docs/signals"), ContractStateLive))),
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
              "Inspect the old-layout-cleanup observation for missing docs shell/header/sidebar/rail.",
              "Make SignalElement swaps commit the fully rendered replacement before disposing the previous rendered tree.",
            ],
    },
    trace,
  };
};
