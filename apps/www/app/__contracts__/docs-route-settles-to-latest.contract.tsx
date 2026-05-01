/**
 * Behavior contract: stale docs route work must not run after latest navigation.
 *
 * The debug log shows `/docs/getting-started` route work continuing after the
 * router has already moved to `/docs/components`. This contract builds a small
 * docs-shaped route tree with a layout that reads the current route, then checks
 * that an old child route is not re-rendered while `router.current` points at the
 * new route.
 *
 * @internal
 */
import { Effect, SubscriptionRef } from "effect";
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

const scenarioName = "getting-started-to-components-sidebar-click";
const staleRouteFailureCode = "DOCS_STALE_ROUTE_RENDER_AFTER_LATEST_NAVIGATION";
const staleRailFailureCode = "DOCS_STALE_RAIL_HEADINGS_AFTER_LATEST_NAVIGATION";
const navigationFailureCode = "DOCS_LATEST_NAVIGATION_DID_NOT_SETTLE";

export const contract = {
  name: "docs-route-settles-to-latest",
  suspectedFiles: [
    "apps/www/app/components/docs-layout.tsx",
    "apps/www/app/pages/docs/getting-started.tsx",
    "apps/www/app/pages/docs/topic.tsx",
    "apps/www/app/content/headings.ts",
    "packages/core/src/primitives/render-component.ts",
    "packages/core/src/primitives/render-signal-element.ts",
    "packages/core/src/router/outlet.ts",
    "packages/core/src/router/outlet-services.ts",
  ],
  laws: [
    {
      id: "latest-docs-route-owns-route-effects",
      failureCode: staleRouteFailureCode,
      description:
        "Once router.current moves to /docs/components, old /docs/getting-started route render work must not run or mutate route-owned docs chrome.",
      failureHints: [
        "A layout that subscribes to router.current can re-render with its previous Outlet child.",
        "That stale child can run route render effects after a newer navigation has won.",
        "Guard route-child execution against stale outlet epochs, or prevent route-subscribing chrome from re-running the previous outlet child.",
      ],
    },
  ],
  scenarios: [
    {
      name: scenarioName,
      fixedTrace: [
        { kind: "render", path: "/docs/getting-started" },
        { kind: "click", target: "sidebar:/docs/components" },
        { kind: "observe", after: "navigation-settled" },
      ],
    },
  ],
} as const;

const headings = Signal.makeSync<ReadonlyArray<string>>([]);
const rerenderTick = Signal.makeSync(0);
const staleRouteRenders: Array<string> = [];
const routeRenderLog: Array<string> = [];

const flushDom = (ms: number): Effect.Effect<void> =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)));

const waitForRoutePath = (expectedPath: string) =>
  Effect.gen(function* () {
    for (let elapsed = 0; elapsed < 5000; elapsed += 10) {
      const currentPath = yield* currentPathSnapshot;
      if (currentPath === expectedPath) return true;
      yield* flushDom(10);
    }
    return false;
  });

const currentPathSnapshot = Effect.gen(function* () {
  const router = yield* Router.get;
  const route = yield* SubscriptionRef.get(router.current._ref);
  return route.path;
});

const recordRouteRender = (routeName: "getting-started" | "components", expectedPath: string) =>
  Effect.gen(function* () {
    const currentPath = yield* currentPathSnapshot;
    const line = `${routeName} rendered while router.current=${currentPath}`;
    routeRenderLog.push(line);
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: { phase: "route-render", routeName, expectedPath, currentPath },
    });
    if (currentPath !== expectedPath) {
      staleRouteRenders.push(line);
    }
  });

const DocsLikeLayout = Component.gen(function* () {
  // This mirrors docs chrome that reads current route for active links. The bug
  // appears when this old layout re-renders with its previous Outlet child after
  // router.current has already moved to the next route.
  const route = yield* Router.currentRoute;

  return (
    <section data-testid="docs-layout" data-path={route.path}>
      <aside className="docs-layout__sidebar">
        <nav aria-label="Docs navigation">
          <Router.Link
            to="/docs/getting-started"
            className={
              route.path === "/docs/getting-started"
                ? "docs-sidebar__link docs-sidebar__link--active"
                : "docs-sidebar__link"
            }
          >
            Getting started
          </Router.Link>
          <Router.Link
            to="/docs/components"
            className={
              route.path === "/docs/components"
                ? "docs-sidebar__link docs-sidebar__link--active"
                : "docs-sidebar__link"
            }
          >
            Components
          </Router.Link>
        </nav>
      </aside>
      <main id="main-content">
        <Router.Outlet />
      </main>
      <aside className="docs-rail" aria-label="On this page">
        <ul>
          {Signal.each(headings, (heading) => Effect.succeed(<li>{heading}</li>), {
            key: (heading) => heading,
          })}
        </ul>
      </aside>
    </section>
  );
});

const GettingStartedPage = Component.gen(function* () {
  // Subscribes the old route to a local route-state change. The contract then
  // bumps this while the next route is rendering, reproducing the debug trace's
  // stale getting-started work after router.current has moved on.
  yield* Signal.get(rerenderTick);
  yield* recordRouteRender("getting-started", "/docs/getting-started");
  yield* Signal.set(headings, ["Prerequisites", "Create a project", "Install"]);

  return (
    <article data-testid="getting-started-page">
      <h1>Getting started</h1>
    </article>
  );
});

const ComponentsPage = Component.gen(function* () {
  yield* recordRouteRender("components", "/docs/components");
  // The real docs topic route updates docsHeadings before async article work
  // such as syntax highlighting completes. Keep the new route render in flight
  // after publishing the new headings so stale old-route work can overwrite it.
  yield* Signal.set(headings, ["When to use", "Behavior", "Related exports"]);
  yield* flushDom(200);

  return (
    <article data-testid="components-page">
      <h1>Component</h1>
    </article>
  );
});

const routes = Router.Routes.make().add(
  Router.Route.make("/docs")
    .layout(DocsLikeLayout)
    .children(
      Router.Route.make("/getting-started").component(GettingStartedPage),
      Router.Route.make("/components").component(ComponentsPage),
    ),
).manifest;

const observeDocs = (container: HTMLElement, currentPath: string): Record<string, unknown> => ({
  currentPath,
  layoutPath: container.querySelector("[data-testid='docs-layout']")?.getAttribute("data-path"),
  activeSidebarHref: container
    .querySelector(".docs-layout__sidebar .docs-sidebar__link--active")
    ?.getAttribute("href"),
  hasGettingStartedPage: container.querySelector("[data-testid='getting-started-page']") !== null,
  hasComponentsPage: container.querySelector("[data-testid='components-page']") !== null,
  railText: container.querySelector(".docs-rail")?.textContent?.trim() ?? "",
  routeRenderLog: [...routeRenderLog],
  staleRouteRenders: [...staleRouteRenders],
  html: container.innerHTML,
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

const stringifyObservation = (observation: Record<string, unknown>): string =>
  JSON.stringify({
    currentPath: observation.currentPath,
    layoutPath: observation.layoutPath,
    activeSidebarHref: observation.activeSidebarHref,
    hasGettingStartedPage: observation.hasGettingStartedPage,
    hasComponentsPage: observation.hasComponentsPage,
    railText: observation.railText,
    routeRenderLog: observation.routeRenderLog,
    staleRouteRenders: observation.staleRouteRenders,
  });

const runScenario = Effect.scoped(
  Effect.gen(function* () {
    staleRouteRenders.length = 0;
    routeRenderLog.length = 0;
    yield* Signal.set(headings, []);
    yield* Signal.set(rerenderTick, 0);

    const result = yield* ContractTrace.withAction(
      "a1",
      { kind: "render", path: "/docs/getting-started" },
      render(Router.Outlet({ routes })),
    );

    yield* waitFor(
      () => {
        const page = result.container.querySelector("[data-testid='getting-started-page']");
        if (page === null) throw new Error("Getting started page is not ready");
        return true;
      },
      { timeout: 5000, interval: 50 },
    );

    const initialCurrent = yield* Router.currentRoute;
    const initial = observeDocs(result.container, initialCurrent.path);
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: { phase: "initial", ...initial },
    });

    const componentsLink = yield* waitFor(
      () => {
        const link = result.container.querySelector<HTMLAnchorElement>(
          '.docs-layout__sidebar a[href="/docs/components"]',
        );
        if (link === null) throw new Error("Components sidebar link is not ready");
        return link;
      },
      { timeout: 5000, interval: 50 },
    );

    yield* ContractTrace.withAction(
      "a2",
      { kind: "click", target: "sidebar:/docs/components", href: "/docs/components" },
      click(componentsLink),
    );

    const routeChanged = yield* waitForRoutePath("/docs/components");
    if (routeChanged) {
      yield* flushDom(25);
      yield* ContractTrace.withAction(
        "a3",
        { kind: "signal", target: "old-route-local-state", value: "tick" },
        Signal.update(rerenderTick, (n) => n + 1),
      );
    }

    for (let i = 0; i < 20; i++) {
      yield* flushDom(25);
      const current = yield* Router.currentRoute;
      const observation = observeDocs(result.container, current.path);
      yield* ContractTrace.emit({
        event: "contract.observation",
        level: "diagnostic",
        payload: { phase: "sample", sampleIndex: i, ...observation },
      });
    }

    const finalCurrent = yield* Router.currentRoute;
    const finalObservation = observeDocs(result.container, finalCurrent.path);
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: { phase: "final", ...finalObservation },
    });

    if (finalCurrent.path !== "/docs/components" || finalObservation.hasComponentsPage !== true) {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "router.current and visible article both belong to /docs/components",
          actual: stringifyObservation(finalObservation),
        },
      });
      return [
        violation(
          navigationFailureCode,
          "latest-docs-route-owns-route-effects",
          "Docs-like navigation did not settle to Components",
          "router.current.path=/docs/components and components page visible",
          stringifyObservation(finalObservation),
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    if (staleRouteRenders.length > 0) {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "no stale route component renders after router.current changed",
          actual: stringifyObservation(finalObservation),
        },
      });
      return [
        violation(
          staleRouteFailureCode,
          "latest-docs-route-owns-route-effects",
          "A stale docs route component rendered after the latest navigation changed router.current",
          "no route render work for /docs/getting-started while router.current=/docs/components",
          stringifyObservation(finalObservation),
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    if (finalObservation.railText !== "When to useBehaviorRelated exports") {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "Components rail headings",
          actual: stringifyObservation(finalObservation),
        },
      });
      return [
        violation(
          staleRailFailureCode,
          "latest-docs-route-owns-route-effects",
          "Docs rail headings did not settle to the Components route",
          "railText=When to useBehaviorRelated exports",
          stringifyObservation(finalObservation),
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    return [] satisfies ReadonlyArray<ContractViolation>;
  }).pipe(Effect.provide(Router.testLayer("/docs/getting-started"))),
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
              "Inspect layout rerenders that subscribe to router.current while carrying a previous Outlet child.",
              "Prevent stale route-child render effects from running after a newer navigation updates router.current.",
            ],
    },
    trace,
  };
};
