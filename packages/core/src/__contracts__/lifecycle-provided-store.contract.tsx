/**
 * Behavior contract: lifecycle-provided stores are mounted resources.
 *
 * @internal
 */
import { Duration, Effect, Exit, Layer, Scope } from "effect";
import * as Context from "effect/Context";
import * as Component from "../primitives/component.js";
import * as Signal from "../primitives/signal.js";
import * as ContractTrace from "../contract/trace.js";
import { click, render } from "../testing/index.js";

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

const providerLifetimeLaw: ContractLaw = {
  id: "lifecycle-provider-owns-store-scope",
  failureCode: "LIFECYCLE_PROVIDER_STORE_REACQUIRED_OR_LEAKED",
  description:
    "A component-provided store layer is acquired once for a stable mount, preserves scoped signal state across rerenders, and finalizes exactly once on unmount.",
  failureHints: [
    "Check render-component provider scope reuse across stable rerenders.",
    "Check Component.provide(layer) metadata identity and reconciliation.",
    "Check provider scope closure during component cleanup.",
  ],
};

const mountedStoreMetadata: ContractScenarioMetadata = {
  name: "mounted-store-survives-rerender",
  description:
    "Render a component provided with a signal-backed store layer, mutate store state, rerender the parent, then unmount.",
  fixedTrace: [
    { kind: "render", component: "App" },
    { kind: "click", target: "store" },
    { kind: "click", target: "rerender" },
    { kind: "unmount" },
  ],
};

export const contract: ContractDefinition = {
  name: "lifecycle-provided-store",
  suspectedFiles: [
    "packages/core/src/primitives/component.ts",
    "packages/core/src/primitives/render-component.ts",
    "packages/core/src/primitives/signal.ts",
  ],
  laws: [providerLifetimeLaw],
  scenarios: [mountedStoreMetadata],
};

class Store extends Context.Service<
  Store,
  {
    readonly count: Signal.Signal<number>;
    readonly increment: Effect.Effect<void, Signal.SignalDisposedError>;
  }
>()("contract/lifecycle/Store") {}

const flushDom = (ms: number): Effect.Effect<void> => Effect.sleep(Duration.millis(ms));

const scenarioByName = (name: string | undefined): ContractScenarioMetadata => {
  const selected = contract.scenarios.find((scenario) => scenario.name === name);
  return selected ?? mountedStoreMetadata;
};

const mountedStoreScenario = Effect.scoped(
  Effect.gen(function* () {
    let acquireCount = 0;
    let finalizeCount = 0;

    const StoreLive = Layer.effect(
      Store,
      Effect.gen(function* () {
        acquireCount += 1;
        const count = yield* Signal.make(0);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            finalizeCount += 1;
          }),
        );
        return {
          count,
          increment: Signal.update(count, (value) => value + 1),
        };
      }).pipe(Effect.annotateLogs({ service: "Store" })),
    );

    const StoreView = Component.gen(function* () {
      const store = yield* Store;
      const count = yield* Signal.get(store.count);
      return (
        <button data-testid="store" onClick={() => store.increment}>
          {String(count)}
        </button>
      );
    });

    const App = Component.gen(function* () {
      const parentRenders = yield* Signal.make(0);
      const renderCount = yield* Signal.get(parentRenders);
      return (
        <section>
          <button
            data-testid="rerender"
            onClick={() => Signal.update(parentRenders, (value) => value + 1)}
          >
            {String(renderCount)}
          </button>
          <StoreView />
        </section>
      );
    }).pipe(Component.provide(StoreLive));

    const scope = yield* Scope.make();
    const result = yield* ContractTrace.withAction(
      "a1",
      { kind: "render", component: "App" },
      render(<App />).pipe(Scope.provide(scope)),
    );
    yield* flushDom(0);

    const initialStoreText = (yield* result.getByTestId("store")).textContent;

    yield* ContractTrace.withAction(
      "a2",
      { kind: "click", target: "store" },
      click(yield* result.getByTestId("store")),
    );
    yield* flushDom(0);
    const afterStoreClickText = (yield* result.getByTestId("store")).textContent;

    yield* ContractTrace.withAction(
      "a3",
      { kind: "click", target: "rerender" },
      click(yield* result.getByTestId("rerender")),
    );
    yield* flushDom(0);
    const afterRerenderText = (yield* result.getByTestId("store")).textContent;

    yield* ContractTrace.withAction("a4", { kind: "unmount" }, Scope.close(scope, Exit.void));
    yield* flushDom(0);

    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: {
        acquireCount,
        finalizeCount,
        initialStoreText,
        afterStoreClickText,
        afterRerenderText,
      },
    });

    const violations: Array<ContractViolation> = [];
    if (acquireCount !== 1) {
      violations.push({
        code: providerLifetimeLaw.failureCode,
        law: providerLifetimeLaw.id,
        message: "Store provider was not acquired exactly once during a stable mounted lifetime",
        firstDivergenceSeq: 0,
        expected: "acquireCount === 1",
        actual: `acquireCount === ${acquireCount}`,
      });
    }
    if (initialStoreText !== "0" || afterStoreClickText !== "1" || afterRerenderText !== "1") {
      violations.push({
        code: providerLifetimeLaw.failureCode,
        law: providerLifetimeLaw.id,
        message: "Store signal state did not survive a parent rerender",
        firstDivergenceSeq: 0,
        expected: "store text transitions 0 -> 1 -> 1",
        actual: `store text transitions ${initialStoreText} -> ${afterStoreClickText} -> ${afterRerenderText}`,
      });
    }
    if (finalizeCount !== 1) {
      violations.push({
        code: providerLifetimeLaw.failureCode,
        law: providerLifetimeLaw.id,
        message: "Store provider finalizer did not run exactly once on unmount",
        firstDivergenceSeq: 0,
        expected: "finalizeCount === 1",
        actual: `finalizeCount === ${finalizeCount}`,
      });
    }

    return violations;
  }),
);

const traceLawViolations = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
): ReadonlyArray<ContractViolation> => {
  const providerAcquireCount = records.filter(
    (record) => record.event.event === "provider.acquire",
  ).length;
  const providerReuseCount = records.filter(
    (record) => record.event.event === "provider.reuse",
  ).length;
  const providerFinalizeCount = records.filter(
    (record) => record.event.event === "provider.finalize",
  ).length;

  const violations: Array<ContractViolation> = [];
  if (providerAcquireCount !== 1) {
    violations.push({
      code: providerLifetimeLaw.failureCode,
      law: providerLifetimeLaw.id,
      message: "Provider trace did not record exactly one acquisition",
      firstDivergenceSeq: 0,
      expected: "one provider.acquire event",
      actual: `${providerAcquireCount} provider.acquire events`,
    });
  }
  if (providerReuseCount < 1) {
    violations.push({
      code: providerLifetimeLaw.failureCode,
      law: providerLifetimeLaw.id,
      message: "Provider trace did not record reuse during stable rerender",
      firstDivergenceSeq: 0,
      expected: "at least one provider.reuse event",
      actual: `${providerReuseCount} provider.reuse events`,
    });
  }
  if (providerFinalizeCount !== 1) {
    violations.push({
      code: providerLifetimeLaw.failureCode,
      law: providerLifetimeLaw.id,
      message: "Provider trace did not record exactly one finalization",
      firstDivergenceSeq: 0,
      expected: "one provider.finalize event",
      actual: `${providerFinalizeCount} provider.finalize events`,
    });
  }

  return violations;
};

const normalizeViolations = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
  violations: ReadonlyArray<ContractViolation>,
): ReadonlyArray<ContractViolation> => {
  const firstObservationSeq =
    records.find((record) => record.event.event === "contract.observation")?.seq ?? 0;

  return violations.map((violation) => ({
    ...violation,
    firstDivergenceSeq:
      violation.firstDivergenceSeq === 0 ? firstObservationSeq : violation.firstDivergenceSeq,
  }));
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
  const scenarioViolations = await Effect.runPromise(
    ContractTrace.withCollector(mountedStoreScenario, collector),
  );
  const records = await Effect.runPromise(collector.snapshot);
  const normalizedViolations = normalizeViolations(records, [
    ...scenarioViolations,
    ...traceLawViolations(records),
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
      nextActions:
        firstViolation === undefined
          ? []
          : [
              "Replay the trace.",
              "Inspect provider.acquire/reuse/finalize events.",
              "Check that component provider scopes are reused across rerenders and closed on unmount.",
            ],
    },
    trace,
  };
};
