/**
 * Behavior contract: navigation settles to the latest route view.
 *
 * @internal
 */
import { Deferred, Duration, Effect, Layer } from "effect";
import { Element, text } from "../primitives/element.js";
import { browserLayer } from "../primitives/renderer.js";
import { renderElement } from "../testing/index.js";
import * as ContractTrace from "../contract/trace.js";
import * as Route from "../router/route.js";
import * as Routes from "../router/routes.js";
import * as Router from "../router/service.js";
import { Outlet } from "../router/outlet.js";
import type { RouteComponent } from "../router/types.js";

interface ContractLaw {
  readonly id: string;
  readonly failureCode: string;
  readonly description: string;
  readonly failureHints: ReadonlyArray<string>;
}

interface ContractScenarioMetadata {
  readonly name: string;
  readonly description: string;
  readonly fixedTrace: ReadonlyArray<Record<string, unknown>>;
}

interface ContractViolation {
  readonly code: string;
  readonly law: string;
  readonly message: string;
  readonly firstDivergenceSeq: number;
  readonly expected: string;
  readonly actual: string;
}

interface ContractDefinition {
  readonly name: string;
  readonly suspectedFiles: ReadonlyArray<string>;
  readonly laws: ReadonlyArray<ContractLaw>;
  readonly scenarios: ReadonlyArray<ContractScenarioMetadata>;
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

const latestRouteLaw: ContractLaw = {
  id: "latest-route-owns-visible-leaf",
  failureCode: "NAV_STALE_PREVIOUS_ROUTE_VISIBLE_DURING_PENDING",
  description:
    "After router.current changes to a new route with a loading boundary, the previous leaf route must not remain the visible active leaf unless an explicit stale-while-refreshing policy exists.",
  failureHints: [
    "Check AsyncLoader Refreshing(previous) semantics.",
    "Check Outlet pendingScroll and loader.view subscription timing.",
    "Check SignalElement stale swap dropping and scope cleanup.",
  ],
};

const unchangedQueryLaw: ContractLaw = {
  id: "unchanged-query-does-not-notify",
  failureCode: "NAV_REDUNDANT_QUERY_SIGNAL_UPDATE",
  description:
    "Navigation that changes only the path must not notify Router.query subscribers when the query string is semantically unchanged.",
  failureHints: [
    "Compare URLSearchParams by serialized query string before Signal.set(querySignal, newQuery).",
    "Check Router.testLayer and browserLayer both update query consistently.",
  ],
};

const stalePreviousRouteMetadata: ContractScenarioMetadata = {
  name: "stale-previous-route-during-pending",
  description:
    "Navigate from a ready route to a pending route with a loading boundary and assert that the old leaf is not still visible.",
  fixedTrace: [
    { kind: "render", path: "/dashboard" },
    { kind: "navigate", to: "/users" },
    { kind: "observe", after: "navigation-pending" },
  ],
};

const unchangedQueryMetadata: ContractScenarioMetadata = {
  name: "unchanged-query-does-not-notify",
  description:
    "Navigate between routes that share the same query string and assert query side effects are not noisy.",
  fixedTrace: [
    { kind: "render", path: "/dashboard?tab=main" },
    { kind: "navigate", to: "/users", query: { tab: "main" } },
    { kind: "observe", after: "navigation-settled" },
  ],
};

export const contract: ContractDefinition = {
  name: "navigation-latest-route-wins",
  suspectedFiles: [
    "packages/core/src/router/outlet.ts",
    "packages/core/src/router/outlet-services.ts",
    "packages/core/src/router/service.ts",
    "packages/core/src/primitives/render-signal-element.ts",
  ],
  laws: [latestRouteLaw, unchangedQueryLaw],
  scenarios: [stalePreviousRouteMetadata, unchangedQueryMetadata],
};

const testLayerAt = (path: string) => Layer.merge(browserLayer, Router.testLayer(path));

const routeElement = (testId: string, content: string): Element =>
  Element.Intrinsic({
    tag: "div",
    props: { "data-testid": testId },
    children: [text(content)],
    key: null,
  });

const successfulRoute = (testId: string, content: string): RouteComponent =>
  Effect.succeed(routeElement(testId, content));

const flushDom = (ms: number): Effect.Effect<void> => Effect.sleep(Duration.millis(ms));

const visibleLeaf = (container: HTMLElement): "dashboard" | "users" | "loading" | "none" => {
  if (container.querySelector("[data-testid='dashboard']") !== null) return "dashboard";
  if (container.querySelector("[data-testid='users']") !== null) return "users";
  if (container.querySelector("[data-testid='loading']") !== null) return "loading";
  return "none";
};

const observe = (container: HTMLElement, currentPath: string): Record<string, unknown> => ({
  currentPath,
  visibleLeaf: visibleLeaf(container),
  html: container.innerHTML,
});

const scenarioByName = (name: string | undefined): ContractScenarioMetadata => {
  const selected = contract.scenarios.find((scenario) => scenario.name === name);
  return selected ?? stalePreviousRouteMetadata;
};

const stalePreviousRouteScenario = Effect.scoped(
  Effect.gen(function* () {
    const usersReady = yield* Deferred.make<void>();
    const dashboard = successfulRoute("dashboard", "Dashboard Page");
    const users: RouteComponent = Deferred.await(usersReady).pipe(
      Effect.as(routeElement("users", "Users Page")),
    );
    const loading = successfulRoute("loading", "Loading...");

    const manifest = Routes.make()
      .add(Route.make("/dashboard").component(dashboard).loading(loading))
      .add(Route.make("/users").component(users).loading(loading)).manifest;

    const outlet = Outlet({ routes: manifest });

    const { container } = yield* ContractTrace.withAction(
      "a1",
      { kind: "render", path: "/dashboard" },
      renderElement(outlet),
    );
    yield* flushDom(25);

    const router = yield* Router.Router;
    yield* ContractTrace.withAction(
      "a2",
      { kind: "navigate", to: "/users" },
      router.navigate("/users"),
    );
    yield* flushDom(25);

    const current = yield* Router.currentRoute;
    const observation = observe(container, current.path);
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: observation,
    });

    if (current.path === "/users" && observation.visibleLeaf === "dashboard") {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "visible leaf belongs to /users or loading fallback",
          actual: "visible leaf belongs to /dashboard",
        },
      });
      return [
        {
          code: latestRouteLaw.failureCode,
          law: latestRouteLaw.id,
          message:
            "router.current is /users but dashboard leaf remains visible while the users route is pending",
          firstDivergenceSeq: 0,
          expected: "visible leaf belongs to /users or loading fallback",
          actual: "visible leaf belongs to /dashboard",
        },
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    return [] satisfies ReadonlyArray<ContractViolation>;
  }).pipe(Effect.provide(testLayerAt("/dashboard"))),
);

const unchangedQueryScenario = Effect.scoped(
  Effect.gen(function* () {
    const dashboard = successfulRoute("dashboard", "Dashboard Page");
    const users = successfulRoute("users", "Users Page");
    const loading = successfulRoute("loading", "Loading...");
    const manifest = Routes.make()
      .add(Route.make("/dashboard").component(dashboard).loading(loading))
      .add(Route.make("/users").component(users).loading(loading)).manifest;

    const outlet = Outlet({ routes: manifest });
    const { container } = yield* ContractTrace.withAction(
      "a1",
      { kind: "render", path: "/dashboard?tab=main" },
      renderElement(outlet),
    );
    yield* flushDom(25);

    const router = yield* Router.Router;
    yield* ContractTrace.withAction(
      "a2",
      { kind: "navigate", to: "/users", query: { tab: "main" } },
      router.navigate("/users", { query: { tab: "main" } }),
    );
    yield* flushDom(25);

    const current = yield* Router.currentRoute;
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: observe(container, current.path),
    });

    return [] satisfies ReadonlyArray<ContractViolation>;
  }).pipe(Effect.provide(testLayerAt("/dashboard?tab=main"))),
);

const scenarioEffect = (scenarioName: string) =>
  scenarioName === "unchanged-query-does-not-notify"
    ? unchangedQueryScenario
    : stalePreviousRouteScenario;

const traceLawViolations = (
  scenarioName: string,
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
): ReadonlyArray<ContractViolation> => {
  if (scenarioName !== unchangedQueryMetadata.name) return [];

  const redundantQuerySet = records.find((record) => {
    if (record.event.event !== "router.query.set") return false;
    const payload = record.event.payload;
    if (payload === undefined) return false;
    return (
      payload.fromQuery === payload.toQuery &&
      payload.changed === false &&
      payload.notified === true
    );
  });

  if (redundantQuerySet === undefined) return [];

  return [
    {
      code: unchangedQueryLaw.failureCode,
      law: unchangedQueryLaw.id,
      message:
        "Router.query notified subscribers even though the serialized query string did not change",
      firstDivergenceSeq: redundantQuerySet.seq,
      expected: "no Router.query notification for an unchanged serialized query string",
      actual: "router.query.set emitted changed=false with notified=true",
    },
  ];
};

const normalizeViolations = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
  violations: ReadonlyArray<ContractViolation>,
): ReadonlyArray<ContractViolation> => {
  const firstDivergenceSeq =
    records.find((record) => record.event.event === "contract.firstDivergence")?.seq ?? 0;

  return violations.map((violation) => ({
    ...violation,
    firstDivergenceSeq:
      violation.firstDivergenceSeq === 0 ? firstDivergenceSeq : violation.firstDivergenceSeq,
  }));
};

const nextActionsFor = (violation: ContractViolation | undefined): ReadonlyArray<string> => {
  if (violation === undefined) return [];
  if (violation.code === unchangedQueryLaw.failureCode) {
    return [
      "Replay the trace.",
      "Inspect Router.query Signal.set calls in service.ts.",
      "Compare serialized URLSearchParams before notifying query subscribers.",
    ];
  }

  return [
    "Replay the trace.",
    "Inspect AsyncLoader Refreshing(previous) semantics.",
    "Decide whether stale previous route content is allowed.",
  ];
};

const toTraceLines = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
  violations: ReadonlyArray<ContractViolation>,
): ReadonlyArray<Record<string, unknown>> => {
  const lines = records.map((record): Record<string, unknown> => {
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
  });

  return [
    ...lines,
    ...violations.map(
      (violation, index): Record<string, unknown> => ({
        schemaVersion: 1,
        lineType: "violation",
        seq: records.length + index + 1,
        failureCode: violation.code,
        law: violation.law,
        message: violation.message,
        firstDivergenceSeq: violation.firstDivergenceSeq,
        expected: violation.expected,
        actual: violation.actual,
      }),
    ),
  ];
};

export const runContract = async (options: ContractRunOptions): Promise<ContractRunResult> => {
  const scenario = scenarioByName(options.scenario);
  const collector = await Effect.runPromise(ContractTrace.createInMemoryCollector(options.runId));
  const violations = await Effect.runPromise(
    ContractTrace.withCollector(scenarioEffect(scenario.name), collector),
  );
  const records = await Effect.runPromise(collector.snapshot);
  const normalizedViolations = normalizeViolations(records, [
    ...violations,
    ...traceLawViolations(scenario.name, records),
  ]);
  const trace = toTraceLines(records, normalizedViolations);
  const firstViolation = normalizedViolations[0];
  const status = firstViolation === undefined ? "passed" : "failed";
  const failure =
    firstViolation === undefined
      ? undefined
      : {
          code: firstViolation.code,
          law: firstViolation.law,
          message: firstViolation.message,
          firstDivergenceSeq: firstViolation.firstDivergenceSeq,
          expected: firstViolation.expected,
          actual: firstViolation.actual,
        };

  return {
    status,
    contract: contract.name,
    scenario: scenario.name,
    ...(firstViolation === undefined ? {} : { failureCode: firstViolation.code }),
    summary: {
      schemaVersion: 1,
      tool: "assert-ui",
      status,
      contract: contract.name,
      scenario: scenario.name,
      suspectedFiles: contract.suspectedFiles,
      laws: contract.laws,
      ...(failure === undefined ? {} : { failure }),
      nextActions: nextActionsFor(firstViolation),
    },
    trace,
  };
};
