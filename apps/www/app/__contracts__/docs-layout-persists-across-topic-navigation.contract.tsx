/**
 * Behavior contract: sibling docs topic navigation must not remount docs chrome.
 *
 * The observed debug trace for /docs/signals -> /docs/resources shows the
 * header, search, sidebars, drawer, article, rail, and footer being rebuilt as
 * one large route tree before the route SignalElement subscribes. That is the
 * flash mechanism: a topic change is treated like replacing the whole docs
 * layout instead of preserving the layout and only changing the Outlet child.
 *
 * This contract proves the user-visible invariant with stable DOM identity:
 * while moving between sibling docs topics, the docs shell/header/sidebar must
 * remain the same mounted nodes.
 *
 * @internal
 */
import { Effect } from "effect";
import { Component } from "trygg";
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

interface LayoutObservation {
  readonly phase: string;
  readonly currentPath: string;
  readonly shellInstance: string | null;
  readonly headerInstance: string | null;
  readonly sidebarInstance: string | null;
  readonly hasSignalsPage: boolean;
  readonly hasResourcesPage: boolean;
  readonly cleanupCount: number;
  readonly text: string;
}

const scenarioName = "signals-to-resources-preserves-docs-chrome";
const remountFailureCode = "DOCS_LAYOUT_CHROME_REMOUNTED_DURING_TOPIC_NAVIGATION";
const settleFailureCode = "DOCS_LAYOUT_NAVIGATION_DID_NOT_SETTLE";

export const contract = {
  name: "docs-layout-persists-across-topic-navigation",
  suspectedFiles: [
    "packages/core/src/primitives/render-signal-element.ts",
    "packages/core/src/primitives/render-fragment.ts",
    "packages/core/src/primitives/render-component.ts",
    "packages/core/src/router/outlet.ts",
    "packages/core/src/router/outlet-services.ts",
  ],
  laws: [
    {
      id: "docs-layout-chrome-persists-across-sibling-routes",
      failureCode: remountFailureCode,
      description:
        "Sibling docs topic navigation must preserve the mounted docs shell/chrome and update only the route-owned Outlet child.",
      failureHints: [
        "A route SignalElement update is replacing the whole layout element instead of reconciling the existing layout component.",
        "Fragment/component reconciliation should preserve stable siblings such as header/sidebar while the Outlet child changes.",
        "The route layout finalizer must not run for /docs/signals -> /docs/resources.",
      ],
    },
  ],
  scenarios: [
    {
      name: scenarioName,
      fixedTrace: [
        { kind: "render", path: "/docs/signals" },
        { kind: "click", target: "sidebar:/docs/resources" },
        { kind: "observe", phase: "resources-settled" },
      ],
    },
  ],
} as const;

let nextInstanceId = 0;
let layoutCleanupCount = 0;
let observedContainer: HTMLElement | null = null;

const flushDom = (ms: number): Effect.Effect<void> =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)));

const currentPathSnapshot = Effect.gen(function* () {
  const route = yield* Router.currentRoute;
  return route.path;
});

const observeLayout = (phase: string, container: HTMLElement) =>
  Effect.gen(function* () {
    const currentPath = yield* currentPathSnapshot;
    return {
      phase,
      currentPath,
      shellInstance:
        container.querySelector("[data-testid='docs-shell']")?.getAttribute("data-instance") ??
        null,
      headerInstance:
        container.querySelector("[data-testid='docs-header']")?.getAttribute("data-instance") ??
        null,
      sidebarInstance:
        container.querySelector("[data-testid='docs-sidebar']")?.getAttribute("data-instance") ??
        null,
      hasSignalsPage: container.querySelector("[data-testid='signals-page']") !== null,
      hasResourcesPage: container.querySelector("[data-testid='resources-page']") !== null,
      cleanupCount: layoutCleanupCount,
      text: container.textContent?.replace(/\s+/g, " ").trim() ?? "",
    } satisfies LayoutObservation;
  });

const emitObservation = (observation: LayoutObservation) =>
  ContractTrace.emit({
    event: "contract.observation",
    level: "diagnostic",
    payload: { ...observation },
  });

const stringifyObservation = (observation: LayoutObservation): string =>
  JSON.stringify(observation);

const DocsLikeLayout = Component.gen(function* () {
  const instance = `layout-${++nextInstanceId}`;

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      layoutCleanupCount++;
      if (observedContainer !== null) {
        const observation = yield* observeLayout("layout-cleanup", observedContainer);
        yield* emitObservation(observation);
      }
    }).pipe(Effect.ignore),
  );

  return (
    <>
      <header data-testid="docs-header" data-instance={instance}>
        trygg docs
      </header>
      <section data-testid="docs-shell" data-instance={instance}>
        <aside data-testid="docs-sidebar" data-instance={instance}>
          <Router.Link to="/docs/signals">Signals</Router.Link>
          <Router.Link to="/docs/resources">Resources</Router.Link>
        </aside>
        <main id="main-content">
          <Router.Outlet />
        </main>
        <aside data-testid="docs-rail" data-instance={instance}>
          On this page
        </aside>
      </section>
      <footer data-testid="docs-footer" data-instance={instance}>
        Made with trygg
      </footer>
    </>
  );
});

const SignalsPage = Component.gen(function* () {
  return (
    <article data-testid="signals-page">
      <h1>Signals</h1>
      <p>Fine-grained reactive state.</p>
    </article>
  );
});

const ResourcesPage = Component.gen(function* () {
  // Simulate the expensive docs markdown/code render in the supplied trace.
  yield* flushDom(50);
  return (
    <article data-testid="resources-page">
      <h1>Resources</h1>
      <p>Async data fetching with cache keys and refresh semantics.</p>
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
    nextInstanceId = 0;
    layoutCleanupCount = 0;
    observedContainer = null;

    const result = yield* ContractTrace.withAction(
      "a1",
      { kind: "render", path: "/docs/signals" },
      render(Router.Outlet({ routes })),
    );
    observedContainer = result.container;

    yield* waitFor(
      () => {
        const shell = result.container.querySelector("[data-testid='docs-shell']");
        const page = result.container.querySelector("[data-testid='signals-page']");
        if (shell === null || page === null) throw new Error("Signals docs route is not ready");
        return true;
      },
      { timeout: 5000, interval: 50 },
    );

    const initialHeader = result.container.querySelector("[data-testid='docs-header']");
    const initialSidebar = result.container.querySelector("[data-testid='docs-sidebar']");
    const initialShell = result.container.querySelector("[data-testid='docs-shell']");
    const initialObservation = yield* observeLayout("initial", result.container);
    yield* emitObservation(initialObservation);

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
        const page = result.container.querySelector("[data-testid='resources-page']");
        if (page === null) throw new Error("Resources docs route did not settle");
        return true;
      },
      { timeout: 5000, interval: 50 },
    );

    yield* flushDom(25);

    const finalHeader = result.container.querySelector("[data-testid='docs-header']");
    const finalSidebar = result.container.querySelector("[data-testid='docs-sidebar']");
    const finalShell = result.container.querySelector("[data-testid='docs-shell']");
    const finalObservation = yield* observeLayout("final", result.container);
    yield* emitObservation(finalObservation);

    if (finalObservation.currentPath !== "/docs/resources" || !finalObservation.hasResourcesPage) {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "navigation settles to /docs/resources",
          actual: stringifyObservation(finalObservation),
        },
      });
      return [
        violation(
          settleFailureCode,
          "docs-layout-chrome-persists-across-sibling-routes",
          "Docs topic navigation did not settle to Resources",
          "router.current.path=/docs/resources and resources page visible",
          stringifyObservation(finalObservation),
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    const preserved =
      initialShell !== null &&
      initialHeader !== null &&
      initialSidebar !== null &&
      finalShell === initialShell &&
      finalHeader === initialHeader &&
      finalSidebar === initialSidebar &&
      layoutCleanupCount === 0;

    if (!preserved) {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected:
            "same docs shell/header/sidebar DOM nodes with zero layout cleanup during sibling navigation",
          actual: stringifyObservation(finalObservation),
        },
      });
      return [
        violation(
          remountFailureCode,
          "docs-layout-chrome-persists-across-sibling-routes",
          "Docs chrome was remounted while navigating between sibling docs topics",
          "same shell/header/sidebar node identity and layoutCleanupCount=0",
          stringifyObservation(finalObservation),
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    return [] satisfies ReadonlyArray<ContractViolation>;
  }).pipe(Effect.provide(Router.testLayer("/docs/signals"))),
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
              "Inspect whether the route SignalElement reconciles the existing layout component before rendering a replacement tree.",
              "Preserve fragment/intrinsic children so the docs chrome stays mounted while only the Outlet child changes.",
            ],
    },
    trace,
  };
};
