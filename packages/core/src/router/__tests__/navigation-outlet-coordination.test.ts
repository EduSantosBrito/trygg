import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";
import { makeNavigationOutletCoordination } from "../navigation-outlet-coordination.js";

describe("NavigationOutletCoordination", () => {
  const makeCoordination = makeNavigationOutletCoordination({ replayLatestPrefetchState: true });

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

  it.effect("consumes scroll intent once", () =>
    Effect.gen(function* () {
      const coordination = yield* makeCoordination;
      yield* coordination.publishScrollIntent({
        isPopstate: true,
        hash: "#docs",
        scrollKey: "nav-1",
      });
      const first = yield* coordination.takeScrollIntent;
      const second = yield* coordination.takeScrollIntent;

      assert.deepStrictEqual(Option.getOrUndefined(first), {
        isPopstate: true,
        hash: "#docs",
        scrollKey: "nav-1",
      });
      assert.isTrue(Option.isNone(second));
    }),
  );
});
