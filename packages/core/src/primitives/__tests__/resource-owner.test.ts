import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Trace from "../../trace/index.js";
import * as Resource from "../resource.js";
import * as Signal from "../signal.js";

describe("resource worker ownership", () => {
  it.effect("should publish an already cached reactive value before fetch returns", () =>
    Effect.gen(function* () {
      // Scope: starting an owned daemon must retain cached reactive fetch ordering.
      // Assertion: a cache hit returns its value without an intermediate observable Pending state.
      const registry = yield* Resource.ResourceRegistryTag;
      const entry = yield* registry.getOrCreate("cached");
      yield* Signal.set(entry.state, Resource.Success("cached value"));
      const factory = Resource.make(
        (_params: { id: string }) => Effect.succeed("unexpected fetch"),
        { key: (_params: { id: string }) => "cached" },
      );
      const output = yield* Resource.fetch(factory, { id: "one" });
      const state = yield* Signal.peek(output);
      assert.isTrue(Resource.isSuccess(state));
      if (Resource.isSuccess(state)) assert.strictEqual(state.value, "cached value");
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer()), Effect.scoped),
  );

  it.effect("should remove the daemon subscription before reentrant render shutdown finishes", () =>
    Effect.gen(function* () {
      // Scope: the subscription's trace observer closes the render owner during registration.
      // Assertion: shutdown observes zero retained entry listeners before reporting completion.
      const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const services = yield* Effect.context();
      const registry = yield* Resource.ResourceRegistryTag;
      const entry = yield* registry.getOrCreate("daemon");
      yield* Signal.set(entry.state, Resource.Success("cached value"));
      const factory = Resource.make(
        (_params: { id: string }) => Effect.succeed("unexpected fetch"),
        { key: (_params: { id: string }) => "daemon" },
      );
      let listenersAtClose: number | undefined;
      let closing: Fiber.Fiber<void> | undefined;
      const reader = Trace.makeRecordReader();
      const logger = reader.register(
        Logger.make<unknown, void>((options) => {
          const record = reader.read(options);
          if (
            closing === undefined &&
            record?.name === "signal.subscribe" &&
            record.payload?.signal_id === entry.state._debugId
          ) {
            closing = Effect.runForkWith(services)(
              Scope.close(owner, Exit.void).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    listenersAtClose = entry.state._listeners.size;
                  }),
                ),
              ),
            );
          }
        }),
      );
      yield* Resource.fetch(factory, { id: "one" }).pipe(
        Scope.provide(owner),
        Effect.provideService(Signal.CurrentRenderScope, owner),
        Effect.provideService(References.MinimumLogLevel, "Trace"),
        Effect.provide(Logger.layer([logger])),
      );
      yield* Effect.yieldNow;
      assert.isDefined(closing);
      if (closing !== undefined) yield* Fiber.join(closing);
      assert.strictEqual(listenersAtClose, 0);
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer()), Effect.scoped),
  );

  it.effect("should await reactive fetch release when its first instruction clears its entry", () =>
    Effect.gen(function* () {
      // Scope: user fetch acquisition reenters force-clear before its first suspension.
      // Assertion: clear cannot finish while the fetch's resource release is still blocked.
      const registry = yield* Resource.ResourceRegistryTag;
      const services = yield* Effect.context();
      const releasing = yield* Deferred.make<void>();
      const allowRelease = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      let closing: Fiber.Fiber<void> | undefined;
      const factory = Resource.make(
        (_params: { id: string }) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              closing = Effect.runForkWith(services)(registry.delete("reentrant"));
            }),
            () =>
              Deferred.succeed(releasing, undefined).pipe(
                Effect.andThen(Deferred.await(allowRelease)),
                Effect.andThen(Deferred.succeed(released, undefined)),
              ),
          ).pipe(Effect.andThen(Effect.never), Effect.scoped),
        { key: (_params: { id: string }) => "reentrant" },
      );
      const fetching = yield* Resource.fetch(factory, { id: "one" }).pipe(Effect.forkScoped);
      yield* Deferred.await(releasing);
      const pendingBeforeRelease = closing?.pollUnsafe() === undefined;
      yield* Deferred.succeed(allowRelease, undefined);
      yield* Deferred.await(released);
      assert.isDefined(closing);
      if (closing !== undefined) yield* Fiber.join(closing);
      yield* Fiber.join(fetching);
      assert.isTrue(pendingBeforeRelease);
    }).pipe(Effect.provide(Resource.ResourceRegistry.layer()), Effect.scoped),
  );
});
