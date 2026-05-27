/**
 * Internal behavior-contract trace API.
 *
 * @remarks
 * This module is verifier-facing infrastructure for Trygg's own behavior
 * contracts. It is intentionally not exported from public package entrypoints.
 * Events are no-op by default and are collected only when a contract runner
 * provides a collector.
 *
 * @see ./trace.docs.md - Source-owned event family and ordering guide
 * @internal
 */
import { Cause, Effect, Option, Ref } from "effect";
import * as Context from "effect/Context";

export type ContractTraceLevel = "semantic" | "cost" | "diagnostic";

export type ContractTraceEventName =
  | "contract.action.start"
  | "contract.action.end"
  | "contract.observation"
  | "contract.firstDivergence"
  | "debug.note"
  | "event.preventDefault"
  | "router.navigate.request"
  | "router.navigate.commit"
  | "router.current.set"
  | "router.query.set"
  | "history.push"
  | "history.replace"
  | "history.back"
  | "history.forward"
  | "outlet.process.start"
  | "outlet.process.commit"
  | "outlet.process.dropStale"
  | "outlet.lazyLeaf.load.start"
  | "outlet.lazyLeaf.load.ready"
  | "outlet.lazyLeaf.load.error"
  | "outlet.match.found"
  | "outlet.match.notFound"
  | "route.leaf.mount"
  | "route.leaf.unmount"
  | "route.render.skipStale"
  | "route.layout.skipStale"
  | "route.finalizer.run"
  | "asyncLoader.track"
  | "asyncLoader.dedup"
  | "asyncLoader.interrupt"
  | "asyncLoader.loading"
  | "asyncLoader.refreshing"
  | "asyncLoader.ready"
  | "asyncLoader.error"
  | "provider.acquire"
  | "provider.reuse"
  | "provider.failure"
  | "provider.replace"
  | "provider.finalize"
  | "signal.create"
  | "signal.dispose"
  | "signal.disposed_access"
  | "signal.subscribe"
  | "signal.unsubscribe"
  | "signal.set"
  | "signalElement.create"
  | "signalElement.scope.start"
  | "signalElement.swap.start"
  | "signalElement.swap.render"
  | "signalElement.swap.dropStale"
  | "signalElement.swap.commit"
  | "signalElement.cleanup"
  | "scroll.apply"
  | "prefetch.trigger"
  | "dom.create"
  | "dom.remove"
  | "component.render"
  | "effect.fork.scoped"
  | "effect.fiber.interrupt"
  | "effect.finalizer.register"
  | "effect.finalizer.run"
  | "effect.scope.close"
  | "effect.error.ignored";

export interface ContractTraceEvent {
  readonly event: ContractTraceEventName;
  readonly level?: ContractTraceLevel;
  readonly actionId?: string;
  readonly payload?: Record<string, unknown>;
}

export interface ContractTraceRecord {
  readonly seq: number;
  readonly runId: string;
  readonly actionId?: string;
  readonly event: ContractTraceEvent;
}

export interface ContractTraceCollector {
  readonly runId: string;
  readonly emit: (event: ContractTraceEvent) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ReadonlyArray<ContractTraceRecord>>;
}

export const CurrentCollector = Context.Reference<Option.Option<ContractTraceCollector>>(
  "trygg/contract/trace/CurrentCollector",
  { defaultValue: () => Option.none() },
);

export const CurrentActionId = Context.Reference<Option.Option<string>>(
  "trygg/contract/trace/CurrentActionId",
  { defaultValue: () => Option.none() },
);

export const createInMemoryCollector = (runId: string): Effect.Effect<ContractTraceCollector> =>
  Effect.gen(function* () {
    const recordsRef = yield* Ref.make<ReadonlyArray<ContractTraceRecord>>([]);
    const seqRef = yield* Ref.make(0);

    const collector: ContractTraceCollector = {
      runId,
      emit: (event) =>
        Effect.gen(function* () {
          const seq = yield* Ref.updateAndGet(seqRef, (current) => current + 1);
          const actionId = event.actionId;
          const record: ContractTraceRecord =
            actionId === undefined ? { seq, runId, event } : { seq, runId, actionId, event };
          yield* Ref.update(recordsRef, (records) => [...records, record]);
        }),
      snapshot: Ref.get(recordsRef),
    };

    return collector;
  });

export const emit: (event: ContractTraceEvent) => Effect.Effect<void> = Effect.fnUntraced(
  function* (event) {
    const collector = yield* CurrentCollector;
    if (Option.isNone(collector)) return;

    const currentActionId = yield* CurrentActionId;
    const enrichedEvent =
      event.actionId !== undefined || Option.isNone(currentActionId)
        ? event
        : { ...event, actionId: currentActionId.value };

    yield* collector.value.emit(enrichedEvent);
  },
);

export const withCollector = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  collector: ContractTraceCollector,
): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, CurrentCollector, Option.some(collector));

export const withAction = <A, E, R>(
  actionId: string,
  action: Record<string, unknown>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* emit({
      event: "contract.action.start",
      level: "semantic",
      actionId,
      payload: action,
    });

    const exit = yield* Effect.exit(
      Effect.provideService(effect, CurrentActionId, Option.some(actionId)),
    );

    if (exit._tag === "Success") {
      yield* emit({
        event: "contract.action.end",
        level: "semantic",
        actionId,
        payload: { status: "completed" },
      });
      return exit.value;
    }

    yield* emit({
      event: "contract.action.end",
      level: "semantic",
      actionId,
      payload: { status: "failed", cause: Cause.pretty(exit.cause) },
    });
    return yield* Effect.failCause(exit.cause);
  });
