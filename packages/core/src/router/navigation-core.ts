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
import { Data, Effect, Layer, Option, Schema, SynchronizedRef } from "effect";
import * as Context from "effect/Context";
import * as ContractTrace from "../contract/trace.js";
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

export class NavigationCoreError extends Data.TaggedError("NavigationCoreError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

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

type NavigationOperation = "push" | "replace" | "back" | "forward" | "refresh";

const queryString = (query: URLSearchParams): string => query.toString();

const snapshotPayload = (snapshot: NavigationSnapshot): Record<string, unknown> => ({
  path: snapshot.path,
  query: queryString(snapshot.query),
  hash: snapshot.hash,
  scrollKey: snapshot.scrollKey,
  isPopstate: snapshot.isPopstate,
});

const emitNavigationTrace = (
  event: ContractTrace.ContractTraceEventName,
  payload: Record<string, unknown>,
): Effect.Effect<void> =>
  ContractTrace.emit({ event, level: "semantic", payload }).pipe(Effect.ignore);

const historyEventFor = (
  operation: Exclude<NavigationOperation, "refresh">,
): ContractTrace.ContractTraceEventName => {
  switch (operation) {
    case "push":
      return "history.push";
    case "replace":
      return "history.replace";
    case "back":
      return "history.back";
    case "forward":
      return "history.forward";
  }
};

const emitSnapshotChanges = (
  operation: NavigationOperation,
  previous: NavigationSnapshot,
  next: NavigationSnapshot,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (previous.path !== next.path || previous.hash !== next.hash) {
      yield* emitNavigationTrace("router.current.set", {
        operation,
        previous: snapshotPayload(previous),
        next: snapshotPayload(next),
      });
    }

    if (!sameQuery(previous.query, next.query)) {
      yield* emitNavigationTrace("router.query.set", {
        operation,
        previousQuery: queryString(previous.query),
        nextQuery: queryString(next.query),
      });
    }
  });

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

export const resolveNavigationTarget = (
  target: NavigationTarget,
): Effect.Effect<string, NavigationCoreError> =>
  Effect.gen(function* () {
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
  });

export const sameQuery = (left: URLSearchParams, right: URLSearchParams): boolean =>
  left.toString() === right.toString();

export const makeNavigationCore = (
  input: NavigationCoreConfig,
  adapter: NavigationAdapter,
): Effect.Effect<NavigationCoreShape, NavigationCoreError> =>
  Effect.gen(function* () {
    const config = NavigationCoreConfigInput.make(input);
    const state = yield* SynchronizedRef.make(yield* adapter.read);

    const refresh = SynchronizedRef.updateEffect(state, () => adapter.read);

    const commitSnapshot = (operation: NavigationOperation): Effect.Effect<NavigationSnapshot, NavigationCoreError> =>
      Effect.gen(function* () {
        const previous = yield* SynchronizedRef.get(state);
        yield* refresh;
        const next = yield* SynchronizedRef.get(state);
        yield* emitSnapshotChanges(operation, previous, next);
        yield* emitNavigationTrace("router.navigate.commit", {
          operation,
          previous: snapshotPayload(previous),
          next: snapshotPayload(next),
        });
        return next;
      });

    return {
      current: SynchronizedRef.get(state),
      navigate: Effect.fn("NavigationCore.navigate")(function* (target) {
        const url = yield* resolveNavigationTarget(target);
        const operation = target.replace ? "replace" : "push";
        const historyState = { _scrollKey: `memory-${Date.now().toString(36)}` };
        yield* emitNavigationTrace("router.navigate.request", {
          operation,
          url,
          replace: target.replace,
          patternOrPath: target.patternOrPath,
        });
        if (target.replace) {
          yield* adapter.replace(url, historyState);
        } else {
          yield* adapter.push(url, historyState);
        }
        yield* emitNavigationTrace(historyEventFor(operation), { operation, url });
        yield* commitSnapshot(operation);
        void config;
      }),
      back: Effect.gen(function* () {
        yield* emitNavigationTrace("router.navigate.request", { operation: "back" });
        yield* adapter.back;
        yield* emitNavigationTrace("history.back", { operation: "back" });
        yield* commitSnapshot("back");
      }).pipe(Effect.withSpan("NavigationCore.back")),
      forward: Effect.gen(function* () {
        yield* emitNavigationTrace("router.navigate.request", { operation: "forward" });
        yield* adapter.forward;
        yield* emitNavigationTrace("history.forward", { operation: "forward" });
        yield* commitSnapshot("forward");
      }).pipe(Effect.withSpan("NavigationCore.forward")),
      isActive: Effect.fn("NavigationCore.isActive")(function* (target, exact) {
        const url = yield* resolveNavigationTarget(target);
        const { path } = yield* parsePath(url).pipe(
          Effect.mapError((cause) => new NavigationCoreError({ operation: "parsePath", cause })),
        );
        const snapshot = yield* SynchronizedRef.get(state);
        return exact ? snapshot.path === path : snapshot.path.startsWith(path);
      }),
      refresh: commitSnapshot("refresh").pipe(Effect.asVoid),
    };
  });

export const makeInMemoryNavigationAdapter = (
  initialPath: string,
): Effect.Effect<NavigationAdapter, NavigationCoreError> =>
  Effect.gen(function* () {
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
        }).pipe(
          Effect.mapError((cause) => new NavigationCoreError({ operation: "push", cause })),
        ),
      replace: (url) =>
        Effect.sync(() => {
          stack[index] = url;
        }).pipe(
          Effect.mapError((cause) => new NavigationCoreError({ operation: "replace", cause })),
        ),
      back: Effect.sync(() => {
        if (index > 0) index--;
      }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "back", cause }))),
      forward: Effect.sync(() => {
        if (index < stack.length - 1) index++;
      }).pipe(
        Effect.mapError((cause) => new NavigationCoreError({ operation: "forward", cause })),
      ),
    };
  });

export class NavigationCore extends Context.Service<NavigationCore, NavigationCoreShape>()(
  "trygg/NavigationCore",
) {
  static readonly layer = (
    input: NavigationCoreConfig,
    adapter: NavigationAdapter,
  ): Layer.Layer<NavigationCore, NavigationCoreError> =>
    Layer.effect(NavigationCore, makeNavigationCore(input, adapter));
}
