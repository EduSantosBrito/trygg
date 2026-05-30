/**
 * Scenario runner for deterministic trace-backed contracts.
 *
 * @remarks
 * A scenario is a small Effect workflow that drives a framework behavior under
 * {@link record} and {@link withAction}, returning the ordered trace buffer for
 * budget and ordering analyzers.
 *
 * @internal
 */
import { Effect } from "effect";
import { makeRecorder, record } from "./trace.js";

export interface Scenario<E = never, R = never> {
  readonly name: string;
  readonly rows: number;
  /**
   * Drives the scenario. Use {@link withAction} inside this effect to scope the
   * benchmark operation after any setup render that should not be budgeted.
   */
  readonly run: Effect.Effect<void, E, R>;
}

export const runScenario = Effect.fn("Trace.runScenario")(function* <E, R>(
  scenario: Scenario<E, R>,
) {
  const recorder = makeRecorder();
  yield* record(scenario.run, recorder);
  return yield* recorder.snapshot;
});
