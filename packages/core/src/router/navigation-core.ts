/**
 * Adapter-independent navigation state transitions for `trygg/router`.
 *
 * @remarks
 * NavigationCore owns semantic push/replace/back/forward state laws for router
 * adapters. Browser and in-memory adapters provide runtime-specific history and
 * location operations while the core owns params interpolation, query building,
 * snapshot updates, and active-route checks.
 *
 * @since 1.0.0
 * @module trygg/router/navigation-core
 */
import { Clock, Effect, Layer, Option, Schema, SynchronizedRef } from "effect";
import * as Context from "effect/Context";
import { interpolateParams } from "./types.js";
import { buildPath, parsePath } from "./utils.js";

export interface NavigationSnapshot {
  readonly path: string;
  readonly query: URLSearchParams;
  readonly isPopstate: boolean;
  readonly hash: string;
  readonly scrollKey: string;
}

export interface NavigationTarget {
  readonly patternOrPath: string;
  readonly params: Option.Option<Readonly<Record<string, string | number>>>;
  readonly query: Option.Option<Readonly<Record<string, string>>>;
  readonly replace: boolean;
}

export class NavigationCoreError extends Schema.TaggedErrorClass<NavigationCoreError>()(
  "NavigationCoreError",
  {
    operation: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export interface NavigationAdapter {
  readonly read: Effect.Effect<NavigationSnapshot, NavigationCoreError>;
  readonly push: (url: string, state: unknown) => Effect.Effect<void, NavigationCoreError>;
  readonly replace: (url: string, state: unknown) => Effect.Effect<void, NavigationCoreError>;
  readonly back: Effect.Effect<void, NavigationCoreError>;
  readonly forward: Effect.Effect<void, NavigationCoreError>;
}

export const NavigationCoreConfigInput = Schema.Struct({
  notifyUnchangedQuery: Schema.Boolean,
});

type NavigationCoreConfig = typeof NavigationCoreConfigInput.Type;

export interface NavigationCoreShape {
  readonly current: Effect.Effect<NavigationSnapshot>;
  readonly navigate: (target: NavigationTarget) => Effect.Effect<void, NavigationCoreError>;
  readonly back: Effect.Effect<void, NavigationCoreError>;
  readonly forward: Effect.Effect<void, NavigationCoreError>;
  readonly isActive: (
    target: NavigationTarget,
    exact: boolean,
  ) => Effect.Effect<boolean, NavigationCoreError>;
  readonly refresh: Effect.Effect<void, NavigationCoreError>;
}

export const navigationTarget = (
  patternOrPath: string,
  options?: {
    readonly params?: Readonly<Record<string, string | number>>;
    readonly query?: Readonly<Record<string, string>>;
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

export const makeNavigationCore: (
  input: NavigationCoreConfig,
  adapter: NavigationAdapter,
) => Effect.Effect<NavigationCoreShape, NavigationCoreError> = Effect.fn(
  "NavigationCore.makeNavigationCore",
)(function* (input, adapter) {
  NavigationCoreConfigInput.make(input);
  const state = yield* SynchronizedRef.make(yield* adapter.read);

  const refresh = SynchronizedRef.updateEffect(state, () => adapter.read);

  const commitSnapshot: () => Effect.Effect<NavigationSnapshot, NavigationCoreError> = Effect.fn(
    "NavigationCore.commitSnapshot",
  )(function* () {
    yield* refresh;
    return yield* SynchronizedRef.get(state);
  });

  return {
    current: SynchronizedRef.get(state),
    navigate: Effect.fn("NavigationCore.navigate")(function* (target) {
      const url = yield* resolveNavigationTarget(target);
      const now = yield* Clock.currentTimeMillis;
      const historyState = { _scrollKey: `memory-${now.toString(36)}` };
      if (target.replace) {
        yield* adapter.replace(url, historyState);
      } else {
        yield* adapter.push(url, historyState);
      }
      yield* commitSnapshot();
    }),
    back: Effect.gen(function* () {
      yield* adapter.back;
      yield* commitSnapshot();
    }).pipe(Effect.withSpan("NavigationCore.back")),
    forward: Effect.gen(function* () {
      yield* adapter.forward;
      yield* commitSnapshot();
    }).pipe(Effect.withSpan("NavigationCore.forward")),
    isActive: Effect.fn("NavigationCore.isActive")(function* (target, exact) {
      const url = yield* resolveNavigationTarget(target);
      const { path } = yield* parsePath(url).pipe(
        Effect.mapError((cause) => new NavigationCoreError({ operation: "parsePath", cause })),
      );
      const snapshot = yield* SynchronizedRef.get(state);
      return exact ? snapshot.path === path : snapshot.path.startsWith(path);
    }),
    refresh: commitSnapshot().pipe(Effect.asVoid),
  };
});

export const makeInMemoryNavigationAdapter: (
  initialPath: string,
) => Effect.Effect<NavigationAdapter, NavigationCoreError> = Effect.fn(
  "NavigationCore.makeInMemoryAdapter",
)(function* (initialPath) {
  const stack: Array<string> = [initialPath];
  let index = 0;

  const readCurrent = Effect.gen(function* () {
    const fullPath = stack[index] ?? "/";
    const { path, query } = yield* parsePath(fullPath).pipe(
      Effect.mapError((cause) => new NavigationCoreError({ operation: "parsePath", cause })),
    );
    const hash = fullPath.includes("#") ? `#${fullPath.split("#").slice(1).join("#")}` : "";
    return { path, query, isPopstate: false, hash, scrollKey: `memory-${index}` };
  });

  return {
    read: readCurrent,
    push: (url) =>
      Effect.sync(() => {
        stack.splice(index + 1);
        stack.push(url);
        index = stack.length - 1;
      }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "push", cause }))),
    replace: (url) =>
      Effect.sync(() => {
        stack[index] = url;
      }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "replace", cause }))),
    back: Effect.sync(() => {
      if (index > 0) index--;
    }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "back", cause }))),
    forward: Effect.sync(() => {
      if (index < stack.length - 1) index++;
    }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "forward", cause }))),
  };
});

export class NavigationCore extends Context.Service<
  NavigationCore,
  {
    readonly current: Effect.Effect<NavigationSnapshot>;
    readonly navigate: (target: NavigationTarget) => Effect.Effect<void, NavigationCoreError>;
    readonly back: Effect.Effect<void, NavigationCoreError>;
    readonly forward: Effect.Effect<void, NavigationCoreError>;
    readonly isActive: (
      target: NavigationTarget,
      exact: boolean,
    ) => Effect.Effect<boolean, NavigationCoreError>;
    readonly refresh: Effect.Effect<void, NavigationCoreError>;
  }
>()("trygg/NavigationCore") {
  static readonly layer = (
    input: NavigationCoreConfig,
    adapter: NavigationAdapter,
  ): Layer.Layer<NavigationCore, NavigationCoreError> =>
    Layer.effect(NavigationCore, makeNavigationCore(input, adapter));
}
