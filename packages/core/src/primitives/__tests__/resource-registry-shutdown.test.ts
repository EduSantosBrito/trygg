import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Scope,
} from "effect";
import * as Resource from "../resource.js";

const makeOwnedRegistry = Effect.gen(function* () {
  const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const context = yield* Layer.buildWithScope(Resource.ResourceRegistry.layer(), owner);
  return { owner, registry: Context.get(context, Resource.ResourceRegistryTag) };
});

describe("resource registry shutdown", () => {
  it.effect("should hide cached entries after the registry Layer closes", () =>
    Effect.gen(function* () {
      // Scope: a caller retains the service beyond its Layer lifetime.
      // Assertion: lookup cannot expose a disposed cached Signal.
      const { owner, registry } = yield* makeOwnedRegistry;
      yield* registry.getOrCreate("cached");
      yield* Scope.close(owner, Exit.void);
      assert.isTrue(Option.isNone(yield* registry.get("cached")));
    }).pipe(Effect.scoped),
  );

  it.effect("should interrupt new admission after the registry Layer closes", () =>
    Effect.gen(function* () {
      // Scope: a stale service reference attempts to allocate into a closed owner.
      // Assertion: admission terminates with interruption instead of returning a disposed entry.
      const { owner, registry } = yield* makeOwnedRegistry;
      yield* Scope.close(owner, Exit.void);
      const clock = yield* Clock.Clock;
      let clockReads = 0;
      const exit = yield* registry.getOrCreate("late").pipe(
        Effect.provideService(Clock.Clock, {
          ...clock,
          currentTimeMillis: Effect.sync(() => {
            clockReads++;
            return 0;
          }),
        }),
        Effect.exit,
      );
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
      assert.strictEqual(clockReads, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("should reject leases and reads while registry shutdown waits for a release", () =>
    Effect.gen(function* () {
      // Scope: the owner is closed but one entry's finalizer has not completed.
      // Assertion: neither a new lease nor lookup can revive the closing entry.
      const { owner, registry } = yield* makeOwnedRegistry;
      const entry = yield* registry.getOrCreate("closing");
      const releasing = yield* Deferred.make<void>();
      const allowRelease = yield* Deferred.make<void>();
      yield* Scope.addFinalizer(
        entry.scope,
        Deferred.succeed(releasing, undefined).pipe(Effect.andThen(Deferred.await(allowRelease))),
      );
      const closing = yield* Scope.close(owner, Exit.void).pipe(Effect.forkScoped);
      yield* Deferred.await(releasing);
      const acquired = yield* registry.acquire("closing", entry, {});
      const found = yield* registry.get("closing");
      yield* Deferred.succeed(allowRelease, undefined);
      yield* Fiber.join(closing);
      assert.isFalse(acquired);
      assert.isTrue(Option.isNone(found));
    }).pipe(Effect.scoped),
  );

  it.effect("should reject a reserved candidate resumed after its registry closes", () =>
    Effect.gen(function* () {
      // Scope: the caller's Clock suspends after candidate allocation but before cache commit.
      // Assertion: resuming cannot commit or return the already-disposed candidate.
      const { owner, registry } = yield* makeOwnedRegistry;
      const candidateReady = yield* Deferred.make<void>();
      const resumeCandidate = yield* Deferred.make<void>();
      const reads = yield* Ref.make(0);
      const originalClock = yield* Clock.Clock;
      const clock: Clock.Clock = {
        ...originalClock,
        currentTimeMillis: Ref.updateAndGet(reads, (count) => count + 1).pipe(
          Effect.flatMap((read) =>
            read === 2
              ? Deferred.succeed(candidateReady, undefined).pipe(
                  Effect.andThen(Deferred.await(resumeCandidate)),
                  Effect.as(0),
                )
              : Effect.succeed(0),
          ),
        ),
      };
      const candidate = yield* registry
        .getOrCreate("reserved")
        .pipe(Effect.provideService(Clock.Clock, clock), Effect.forkScoped);
      yield* Deferred.await(candidateReady);
      const joining = yield* registry.getOrCreate("reserved").pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* Scope.close(owner, Exit.void);
      const finalJoinExit = yield* Fiber.await(joining);
      yield* Deferred.succeed(resumeCandidate, undefined);
      const exit = yield* Fiber.await(candidate);
      assert.isTrue(Exit.isFailure(finalJoinExit));
      if (Exit.isFailure(finalJoinExit))
        assert.isTrue(Cause.hasInterruptsOnly(finalJoinExit.cause));
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
      assert.isTrue(Option.isNone(yield* registry.get("reserved")));
    }).pipe(Effect.scoped),
  );

  it.effect.each(["static", "reactive"])(
    "should interrupt a %s fetch using a closed registry without executing the source",
    (mode) =>
      Effect.gen(function* () {
        // Scope: the public fetch API receives a registry retained after Layer disposal.
        // Assertion: the fetch terminates with interruption and never executes its source.
        const { owner, registry } = yield* makeOwnedRegistry;
        let fetches = 0;
        const factory = Resource.make(
          (_params: { id: string }) =>
            Effect.sync(() => {
              fetches++;
              return "value";
            }),
          { key: (_params: { id: string }) => "late" },
        );
        yield* Scope.close(owner, Exit.void);
        const fetching =
          mode === "static"
            ? Resource.fetch(factory({ id: "one" }))
            : Resource.fetch(factory, { id: "one" });
        const exit = yield* fetching.pipe(
          Effect.provideService(Resource.ResourceRegistryTag, registry),
          Effect.exit,
        );
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
        assert.strictEqual(fetches, 0);
      }).pipe(Effect.scoped),
  );
});
