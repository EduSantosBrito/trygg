import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import * as Resource from "../resource.js";

describe("resource expiration ordering", () => {
  it.effect("should expire a newer entry on time after the wall clock moves backward", () =>
    Effect.gen(function* () {
      // Scope: LRU order is not expiration order when Clock moves backward.
      // Assertion: an earlier-expiring newer entry closes while the older live entry remains.
      const registry = yield* Resource.ResourceRegistryTag;
      yield* TestClock.setTime(100);
      const older = yield* registry.getOrCreate("older");
      yield* TestClock.setTime(0);
      const newer = yield* registry.getOrCreate("newer");
      yield* TestClock.setTime(10);
      yield* registry.get("missing");
      assert.isTrue(yield* Ref.get(newer.state._disposed));
      assert.isFalse(yield* Ref.get(older.state._disposed));
      assert.isTrue(Option.isNone(yield* registry.get("newer")));
    }).pipe(
      Effect.provide(Resource.ResourceRegistry.layer({ capacity: 2, timeToLive: 10 })),
      Effect.scoped,
    ),
  );

  it.effect.each(["get", "getOrCreate"])(
    "should preserve a renewed deadline through %s while expiring an untouched sibling",
    (operation) =>
      Effect.gen(function* () {
        // Scope: renewing one entry leaves an earlier expired deadline from another entry.
        // Assertion: only the untouched entry expires first, then the renewed entry expires exactly on time.
        const registry = yield* Resource.ResourceRegistryTag;
        yield* TestClock.setTime(0);
        const first = yield* registry.getOrCreate("first");
        const second = yield* registry.getOrCreate("second");
        yield* TestClock.setTime(5);
        if (operation === "get") yield* registry.get("first");
        else yield* registry.getOrCreate("first");
        yield* TestClock.setTime(10);
        yield* registry.get("missing");
        assert.isTrue(yield* Ref.get(second.state._disposed));
        assert.isFalse(yield* Ref.get(first.state._disposed));
        yield* TestClock.setTime(14);
        yield* registry.get("missing");
        assert.isFalse(yield* Ref.get(first.state._disposed));
        yield* TestClock.setTime(15);
        yield* registry.get("missing");
        assert.isTrue(yield* Ref.get(first.state._disposed));
      }).pipe(
        Effect.provide(Resource.ResourceRegistry.layer({ capacity: 2, timeToLive: 10 })),
        Effect.scoped,
      ),
  );
});
