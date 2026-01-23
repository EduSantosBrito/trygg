/**
 * History Service Tests
 *
 * Tests the in-memory test layer for History.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { History, test as historyTest } from "../history.js";

describe("History", () => {
  it.effect("initial state is null", () =>
    Effect.gen(function* () {
      const history = yield* History;
      const state = yield* history.state;
      assert.strictEqual(state, null);
    }).pipe(Effect.provide(historyTest)),
  );

  it.effect("pushState adds entry and updates state", () =>
    Effect.gen(function* () {
      const history = yield* History;
      yield* history.pushState({ page: 1 }, "/page-1");
      const state = yield* history.state;
      assert.deepStrictEqual(state, { page: 1 });
    }).pipe(Effect.provide(historyTest)),
  );

  it.effect("replaceState updates current entry", () =>
    Effect.gen(function* () {
      const history = yield* History;
      yield* history.pushState({ page: 1 }, "/page-1");
      yield* history.replaceState({ page: 1, replaced: true }, "/page-1-replaced");
      const state = yield* history.state;
      assert.deepStrictEqual(state, { page: 1, replaced: true });
    }).pipe(Effect.provide(historyTest)),
  );

  it.effect("back decrements index", () =>
    Effect.gen(function* () {
      const history = yield* History;
      yield* history.pushState({ page: 1 }, "/page-1");
      yield* history.pushState({ page: 2 }, "/page-2");
      yield* history.back;
      const state = yield* history.state;
      assert.deepStrictEqual(state, { page: 1 });
    }).pipe(Effect.provide(historyTest)),
  );

  it.effect("forward increments index", () =>
    Effect.gen(function* () {
      const history = yield* History;
      yield* history.pushState({ page: 1 }, "/page-1");
      yield* history.pushState({ page: 2 }, "/page-2");
      yield* history.back;
      yield* history.forward;
      const state = yield* history.state;
      assert.deepStrictEqual(state, { page: 2 });
    }).pipe(Effect.provide(historyTest)),
  );

  it.effect("back at start is no-op", () =>
    Effect.gen(function* () {
      const history = yield* History;
      yield* history.back;
      const state = yield* history.state;
      assert.strictEqual(state, null);
    }).pipe(Effect.provide(historyTest)),
  );

  it.effect("forward at end is no-op", () =>
    Effect.gen(function* () {
      const history = yield* History;
      yield* history.pushState({ page: 1 }, "/page-1");
      yield* history.forward;
      const state = yield* history.state;
      assert.deepStrictEqual(state, { page: 1 });
    }).pipe(Effect.provide(historyTest)),
  );

  it.effect("pushState after back truncates forward entries", () =>
    Effect.gen(function* () {
      const history = yield* History;
      yield* history.pushState({ page: 1 }, "/page-1");
      yield* history.pushState({ page: 2 }, "/page-2");
      yield* history.pushState({ page: 3 }, "/page-3");
      yield* history.back;
      yield* history.back;
      // Now at page-1, push new entry
      yield* history.pushState({ page: 4 }, "/page-4");
      const state = yield* history.state;
      assert.deepStrictEqual(state, { page: 4 });
      // Forward should be no-op (entries 2,3 were truncated)
      yield* history.forward;
      const stateAfter = yield* history.state;
      assert.deepStrictEqual(stateAfter, { page: 4 });
    }).pipe(Effect.provide(historyTest)),
  );

  it.effect("replaceState on initial entry", () =>
    Effect.gen(function* () {
      const history = yield* History;
      yield* history.replaceState({ initial: true }, "/home");
      const state = yield* history.state;
      assert.deepStrictEqual(state, { initial: true });
    }).pipe(Effect.provide(historyTest)),
  );

  it.effect("multiple back and forward navigations", () =>
    Effect.gen(function* () {
      const history = yield* History;
      yield* history.pushState({ n: 1 }, "/1");
      yield* history.pushState({ n: 2 }, "/2");
      yield* history.pushState({ n: 3 }, "/3");
      yield* history.back;
      yield* history.back;
      yield* history.back;
      // Should be at initial entry
      const state = yield* history.state;
      assert.strictEqual(state, null);
      yield* history.forward;
      yield* history.forward;
      yield* history.forward;
      const finalState = yield* history.state;
      assert.deepStrictEqual(finalState, { n: 3 });
    }).pipe(Effect.provide(historyTest)),
  );
});
