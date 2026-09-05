import { assert, describe } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scheduler, Scope } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { ViteServer, type ViteServerSource } from "../plugin.js";

describe("Vite callback ownership", () => {
  scoped("should preserve the configured Scheduler inside a watcher callback", () =>
    Effect.gen(function* () {
      // Scope: crossing the native watcher boundary must retain the owner's runtime services.
      // Assertion: the callback sees the configured Scheduler, including after a yield.
      const scheduler = new Scheduler.MixedScheduler("async");
      const observed = yield* Deferred.make<Scheduler.Scheduler>();
      let listener: ((file: string) => void) | undefined;
      const source: ViteServerSource = {
        ssrLoadModule: () => Promise.resolve({}),
        transformIndexHtml: (_url, html) => Promise.resolve(html),
        middlewares: { use: () => {} },
        watcher: {
          on: (_event, callback) => {
            listener = callback;
          },
          off: () => {},
        },
      };
      yield* ViteServer.make(source)
        .onFileChange(
          () =>
            Effect.yieldNow.pipe(
              Effect.andThen(Scheduler.Scheduler),
              Effect.flatMap((value) => Deferred.succeed(observed, value)),
              Effect.asVoid,
            ),
          () => Effect.void,
        )
        .pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
      assert.isDefined(listener);
      listener?.("app/api.ts");
      assert.strictEqual(yield* Deferred.await(observed), scheduler);
    }),
  );

  scoped("should reject watcher admission while an earlier owner finalizer is draining", () =>
    Effect.gen(function* () {
      // Scope: a queued native event can arrive after shutdown starts but before listener removal.
      // Assertion: neither handler construction nor execution occurs while draining or after closure.
      const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const draining = yield* Deferred.make<void>();
      const allowClose = yield* Deferred.make<void>();
      let listener: ((file: string) => void) | undefined;
      let constructed = 0;
      let executed = 0;
      const source: ViteServerSource = {
        ssrLoadModule: () => Promise.resolve({}),
        transformIndexHtml: (_url, html) => Promise.resolve(html),
        middlewares: { use: () => {} },
        watcher: {
          on: (_event, callback) => {
            listener = callback;
          },
          off: () => {},
        },
      };
      yield* ViteServer.make(source)
        .onFileChange(
          () => {
            constructed++;
            return Effect.sync(() => {
              executed++;
            });
          },
          () => Effect.void,
        )
        .pipe(Scope.provide(owner));
      yield* Scope.addFinalizer(
        owner,
        Deferred.succeed(draining, undefined).pipe(Effect.andThen(Deferred.await(allowClose))),
      );
      const closing = yield* Scope.close(owner, Exit.void).pipe(Effect.forkScoped);
      yield* Deferred.await(draining);
      assert.isDefined(listener);
      listener?.("app/api.ts");
      yield* Deferred.succeed(allowClose, undefined);
      yield* Fiber.join(closing);
      listener?.("app/api.ts");
      assert.strictEqual(constructed, 0);
      assert.strictEqual(executed, 0);
    }),
  );

  scoped("should await watcher finalization when the handler reenters owner shutdown", () =>
    Effect.gen(function* () {
      // Scope: the first watcher instruction closes the server's callback owner.
      // Assertion: shutdown removes admission and cannot finish before that callback's release.
      const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const services = yield* Effect.context();
      const releasing = yield* Deferred.make<void>();
      const allowRelease = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      let closing: Fiber.Fiber<void> | undefined;
      let listener: ((file: string) => void) | undefined;
      let removed = 0;
      const source: ViteServerSource = {
        ssrLoadModule: () => Promise.resolve({}),
        transformIndexHtml: (_url, html) => Promise.resolve(html),
        middlewares: { use: () => {} },
        watcher: {
          on: (_event, callback) => {
            listener = callback;
          },
          off: () => {
            removed++;
          },
        },
      };
      yield* ViteServer.make(source)
        .onFileChange(
          () =>
            Effect.acquireRelease(
              Effect.sync(() => {
                closing = Effect.runForkWith(services)(Scope.close(owner, Exit.void));
              }),
              () =>
                Deferred.succeed(releasing, undefined).pipe(
                  Effect.andThen(Deferred.await(allowRelease)),
                  Effect.andThen(Deferred.succeed(released, undefined)),
                ),
            ).pipe(Effect.andThen(Effect.never), Effect.scoped),
          () => Effect.void,
        )
        .pipe(Scope.provide(owner));
      assert.isDefined(listener);
      listener?.("app/api.ts");
      yield* Deferred.await(releasing);
      const pendingBeforeRelease = closing?.pollUnsafe() === undefined;
      const removedBeforeRelease = removed;
      yield* Deferred.succeed(allowRelease, undefined);
      yield* Deferred.await(released);
      assert.isDefined(closing);
      if (closing !== undefined) yield* Fiber.join(closing);
      assert.strictEqual(removedBeforeRelease, 1);
      assert.isTrue(pendingBeforeRelease);
    }),
  );
});
