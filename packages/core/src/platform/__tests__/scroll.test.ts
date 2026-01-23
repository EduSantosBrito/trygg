/**
 * Scroll Service Tests
 *
 * Tests the in-memory test layer for Scroll.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Scroll, test as scrollTest } from "../scroll.js";

describe("Scroll", () => {
  it.effect("getPosition defaults to 0,0", () =>
    Effect.gen(function* () {
      const scroll = yield* Scroll;
      const pos = yield* scroll.getPosition;
      assert.deepStrictEqual(pos, { x: 0, y: 0 });
    }).pipe(Effect.provide(scrollTest)),
  );

  it.effect("scrollTo updates position", () =>
    Effect.gen(function* () {
      const scroll = yield* Scroll;
      yield* scroll.scrollTo(100, 200);
      const pos = yield* scroll.getPosition;
      assert.deepStrictEqual(pos, { x: 100, y: 200 });
    }).pipe(Effect.provide(scrollTest)),
  );

  it.effect("scrollTo(0,0) resets position", () =>
    Effect.gen(function* () {
      const scroll = yield* Scroll;
      yield* scroll.scrollTo(50, 75);
      yield* scroll.scrollTo(0, 0);
      const pos = yield* scroll.getPosition;
      assert.deepStrictEqual(pos, { x: 0, y: 0 });
    }).pipe(Effect.provide(scrollTest)),
  );

  it.effect("scrollIntoView is no-op in test layer", () =>
    Effect.gen(function* () {
      const scroll = yield* Scroll;
      // Should not throw — just a no-op
      yield* scroll.scrollIntoView({} as Element);
      const pos = yield* scroll.getPosition;
      assert.deepStrictEqual(pos, { x: 0, y: 0 });
    }).pipe(Effect.provide(scrollTest)),
  );

  it.effect("handles negative coordinates", () =>
    Effect.gen(function* () {
      const scroll = yield* Scroll;
      yield* scroll.scrollTo(-10, -20);
      const pos = yield* scroll.getPosition;
      assert.deepStrictEqual(pos, { x: -10, y: -20 });
    }).pipe(Effect.provide(scrollTest)),
  );

  it.effect("handles large coordinates", () =>
    Effect.gen(function* () {
      const scroll = yield* Scroll;
      yield* scroll.scrollTo(99999, 88888);
      const pos = yield* scroll.getPosition;
      assert.deepStrictEqual(pos, { x: 99999, y: 88888 });
    }).pipe(Effect.provide(scrollTest)),
  );
});
