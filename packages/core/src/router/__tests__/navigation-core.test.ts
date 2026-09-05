import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Ref } from "effect";
import * as Trace from "../../trace/index.js";
import * as Signal from "../../primitives/signal.js";
import {
  NavigationAdapter,
  NavigationCore,
  NavigationCoreError,
  navigationTarget,
  sameQuery,
  type NavigationCoreShape,
} from "../navigation-core.js";
import { parsePath } from "../utils.js";
import * as Router from "../service.js";

const makeCore: (initialPath: string) => Effect.Effect<NavigationCoreShape, NavigationCoreError> =
  Effect.fn("NavigationCoreTest.makeCore")(function* (initialPath: string) {
    const adapter = yield* NavigationAdapter.makeInMemory(initialPath);
    return yield* NavigationCore.make({ notifyUnchangedQuery: false }, adapter);
  });

const makeBrowserLikeCore: (
  initialPath: string,
) => Effect.Effect<NavigationCoreShape, NavigationCoreError> = Effect.fn(
  "NavigationCoreTest.makeBrowserLikeCore",
)(function* (initialPath: string) {
  const historyStack: Array<string> = [initialPath];
  let index = 0;
  const adapter: NavigationAdapter = {
    read: Effect.gen(function* () {
      const fullPath = historyStack[index] ?? "/";
      const { path, query } = yield* parsePath(fullPath).pipe(
        Effect.mapError((cause) => new NavigationCoreError({ operation: "parsePath", cause })),
      );
      return { path, query, isPopstate: false, hash: "", scrollKey: `browser-like-${index}` };
    }),
    push: (url) =>
      Effect.sync(() => {
        historyStack.splice(index + 1);
        historyStack.push(url);
        index = historyStack.length - 1;
      }).pipe(
        Effect.mapError((cause) => new NavigationCoreError({ operation: "pushState", cause })),
      ),
    replace: (url) =>
      Effect.sync(() => {
        historyStack[index] = url;
      }).pipe(
        Effect.mapError((cause) => new NavigationCoreError({ operation: "replaceState", cause })),
      ),
    back: Effect.sync(() => {
      if (index > 0) index--;
    }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "back", cause }))),
    forward: Effect.sync(() => {
      if (index < historyStack.length - 1) index++;
    }).pipe(Effect.mapError((cause) => new NavigationCoreError({ operation: "forward", cause }))),
  };
  return yield* NavigationCore.make({ notifyUnchangedQuery: false }, adapter);
});

const traceEventsFor: <E, R>(
  effect: Effect.Effect<void, E, R>,
) => Effect.Effect<ReadonlyArray<Trace.TraceRecord>, E, R> = Effect.fn(
  "NavigationCoreTest.traceEventsFor",
)(function* <E, R>(effect: Effect.Effect<void, E, R>) {
  const recorder = Trace.makeRecorder();
  yield* Trace.record(effect, recorder);
  return recorder.records();
});

const eventNames = (
  records: ReadonlyArray<Trace.TraceRecord>,
): ReadonlyArray<Trace.TraceEventName> => records.map((record) => record.name);

const runNavigationLaws = (
  name: string,
  make: () => Effect.Effect<NavigationCoreShape, NavigationCoreError>,
): void => {
  describe(name, () => {
    it.effect("push updates path and query", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/users", { query: { tab: "main" } }));
        const snapshot = yield* core.current;

        assert.strictEqual(snapshot.path, "/users");
        assert.strictEqual(snapshot.query.get("tab"), "main");
      }),
    );

    it.effect("replace updates current entry without adding history", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/first"));
        yield* core.navigate(navigationTarget("/second", { replace: true }));
        yield* core.back;
        const snapshot = yield* core.current;

        assert.strictEqual(snapshot.path, "/dashboard");
      }),
    );

    it.effect("back and forward move through adapter history", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/first"));
        yield* core.navigate(navigationTarget("/second"));
        yield* core.back;
        assert.strictEqual((yield* core.current).path, "/first");
        yield* core.forward;
        assert.strictEqual((yield* core.current).path, "/second");
      }),
    );

    it.effect("interpolates params before committing navigation", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/users/:id", { params: { id: 42 } }));

        assert.strictEqual((yield* core.current).path, "/users/42");
      }),
    );

    it.effect("checks exact and prefix active targets", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/users/:id", { params: { id: 42 } }));

        assert.isTrue(yield* core.isActive(navigationTarget("/users"), false));
        assert.isFalse(yield* core.isActive(navigationTarget("/users"), true));
        assert.isTrue(
          yield* core.isActive(navigationTarget("/users/:id", { params: { id: 42 } }), true),
        );
      }),
    );

    it.effect("detects unchanged and changed semantic query values", () =>
      Effect.gen(function* () {
        const core = yield* make();
        const initial = yield* core.current;
        yield* core.navigate(navigationTarget("/dashboard", { query: { tab: "main" } }));
        const same = yield* core.current;
        yield* core.navigate(navigationTarget("/dashboard", { query: { tab: "details" } }));
        const changed = yield* core.current;

        assert.isTrue(sameQuery(initial.query, same.query));
        assert.isFalse(sameQuery(same.query, changed.query));
      }),
    );
  });
};

runNavigationLaws("NavigationCore in-memory laws", () => makeCore("/dashboard?tab=main"));
runNavigationLaws("NavigationCore browser-like adapter laws", () =>
  makeBrowserLikeCore("/dashboard?tab=main"),
);

describe("NavigationCore trace boundary", () => {
  it.effect("stays silent; RouterService owns semantic navigation trace events", () =>
    Effect.gen(function* () {
      const records = yield* traceEventsFor(
        Effect.gen(function* () {
          const core = yield* makeCore("/dashboard?tab=main");
          yield* core.navigate(navigationTarget("/users", { query: { tab: "details" } }));
          yield* core.navigate(
            navigationTarget("/users", { query: { tab: "settings" }, replace: true }),
          );
          yield* core.back;
          yield* core.forward;
        }),
      );

      assert.deepStrictEqual(eventNames(records), []);
    }),
  );

  it.effect("stays silent when adapter navigation fails", () =>
    Effect.gen(function* () {
      const adapter: NavigationAdapter = {
        read: Effect.succeed({
          path: "/dashboard",
          query: new URLSearchParams(),
          isPopstate: false,
          hash: "",
          scrollKey: "failing-0",
        }),
        push: () => Effect.fail(new NavigationCoreError({ operation: "push", cause: "boom" })),
        replace: () => Effect.void,
        back: Effect.void,
        forward: Effect.void,
      };
      const core = yield* NavigationCore.make({ notifyUnchangedQuery: false }, adapter);
      const records = yield* traceEventsFor(
        core.navigate(navigationTarget("/broken")).pipe(Effect.result, Effect.asVoid),
      );

      assert.deepStrictEqual(eventNames(records), []);
    }),
  );
});

describe("NavigationCore concurrent transitions", () => {
  it.effect("should cancel queued navigation before it acquires the history permit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // Scope: a pending adapter mutation owns the permit while another caller cancels.
        // Assertion: queued cancellation completes before the active mutation releases its permit.
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const memory = yield* NavigationAdapter.makeInMemory("/");
        const applied: Array<string> = [];
        const adapter: NavigationAdapter = {
          ...memory,
          push: (url, state) =>
            Effect.gen(function* () {
              if (url === "/active") {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
              }
              yield* memory.push(url, state);
              applied.push(url);
            }),
        };
        const core = yield* NavigationCore.make({ notifyUnchangedQuery: false }, adapter);
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
        const active = yield* Effect.forkScoped(core.navigate(navigationTarget("/active")));
        yield* Deferred.await(started);
        const queued = yield* Effect.forkScoped(core.navigate(navigationTarget("/canceled")));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(queued);
        assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(queued)));
        assert.deepStrictEqual(applied, []);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(active);
        assert.deepStrictEqual(applied, ["/active"]);
        assert.strictEqual((yield* core.current).navigationId, 1);
      }),
    ),
  );

  it.effect(
    "should retain an applied history mutation when interrupted during snapshot refresh",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          // Scope: history has changed, but reading its resulting snapshot is still suspended.
          // Assertion: interruption remains observable and cannot leave the coordinator on the previous entry.
          const readStarted = yield* Deferred.make<void>();
          const releaseRead = yield* Deferred.make<void>();
          const memory = yield* NavigationAdapter.makeInMemory("/");
          let applied = false;
          const adapter: NavigationAdapter = {
            ...memory,
            push: (url, state) =>
              memory.push(url, state).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    applied = true;
                  }),
                ),
              ),
            read: Effect.gen(function* () {
              if (applied) {
                yield* Deferred.succeed(readStarted, undefined);
                yield* Deferred.await(releaseRead);
              }
              return yield* memory.read;
            }),
          };
          const core = yield* NavigationCore.make({ notifyUnchangedQuery: false }, adapter);
          yield* Effect.addFinalizer(() => Deferred.succeed(releaseRead, undefined));
          const navigation = yield* Effect.forkScoped(
            core.navigate(navigationTarget("/applied?owner=winner")),
          );
          yield* Deferred.await(readStarted);
          const interrupt = yield* Effect.forkScoped(Fiber.interrupt(navigation));
          yield* Effect.yieldNow;
          yield* Deferred.succeed(releaseRead, undefined);
          yield* Fiber.join(interrupt);
          const exit = yield* Fiber.await(navigation);
          assert.isTrue(Exit.hasInterrupts(exit));
          const history = yield* memory.read;
          const snapshot = yield* core.current;
          assert.strictEqual(history.path, "/applied");
          assert.strictEqual(snapshot.path, history.path);
          assert.strictEqual(snapshot.query.toString(), history.query.toString());
          assert.strictEqual(snapshot.scrollKey, history.scrollKey);
          assert.strictEqual(snapshot.navigationId, 1);
        }),
      ),
  );

  it.effect("serializes a slow adapter mutation and commits only the latest snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const history: Array<string> = [];
        let currentUrl = "/";
        const adapter: NavigationAdapter = {
          read: Effect.gen(function* () {
            const { path, query } = yield* parsePath(currentUrl).pipe(
              Effect.mapError(
                (cause) => new NavigationCoreError({ operation: "parsePath", cause }),
              ),
            );
            return {
              path,
              query,
              isPopstate: false,
              hash: "",
              scrollKey: `controlled-${history.length}`,
            };
          }),
          push: (url) =>
            Effect.gen(function* () {
              if (url.startsWith("/slow")) {
                yield* Deferred.succeed(firstStarted, undefined);
                yield* Deferred.await(releaseFirst);
              }
              history.push(url);
              currentUrl = url;
            }),
          replace: () => Effect.void,
          back: Effect.void,
          forward: Effect.void,
        };
        const core = yield* NavigationCore.make({ notifyUnchangedQuery: false }, adapter);
        const slowFiber = yield* Effect.forkScoped(
          Effect.exit(core.navigate(navigationTarget("/slow", { query: { owner: "stale" } }))),
        );
        yield* Deferred.await(firstStarted);
        const winnerFiber = yield* Effect.forkScoped(
          Effect.exit(core.navigate(navigationTarget("/winner", { query: { owner: "latest" } }))),
        );

        yield* Deferred.succeed(releaseFirst, undefined);
        const slowExit = yield* Fiber.join(slowFiber);
        const winnerExit = yield* Fiber.join(winnerFiber);
        const snapshot = yield* core.current;

        assert.isTrue(Exit.isSuccess(slowExit));
        assert.isTrue(Exit.isSuccess(winnerExit));
        assert.deepStrictEqual(history, ["/slow?owner=stale", "/winner?owner=latest"]);
        assert.strictEqual(snapshot.navigationId, 2);
        assert.strictEqual(snapshot.path, "/winner");
        assert.strictEqual(snapshot.query.get("owner"), "latest");
      }),
    ),
  );
});

describe("Router.testLayer NavigationCore delegation", () => {
  it.effect("emits one RouterService-owned semantic navigation sequence", () =>
    Effect.gen(function* () {
      const records = yield* traceEventsFor(
        Effect.gen(function* () {
          const router = yield* Router.Router;
          yield* router.navigate("/users", { query: { tab: "main" } });
        }).pipe(Effect.provide(Router.testLayer("/dashboard"))),
      );
      const semanticNames = eventNames(records).filter((name) =>
        [
          "router.navigate.request",
          "history.push",
          "router.current.set",
          "router.query.set",
          "router.navigate.commit",
          "router.navigate.stateApplied",
        ].includes(name),
      );

      assert.deepStrictEqual(semanticNames, [
        "router.navigate.request",
        "router.current.set",
        "router.query.set",
        "history.push",
        "router.navigate.commit",
        "router.navigate.stateApplied",
      ]);
    }),
  );

  it.effect("does not notify query subscribers when the semantic query is unchanged", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const notifications = yield* Ref.make(0);
      const unsubscribe = yield* Signal.subscribe(router.query, () =>
        Ref.update(notifications, (count) => count + 1),
      );

      yield* router.navigate("/users", { query: { tab: "main" } });

      assert.strictEqual(yield* Ref.get(notifications), 0);
      yield* unsubscribe;
    }).pipe(Effect.provide(Router.testLayer("/dashboard?tab=main"))),
  );

  it.effect(
    "delegates push, replace, back, forward, params, and active checks through the facade",
    () =>
      Effect.gen(function* () {
        const router = yield* Router.Router;
        yield* router.navigate("/users/:id", { params: { id: 1 }, query: { tab: "main" } });
        yield* router.navigate("/users/:id/details", { params: { id: 1 } });
        yield* router.back();
        assert.strictEqual((yield* Signal.get(router.current)).path, "/users/1");
        yield* router.forward();
        assert.strictEqual((yield* Signal.get(router.current)).path, "/users/1/details");

        const active = yield* router.isActive("/users/:id", { params: { id: 1 } });
        assert.isTrue(yield* Signal.get(active));

        yield* router.navigate("/replace-me");
        yield* router.navigate("/replacement", { replace: true });
        yield* router.back();
        assert.strictEqual((yield* Signal.get(router.current)).path, "/users/1/details");
      }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.effect("prevents a slow listener from letting an older route overwrite the winner", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const router = yield* Router.Router;
        const firstListenerStarted = yield* Deferred.make<void>();
        const releaseFirstListener = yield* Deferred.make<void>();
        let notification = 0;
        const unsubscribe = yield* Signal.subscribe(router.current, () =>
          Effect.gen(function* () {
            notification++;
            if (notification !== 1) return;
            yield* Deferred.succeed(firstListenerStarted, undefined);
            yield* Deferred.await(releaseFirstListener);
          }),
        );
        const slowFiber = yield* Effect.forkScoped(
          Effect.exit(router.navigate("/slow", { query: { owner: "stale" } })),
        );
        yield* Deferred.await(firstListenerStarted);
        const winnerFiber = yield* Effect.forkScoped(
          Effect.exit(router.navigate("/winner", { query: { owner: "latest" } })),
        );

        const winnerExit = yield* Fiber.join(winnerFiber);
        const routeWhileStaleListenerIsBlocked = yield* Signal.peek(router.current);
        const queryWhileStaleListenerIsBlocked = yield* Signal.peek(router.query);
        yield* Deferred.succeed(releaseFirstListener, undefined);
        const slowExit = yield* Fiber.join(slowFiber);
        yield* unsubscribe;

        assert.isTrue(Exit.isSuccess(winnerExit));
        assert.isTrue(Exit.isSuccess(slowExit));
        assert.strictEqual(routeWhileStaleListenerIsBlocked.navigation.navigationId, 2);
        assert.strictEqual(routeWhileStaleListenerIsBlocked.path, "/winner");
        assert.strictEqual(routeWhileStaleListenerIsBlocked.query.get("owner"), "latest");
        assert.strictEqual(queryWhileStaleListenerIsBlocked.get("owner"), "latest");
      }).pipe(Effect.provide(Router.testLayer("/"))),
    ),
  );
});
