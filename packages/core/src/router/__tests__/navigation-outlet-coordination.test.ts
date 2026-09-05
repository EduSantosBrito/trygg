import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Ref } from "effect";
import { NavigationOutletCoordination } from "../navigation-outlet-coordination.js";

describe("NavigationOutletCoordination", () => {
  const makeCoordination = NavigationOutletCoordination.make({ replayLatestPrefetchState: true });

  it.effect("keeps prefetch idle before activation", () =>
    Effect.gen(function* () {
      const coordination = yield* makeCoordination;
      yield* coordination.prefetch("/idle");
      const result = yield* coordination.prefetchState;

      assert.strictEqual(result._tag, "Idle");
    }),
  );

  it.effect("uses the active prefetch resolver after activation", () =>
    Effect.gen(function* () {
      const coordination = yield* makeCoordination;
      const callsRef = yield* Ref.make<Array<string>>([]);
      yield* coordination.activatePrefetch((path) =>
        Ref.update(callsRef, (paths) => [...paths, path]),
      );
      yield* coordination.prefetch("/active");
      const calls = yield* Ref.get(callsRef);

      assert.deepStrictEqual(calls, ["/active"]);
    }),
  );

  it.effect("uses the latest resolver after replacement", () =>
    Effect.gen(function* () {
      const coordination = yield* makeCoordination;
      const callsRef = yield* Ref.make<Array<string>>([]);
      yield* coordination.activatePrefetch((path) =>
        Ref.update(callsRef, (paths) => [...paths, `first:${path}`]),
      );
      yield* coordination.activatePrefetch((path) =>
        Ref.update(callsRef, (paths) => [...paths, `second:${path}`]),
      );
      yield* coordination.prefetch("/replaced");
      const calls = yield* Ref.get(callsRef);

      assert.deepStrictEqual(calls, ["second:/replaced"]);
    }),
  );

  it.effect("marks the outlet ready when prefetch activates", () =>
    Effect.gen(function* () {
      const coordination = yield* makeCoordination;
      const ready = yield* coordination.outletReady;

      assert.isFalse(yield* Deferred.isDone(ready));
      yield* coordination.activatePrefetch(() => Effect.void);
      assert.isTrue(yield* Deferred.isDone(ready));
    }),
  );
});
