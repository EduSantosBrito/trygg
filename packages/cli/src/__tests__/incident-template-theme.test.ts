import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Option, Scope } from "effect";
import * as Logger from "effect/Logger";
import { Signal } from "trygg";
import { AppTheme, ThemeBrowser } from "../../templates/incident/app/services/theme";

describe("incident theme callback ownership", () => {
  it.effect(
    "should report a live media callback read failure once without escaping to the host",
    () =>
      Effect.gen(function* () {
        // Scope: a successfully acquired ThemeBrowser host starts throwing during later media delivery.
        // Assertion: delivery succeeds, one error is reported, and the last valid theme stays visible.
        let listener: (() => void) | undefined;
        let failReads = false;
        const messages: Array<unknown> = [];
        const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
          if (logLevel === "Error") messages.push(message);
        });
        const browser = ThemeBrowser.layer({
          readCookies: () => "",
          writeCookie: () => {},
          matchMedia: () => ({
            get matches() {
              if (failReads) {
                // oxlint-disable-next-line effect/no-raw-throw -- Exercises native media property failure after acquisition.
                throw "media-read-failure";
              }
              return false;
            },
            addChangeListener: (callback) => {
              listener = callback;
            },
            removeChangeListener: () => {},
          }),
        });
        yield* Effect.gen(function* () {
          const theme = yield* AppTheme;
          assert.isDefined(listener);
          failReads = true;
          const exit = yield* Effect.exit(Effect.sync(() => listener?.()));
          assert.isTrue(Exit.isSuccess(exit));
          yield* Effect.yieldNow;
          assert.strictEqual(messages.length, 1);
          assert.strictEqual(yield* Signal.peek(theme.mode), "light");
        }).pipe(
          Effect.provide(
            AppTheme.layer("dark").pipe(
              Layer.provide(browser),
              Layer.provideMerge(Logger.layer([logger])),
            ),
          ),
        );
      }),
  );

  it.effect("should await media callback release when its browser service initiates shutdown", () =>
    Effect.gen(function* () {
      // Scope: the callback's first system-theme read reenters the Layer's owner shutdown.
      // Assertion: listener admission stops and shutdown awaits the active read's finalizer.
      const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const services = yield* Effect.context();
      const releasing = yield* Deferred.make<void>();
      const allowRelease = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      let closing: Fiber.Fiber<void> | undefined;
      let listener: (() => void) | undefined;
      let reads = 0;
      let removed = 0;
      const browser = Layer.succeed(ThemeBrowser, {
        readCookies: Effect.succeed(""),
        writeCookie: () => Effect.void,
        systemDark: Effect.suspend(() => {
          if (reads++ === 0) return Effect.succeed(Option.some(false));
          return Effect.acquireRelease(
            Effect.sync(() => {
              closing = Effect.runForkWith(services)(Scope.close(owner, Exit.void));
            }),
            () =>
              Deferred.succeed(releasing, undefined).pipe(
                Effect.andThen(Deferred.await(allowRelease)),
                Effect.andThen(Deferred.succeed(released, undefined)),
              ),
          ).pipe(Effect.andThen(Effect.never), Effect.scoped);
        }),
        subscribeSystemTheme: (callback) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              listener = callback;
            }),
            () =>
              Effect.sync(() => {
                removed++;
              }),
          ),
      });
      yield* Layer.buildWithScope(AppTheme.layer("dark").pipe(Layer.provide(browser)), owner);
      assert.isDefined(listener);
      listener?.();
      yield* Deferred.await(releasing);
      const pendingBeforeRelease = closing?.pollUnsafe() === undefined;
      const removedBeforeRelease = removed;
      yield* Deferred.succeed(allowRelease, undefined);
      yield* Deferred.await(released);
      assert.isDefined(closing);
      if (closing !== undefined) yield* Fiber.join(closing);
      assert.strictEqual(removedBeforeRelease, 1);
      assert.isTrue(pendingBeforeRelease);
      listener?.();
      assert.strictEqual(reads, 2);
    }).pipe(Effect.scoped),
  );
});
