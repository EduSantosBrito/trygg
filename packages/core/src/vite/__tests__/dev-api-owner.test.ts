import { assert, describe, it } from "@effect/vitest";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { ApiInitError, DevPlatform, type HandlerFactory } from "../dev-platform.js";
import * as NodeDevPlatform from "../dev-platform-node.js";
import * as BunDevPlatform from "../dev-platform-bun.js";

const emptyApiLayer: Layer.Layer<unknown> = Layer.succeedContext(
  Context.makeUnsafe<unknown>(new Map()),
);

const platforms = [
  { name: "Node", layer: NodeDevPlatform.layer },
  { name: "Bun", layer: BunDevPlatform.layer },
];

describe("development API owner admission", () => {
  for (const platform of platforms) {
    it.effect(
      `should preserve ${platform.name} acquisition failure together with failed cleanup`,
      () =>
        Effect.gen(function* () {
          // Scope: handler acquisition fails after registering a finalizer that also fails.
          // Assertion: both the typed initialization error and the cleanup defect reach the caller.
          const dev = yield* DevPlatform;
          const failure = new ApiInitError({ message: "acquisition failed" });
          const acquire = Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Effect.failCause(Cause.die("cleanup failed")));
            return yield* failure;
          });
          const factory: HandlerFactory = {
            makeApiLayer: () => Effect.succeed(emptyApiLayer),
            makeNodeHandler: () => acquire,
            makeWebHandler: () => acquire,
          };
          const exit = yield* dev
            .makeApi({
              handlerFactory: factory,
              loadApiModule: () => Effect.succeed({}),
              onError: () => Effect.void,
            })
            .pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            const failures = exit.cause.reasons.filter(Cause.isFailReason);
            const defects = exit.cause.reasons.filter(Cause.isDieReason);
            assert.strictEqual(failures.length, 1);
            assert.strictEqual(failures[0]?.error.cause, failure);
            assert.deepStrictEqual(
              defects.map((reason) => reason.defect),
              ["cleanup failed"],
            );
          }
        }).pipe(Effect.provide(platform.layer), Effect.scoped),
    );

    it.effect(`should reject initial ${platform.name} API creation under a closed owner`, () =>
      Effect.gen(function* () {
        // Scope: a stale caller supplies an already-closed acquisition Scope.
        // Assertion: no module or handler work begins and creation interrupts.
        const dev = yield* DevPlatform;
        const owner = yield* Scope.make();
        yield* Scope.close(owner, Exit.void);
        let loads = 0;
        let acquired = 0;
        const factory: HandlerFactory = {
          makeApiLayer: () => Effect.succeed(emptyApiLayer),
          makeNodeHandler: () =>
            Effect.sync(() => {
              acquired++;
              return { handler: () => {}, dispose: Effect.void };
            }),
          makeWebHandler: () =>
            Effect.sync(() => {
              acquired++;
              return { handler: () => Promise.resolve(new Response()), dispose: Effect.void };
            }),
        };
        const exit = yield* dev
          .makeApi({
            handlerFactory: factory,
            loadApiModule: () =>
              Effect.sync(() => {
                loads++;
                return {};
              }),
            onError: () => Effect.void,
          })
          .pipe(Scope.provide(owner), Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
        assert.strictEqual(loads, 0);
        assert.strictEqual(acquired, 0);
      }).pipe(Effect.provide(platform.layer), Effect.scoped),
    );

    it.effect(`should reject retained ${platform.name} reload after owner shutdown`, () =>
      Effect.gen(function* () {
        // Scope: the handle escapes its server/API Scope and is invoked after disposal.
        // Assertion: reload interrupts without importing or acquiring another generation.
        const dev = yield* DevPlatform;
        const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        let loads = 0;
        let acquisitions = 0;
        let releases = 0;
        const acquire = Effect.sync(() => {
          acquisitions++;
        });
        const dispose = Effect.sync(() => {
          releases++;
        });
        const factory: HandlerFactory = {
          makeApiLayer: () => Effect.succeed(emptyApiLayer),
          makeNodeHandler: () => acquire.pipe(Effect.as({ handler: () => {}, dispose })),
          makeWebHandler: () =>
            acquire.pipe(Effect.as({ handler: () => Promise.resolve(new Response()), dispose })),
        };
        const handle = yield* dev
          .makeApi({
            handlerFactory: factory,
            loadApiModule: () =>
              Effect.sync(() => {
                loads++;
                return {};
              }),
            onError: () => Effect.void,
          })
          .pipe(Scope.provide(owner));
        yield* Scope.close(owner, Exit.void);
        const exit = yield* Effect.exit(handle.reload);
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
        assert.strictEqual(loads, 1);
        assert.strictEqual(acquisitions, 1);
        assert.strictEqual(releases, 1);
      }).pipe(Effect.provide(platform.layer), Effect.scoped),
    );

    it.effect.each(["import", "composition", "handler"])(
      `should not publish a ${platform.name} reload resumed after shutdown during %s`,
      (stage) =>
        Effect.gen(function* () {
          // Scope: the caller-owned reload is suspended inside a candidate acquisition phase.
          // Assertion: shutdown wins, the resumed candidate cannot publish, and releases match acquisitions.
          const dev = yield* DevPlatform;
          const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
            Scope.close(scope, Exit.void),
          );
          const suspended = yield* Deferred.make<void>();
          const resume = yield* Deferred.make<void>();
          let loads = 0;
          let acquisitions = 0;
          let releases = 0;
          const pause = (phase: string) =>
            loads === 2 && stage === phase
              ? Deferred.succeed(suspended, undefined).pipe(Effect.andThen(Deferred.await(resume)))
              : Effect.void;
          const acquire = Effect.gen(function* () {
            yield* pause("handler");
            acquisitions++;
          });
          const dispose = Effect.sync(() => {
            releases++;
          });
          const factory: HandlerFactory = {
            makeApiLayer: () => pause("composition").pipe(Effect.as(emptyApiLayer)),
            makeNodeHandler: () => acquire.pipe(Effect.as({ handler: () => {}, dispose })),
            makeWebHandler: () =>
              acquire.pipe(Effect.as({ handler: () => Promise.resolve(new Response()), dispose })),
          };
          const handle = yield* dev
            .makeApi({
              handlerFactory: factory,
              loadApiModule: () =>
                Effect.gen(function* () {
                  loads++;
                  yield* pause("import");
                  return {};
                }),
              onError: () => Effect.void,
            })
            .pipe(Scope.provide(owner));
          const reloading = yield* handle.reload.pipe(Effect.forkScoped);
          yield* Deferred.await(suspended);
          yield* Scope.close(owner, Exit.void);
          yield* Deferred.succeed(resume, undefined);
          const exit = yield* Fiber.await(reloading);
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
          assert.strictEqual(releases, acquisitions);
          if (stage !== "handler") assert.strictEqual(acquisitions, 1);
        }).pipe(Effect.provide(platform.layer), Effect.scoped),
    );
  }
});
