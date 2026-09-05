import { assert, describe, it } from "@effect/vitest";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Match, Schema, Scope } from "effect";
import { browser as domBrowser } from "../../platform/dom.js";
import { browser as eventTargetBrowser } from "../../platform/event-target.js";
import { History, browser as historyBrowser } from "../../platform/history.js";
import { Location, browser as locationBrowser } from "../../platform/location.js";
import { test as observerTest } from "../../platform/observer.js";
import { test as scrollTest } from "../../platform/scroll.js";
import { sessionStorageTest } from "../../platform/storage.js";
import * as Signal from "../../primitives/signal.js";
import * as Router from "../service.js";
import * as Trace from "../../trace/index.js";

const reasonValues = (cause: Cause.Cause<unknown>) =>
  cause.reasons.map((reason) =>
    Match.value(reason).pipe(
      Match.tag("Fail", (reason) => [reason._tag, reason.error]),
      Match.tag("Die", (reason) => [reason._tag, reason.defect]),
      Match.tag("Interrupt", (reason) => [reason._tag, reason.fiberId]),
      Match.exhaustive,
    ),
  );

describe("Router publication ownership", () => {
  for (const [name, cause] of [
    ["defect", Cause.combine(Cause.fail("listener-failure"), Cause.die("listener-defect"))],
    ["interruption", Cause.combine(Cause.fail("listener-failure"), Cause.interrupt(52))],
  ] satisfies ReadonlyArray<readonly [string, Cause.Cause<string>]>) {
    it.effect(`should preserve the publication listener's mixed ${name} Cause for its caller`, () =>
      Effect.gen(function* () {
        // Scope: terminal listener results cross the owned publication fiber and the navigate boundary.
        // Assertion: all reasons reach the caller unchanged, while the committed state remains applied.
        const router = yield* Router.Router;
        const unsubscribe = yield* Signal.subscribe(router.current, () => Effect.failCause(cause));
        const recorder = Trace.makeRecorder();
        const exit = yield* Effect.exit(Trace.record(router.navigate("/applied"), recorder));
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          // Named Effect operations may append stack annotations without replacing any reason.
          assert.deepStrictEqual(reasonValues(exit.cause), reasonValues(cause));
        }
        assert.strictEqual((yield* Signal.get(router.current)).path, "/applied");
        const reports = recorder.records().filter((record) => record.name === "router.error");
        assert.strictEqual(reports.length, 1);
        assert.strictEqual(reports[0]?.payload?.operation, "publication");
        assert.strictEqual(reports[0]?.payload?.navigation_id, 1);
        assert.notInclude(Trace.toMarkdown(reports), "listener-failure");
        assert.notInclude(Trace.toMarkdown(reports), "listener-defect");
        yield* unsubscribe;
      }).pipe(Effect.provide(Router.testLayer("/"))),
    );
  }

  it.effect(
    "should keep publication owned by Router after caller cancellation and await its cleanup",
    () =>
      Effect.gen(function* () {
        // Scope: cancellation of a caller and closure of the Layer are distinct ownership events.
        // Assertion: the caller exits promptly; Layer closure interrupts and awaits the listener finalizer.
        const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        const services = yield* Layer.buildWithScope(Router.testLayer("/"), owner);
        const router = Context.get(services, Router.Router);
        const listenerStarted = yield* Deferred.make<void>();
        const cleanupStarted = yield* Deferred.make<void>();
        const releaseCleanup = yield* Deferred.make<void>();
        let cleaned = 0;
        const unsubscribe = yield* Signal.subscribe(router.current, () =>
          Deferred.succeed(listenerStarted, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Deferred.succeed(cleanupStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseCleanup)),
                Effect.andThen(
                  Effect.sync(() => {
                    cleaned++;
                  }),
                ),
              ),
            ),
          ),
        );
        const navigation = yield* Effect.forkScoped(router.navigate("/applied"));
        yield* Deferred.await(listenerStarted);
        yield* Fiber.interrupt(navigation);
        const exit = yield* Fiber.await(navigation);
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
        assert.isFalse(yield* Deferred.isDone(cleanupStarted));
        assert.strictEqual((yield* Signal.get(router.current)).path, "/applied");

        const closing = yield* Effect.forkScoped(Scope.close(owner, Exit.void));
        yield* Deferred.await(cleanupStarted);
        const wasClosing = closing.pollUnsafe() === undefined;
        const beforeRelease = cleaned;
        yield* Deferred.succeed(releaseCleanup, undefined);
        yield* Fiber.join(closing);
        yield* unsubscribe;
        assert.isTrue(wasClosing);
        assert.strictEqual(beforeRelease, 0);
        assert.strictEqual(cleaned, 1);
        assert.strictEqual(router.current._listeners.size, 0);
      }),
  );

  it.effect(
    "should let a publication listener navigate again without holding the history permit",
    () =>
      Effect.gen(function* () {
        // Scope: publication reenters the actual Router while the first caller awaits its result.
        // Assertion: nested navigation finishes and its route/query/version remain the winner.
        const router = yield* Router.Router;
        const unsubscribe = yield* Signal.subscribe(router.current, () =>
          Effect.gen(function* () {
            const current = yield* Signal.peek(router.current);
            if (current.path === "/first") yield* router.navigate("/winner?owner=nested");
          }),
        );
        yield* router.navigate("/first");
        const current = yield* Signal.get(router.current);
        assert.strictEqual(current.path, "/winner");
        assert.strictEqual(current.query.get("owner"), "nested");
        assert.strictEqual(current.navigation.navigationId, 2);
        yield* unsubscribe;
      }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.effect(
    "should publish applied browser history when its caller cancels during reconciliation",
    () =>
      Effect.gen(function* () {
        // Scope: actual browser Router, History, and Location; pause only the post-mutation read.
        // Assertion: cancellation remains interruption, while route/query/version match applied history.
        const history = yield* History;
        const location = yield* Location;
        const originalPath = yield* location.fullPath;
        const originalState = yield* history.state;
        const originalRestoration = window.history.scrollRestoration;
        yield* Effect.addFinalizer(() =>
          history.replaceState(originalState, originalPath).pipe(
            Effect.andThen(history.setScrollRestoration(originalRestoration)),
            Effect.exit,
            Effect.tap((exit) => Effect.sync(() => assert.isTrue(Exit.isSuccess(exit)))),
          ),
        );
        yield* history.replaceState(null, "/before?tab=old");

        const readStarted = yield* Deferred.make<void>();
        const releaseRead = yield* Deferred.make<void>();
        let paused = false;
        const controlledLocation = Layer.succeed(Location, {
          ...location,
          fullPath: Effect.gen(function* () {
            const path = yield* location.fullPath;
            if (!paused && path === "/applied?tab=new#section") {
              paused = true;
              yield* Deferred.succeed(readStarted, undefined);
              yield* Deferred.await(releaseRead);
            }
            return path;
          }),
        });
        const routerLayer = Router.browserLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              domBrowser,
              eventTargetBrowser,
              historyBrowser,
              controlledLocation,
              observerTest,
              scrollTest,
              sessionStorageTest,
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const router = yield* Router.Router;
          const published = yield* Deferred.make<void>();
          const unsubscribe = yield* Signal.subscribe(router.current, () =>
            Deferred.succeed(published, undefined).pipe(Effect.asVoid),
          );
          const navigation = yield* Effect.forkScoped(
            router.navigate("/applied?tab=new#section", { replace: true }),
          );
          yield* Deferred.await(readStarted);
          const cancellation = yield* Effect.forkScoped(Fiber.interrupt(navigation));
          yield* Effect.yieldNow;
          yield* Deferred.succeed(releaseRead, undefined);
          yield* Fiber.join(cancellation);
          const exit = yield* Fiber.await(navigation);
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));

          yield* Deferred.await(published);
          yield* unsubscribe;

          const current = yield* Signal.get(router.current);
          const query = yield* Signal.get(router.query);
          const state = yield* history.state.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.Struct({ _scrollKey: Schema.String })),
            ),
          );
          assert.strictEqual(yield* location.fullPath, "/applied?tab=new#section");
          assert.strictEqual(current.path, "/applied");
          assert.strictEqual(current.query.toString(), "tab=new");
          assert.strictEqual(query.toString(), "tab=new");
          assert.deepStrictEqual(current.navigation, {
            navigationId: 1,
            isPopstate: false,
            hash: "#section",
            scrollKey: state._scrollKey,
          });
        }).pipe(
          Effect.ensuring(Deferred.succeed(releaseRead, undefined)),
          Effect.provide(routerLayer),
        );
      }).pipe(Effect.provide(Layer.mergeAll(historyBrowser, locationBrowser))),
  );
});
