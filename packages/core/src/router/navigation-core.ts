/**
 * Adapter-independent navigation state transitions for `trygg/router`.
 *
 * @remarks
 * NavigationCore owns semantic push/replace/back/forward state laws for router
 * adapters. Browser and in-memory adapters provide runtime-specific history and
 * location operations while the core owns params interpolation, query building,
 * snapshot updates, and active-route checks.
 * Permit acquisition and adapter mutation remain interruptible. After a successful
 * mutation, snapshot reconciliation completes before cancellation is observed.
 *
 * @since 1.0.0
 * @module trygg/router/navigation-core
 */
import { Effect, Option, Ref, Schema, Semaphore, type Fiber, type Scope } from "effect";
import { interpolateParams } from "./types.js";
import { buildPath, parsePath } from "./utils.js";

export interface NavigationSnapshot {
  readonly navigationId: number;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly isPopstate: boolean;
  readonly hash: string;
  readonly scrollKey: string;
}

export type NavigationAdapterSnapshot = Omit<NavigationSnapshot, "navigationId">;

export interface NavigationTarget {
  readonly patternOrPath: string;
  readonly params: Option.Option<Readonly<Record<string, string | number>>>;
  readonly query: Option.Option<Readonly<Record<string, string | undefined>>>;
  readonly replace: boolean;
}

export class NavigationCoreError extends Schema.TaggedError<NavigationCoreError>()(
  "NavigationCoreError",
  {
    operation: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export interface NavigationAdapter {
  readonly read: Effect.Effect<NavigationAdapterSnapshot, NavigationCoreError>;
  readonly push: (url: string, state: unknown) => Effect.Effect<void, NavigationCoreError>;
  readonly replace: (url: string, state: unknown) => Effect.Effect<void, NavigationCoreError>;
  readonly back: Effect.Effect<void, NavigationCoreError>;
  readonly forward: Effect.Effect<void, NavigationCoreError>;
}

export const NavigationCoreConfigInput = Schema.Struct({
  notifyUnchangedQuery: Schema.Boolean,
});

type NavigationCoreConfig = typeof NavigationCoreConfigInput.Type;

export interface NavigationCoreShape<Transition = NavigationSnapshot> {
  readonly current: Effect.Effect<NavigationSnapshot>;
  readonly navigate: (target: NavigationTarget) => Effect.Effect<Transition, NavigationCoreError>;
  readonly back: Effect.Effect<Transition, NavigationCoreError>;
  readonly forward: Effect.Effect<Transition, NavigationCoreError>;
  readonly isActive: (
    target: NavigationTarget,
    exact: boolean,
  ) => Effect.Effect<boolean, NavigationCoreError>;
  readonly refresh: Effect.Effect<Transition, NavigationCoreError>;
}

export const navigationTarget = (
  patternOrPath: string,
  options?: {
    readonly params?: Readonly<Record<string, string | number>>;
    readonly query?: Readonly<Record<string, string | undefined>>;
    readonly replace?: boolean;
  },
): NavigationTarget => ({
  patternOrPath,
  params: options?.params === undefined ? Option.none() : Option.some(options.params),
  query: options?.query === undefined ? Option.none() : Option.some(options.query),
  replace: options?.replace === true,
});

export const resolveNavigationTarget: (
  target: NavigationTarget,
) => Effect.Effect<string, NavigationCoreError> = Effect.fn("NavigationCore.resolveTarget")(
  function* (target) {
    const path = Option.isSome(target.params)
      ? yield* interpolateParams(target.patternOrPath, target.params.value).pipe(
          Effect.mapError(
            (cause) => new NavigationCoreError({ operation: "interpolateParams", cause }),
          ),
        )
      : target.patternOrPath;
    return yield* buildPath(path, Option.getOrUndefined(target.query)).pipe(
      Effect.mapError((cause) => new NavigationCoreError({ operation: "buildPath", cause })),
    );
  },
);

export const sameQuery = (left: URLSearchParams, right: URLSearchParams): boolean =>
  left.toString() === right.toString();

const makeService = Effect.fn("NavigationCore.make")(function* <Transition>(
  input: NavigationCoreConfig,
  adapter: NavigationAdapter,
  handoff: (snapshot: NavigationSnapshot) => Effect.Effect<Transition>,
): Effect.fn.Return<NavigationCoreShape<Transition>, NavigationCoreError> {
  NavigationCoreConfigInput.make(input);
  const initial = yield* adapter.read;
  const state = yield* Ref.make<NavigationSnapshot>({
    ...initial,
    navigationId: 0,
  });
  const transitions = yield* Semaphore.make(1);
  const scrollKeyPrefix = initial.scrollKey;
  let scrollSequence = 0;

  const transition = Effect.fn("NavigationCore.transition")(function* (
    operation: (current: NavigationSnapshot) => Effect.Effect<void, NavigationCoreError>,
  ) {
    return yield* transitions.withPermit(
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          yield* restore(operation(current));
          // Once the adapter has applied a mutation, reconcile its snapshot
          // before observing cancellation. Admission and mutation remain interruptible.
          const adapterSnapshot = yield* adapter.read;
          const next: NavigationSnapshot = {
            ...adapterSnapshot,
            navigationId: current.navigationId + 1,
          };
          yield* Ref.set(state, next);
          return yield* handoff(next);
        }),
      ),
    );
  });

  return {
    current: Ref.get(state),
    navigate: Effect.fn("NavigationCore.navigate")(function* (target) {
      const url = yield* resolveNavigationTarget(target);
      return yield* transition(() =>
        Effect.gen(function* () {
          const historyState = {
            _scrollKey: `${scrollKeyPrefix}-${(++scrollSequence).toString(36)}`,
          };
          if (target.replace) {
            yield* adapter.replace(url, historyState);
          } else {
            yield* adapter.push(url, historyState);
          }
        }),
      );
    }),
    back: transition(() => adapter.back).pipe(Effect.withSpan("NavigationCore.back")),
    forward: transition(() => adapter.forward).pipe(Effect.withSpan("NavigationCore.forward")),
    isActive: Effect.fn("NavigationCore.isActive")(function* (target, exact) {
      const url = yield* resolveNavigationTarget(target);
      const { path } = yield* parsePath(url).pipe(
        Effect.mapError((cause) => new NavigationCoreError({ operation: "parsePath", cause })),
      );
      const snapshot = yield* Ref.get(state);
      return exact ? snapshot.path === path : snapshot.path.startsWith(path);
    }),
    refresh: transition(() => Effect.void),
  };
});

export namespace NavigationAdapter {
  export const makeInMemory: (
    initialPath: string,
  ) => Effect.Effect<NavigationAdapter, NavigationCoreError> = Effect.fn(
    "NavigationAdapter.makeInMemory",
  )(function* (initialPath) {
    const HistoryState = Schema.Struct({ _scrollKey: Schema.String });
    const decodeHistoryState = Schema.decodeUnknownOption(HistoryState);
    const stack: Array<{ readonly url: string; readonly scrollKey: string }> = [
      { url: initialPath, scrollKey: "memory-0" },
    ];
    let index = 0;
    let isPopstate = false;

    const readCurrent = Effect.gen(function* () {
      const entry = stack[index] ?? { url: "/", scrollKey: "memory-0" };
      const fullPath = entry.url;
      const { path, query } = yield* parsePath(fullPath).pipe(
        Effect.mapError((cause) => new NavigationCoreError({ operation: "parsePath", cause })),
      );
      const hash = fullPath.includes("#") ? `#${fullPath.split("#").slice(1).join("#")}` : "";
      return { path, query, isPopstate, hash, scrollKey: entry.scrollKey };
    });

    return {
      read: readCurrent,
      push: (url, historyState) =>
        Effect.sync(() => {
          const decodedState = decodeHistoryState(historyState);
          const scrollKey = Option.isSome(decodedState)
            ? decodedState.value._scrollKey
            : `memory-${stack.length}`;
          stack.splice(index + 1);
          stack.push({ url, scrollKey });
          index = stack.length - 1;
          isPopstate = false;
        }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "push", cause }))),
      replace: (url, historyState) =>
        Effect.sync(() => {
          const decodedState = decodeHistoryState(historyState);
          const current = stack[index] ?? { url: "/", scrollKey: "memory-0" };
          stack[index] = {
            url,
            scrollKey: Option.isSome(decodedState)
              ? decodedState.value._scrollKey
              : current.scrollKey,
          };
          isPopstate = false;
        }).pipe(
          Effect.mapError((cause) => new NavigationCoreError({ operation: "replace", cause })),
        ),
      back: Effect.sync(() => {
        if (index > 0) {
          index--;
          isPopstate = true;
        }
      }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "back", cause }))),
      forward: Effect.sync(() => {
        if (index < stack.length - 1) {
          index++;
          isPopstate = true;
        }
      }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "forward", cause }))),
    };
  });
}

export const NavigationCore = {
  make: (input: NavigationCoreConfig, adapter: NavigationAdapter) =>
    makeService(input, adapter, Effect.succeed),
};

/** @internal A publication belongs to the Router scope after history commits. */
export interface PublishedNavigation<A, E> {
  readonly snapshot: NavigationSnapshot;
  readonly publication: Fiber.Fiber<A, E>;
}

/**
 * @internal
 * Attach publication before observing post-commit cancellation. The fork starts
 * deferred, so application listeners execute outside the history permit. Callers
 * can await its Exit without owning or cancelling this Router-scoped work.
 */
export const makePublishingNavigationCore = <A, E>(
  input: NavigationCoreConfig,
  adapter: NavigationAdapter,
  scope: Scope.Scope,
  publish: (snapshot: NavigationSnapshot) => Effect.Effect<A, E>,
): Effect.Effect<NavigationCoreShape<PublishedNavigation<A, E>>, NavigationCoreError> =>
  makeService(input, adapter, (snapshot) =>
    Effect.forkIn(
      Effect.suspend(() => publish(snapshot)),
      scope,
    ).pipe(Effect.map((publication) => ({ snapshot, publication }))),
  );
