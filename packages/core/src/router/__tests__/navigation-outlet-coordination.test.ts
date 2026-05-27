import { describe, expect, it } from "vitest";
import { Effect, Option, Ref } from "effect";
import { unsafeEraseR } from "../../internal/unsafe.js";
import { makeNavigationOutletCoordination } from "../navigation-outlet-coordination.js";

describe("NavigationOutletCoordination", () => {
  const makeCoordination = makeNavigationOutletCoordination({ replayLatestPrefetchState: true });

  it("keeps prefetch idle before activation", async () => {
    const result = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const coordination = yield* makeCoordination;
          yield* coordination.prefetch("/idle");
          return yield* coordination.prefetchState;
        }),
      ),
    );

    expect(result._tag).toBe("Idle");
  });

  it("uses the active prefetch resolver after activation", async () => {
    const calls = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const coordination = yield* makeCoordination;
          const callsRef = yield* Ref.make<Array<string>>([]);
          yield* coordination.activatePrefetch((path) => Ref.update(callsRef, (paths) => [...paths, path]));
          yield* coordination.prefetch("/active");
          return yield* Ref.get(callsRef);
        }),
      ),
    );

    expect(calls).toEqual(["/active"]);
  });

  it("uses the latest resolver after replacement", async () => {
    const calls = await Effect.runPromise(
      unsafeEraseR(
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
          return yield* Ref.get(callsRef);
        }),
      ),
    );

    expect(calls).toEqual(["second:/replaced"]);
  });

  it("consumes scroll intent once", async () => {
    const [first, second] = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const coordination = yield* makeCoordination;
          yield* coordination.publishScrollIntent({
            isPopstate: true,
            hash: "#docs",
            scrollKey: "nav-1",
          });
          const first = yield* coordination.takeScrollIntent;
          const second = yield* coordination.takeScrollIntent;
          return [first, second] as const;
        }),
      ),
    );

    expect(Option.getOrUndefined(first)).toEqual({
      isPopstate: true,
      hash: "#docs",
      scrollKey: "nav-1",
    });
    expect(Option.isNone(second)).toBe(true);
  });
});
