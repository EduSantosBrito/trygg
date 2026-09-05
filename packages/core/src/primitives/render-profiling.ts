import { Context, Effect } from "effect";
import { identity } from "effect/Function";

/** Internal opt-in flag; the normal renderer does not import an exporter. */
export const Enabled = Context.Reference<boolean>("trygg/Profiling/Enabled", {
  defaultValue: () => false,
});

/** Construct phase combinators once per list, not once per row operation. */
export const phase = (
  enabled: boolean,
  name: string,
  root = false,
): (<A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>) =>
  enabled ? Effect.withSpan(name, { root }, { captureStackTrace: false }) : identity;

/** Fixed vocabulary: never derive exported span names from row keys or data. */
export const names = new Set([
  "trygg.keyedList.granular",
  "trygg.keyedList.update",
  "trygg.keyedList.prepare",
  "trygg.keyedList.render",
  "trygg.keyedList.properties",
  "trygg.keyedList.reconcile",
  "trygg.keyedList.cleanup",
  "renderKeyedList",
  "renderComponent",
  "renderSignalElement",
  "renderFragment",
  "renderProvide",
  "renderErrorBoundary",
  "Renderer.mount",
  "Renderer.render",
  "Signal.derive",
  "Signal.deriveAll",
  "Signal.selector",
]);
