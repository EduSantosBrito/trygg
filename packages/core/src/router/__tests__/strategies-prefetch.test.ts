// Phases 6-8: Prefetch, RenderStrategy, ScrollStrategy Tests
//
// Tests for parallel prefetch execution, RenderStrategy.Lazy/Eager,
// and ScrollStrategy.Auto/None.
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { runPrefetch } from "../prefetch.js";
import { RenderStrategy } from "../render-strategy.js";
import { ScrollStrategy } from "../scroll-strategy.js";

// =============================================================================
// Phase 6: Prefetch
// =============================================================================

describe("runPrefetch", () => {
  it.effect("should run all prefetch effects in parallel", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<string[]>([]);

      const fn1 = () => Ref.update(log, (arr) => [...arr, "first"]).pipe(Effect.as("r1"));
      const fn2 = () => Ref.update(log, (arr) => [...arr, "second"]).pipe(Effect.as("r2"));

      yield* runPrefetch([fn1, fn2], {});

      const result = yield* Ref.get(log);
      // Both should have run (order may vary with concurrency)
      assert.strictEqual(result.length, 2);
      assert.isTrue(result.includes("first"));
      assert.isTrue(result.includes("second"));
    }),
  );

  it.effect("should not fail when prefetch errors", () =>
    Effect.gen(function* () {
      const fn1 = () => Effect.succeed("ok");
      const fn2 = () => Effect.fail("prefetch-error");
      const fn3 = () => Effect.succeed("also-ok");

      // Should not throw — errors are logged and swallowed
      yield* runPrefetch([fn1, fn2, fn3], {});
    }),
  );

  it.effect("should handle empty prefetch list", () => runPrefetch([], {}));

  it.effect("should pass context to prefetch functions", () =>
    Effect.gen(function* () {
      const received = yield* Ref.make<unknown>(null);
      const ctx = { params: { id: 123 } };

      const fn = (c: unknown) => Ref.set(received, c).pipe(Effect.as("resource"));

      yield* runPrefetch([fn], ctx);

      const result = yield* Ref.get(received);
      assert.deepStrictEqual(result, ctx);
    }),
  );

  it.effect("should run multiple prefetches even if one fails", () =>
    Effect.gen(function* () {
      const counter = yield* Ref.make(0);

      const fn1 = () => Ref.update(counter, (n) => n + 1).pipe(Effect.as("r1"));
      const fn2 = () => Effect.fail("error");
      const fn3 = () => Ref.update(counter, (n) => n + 1).pipe(Effect.as("r3"));

      yield* runPrefetch([fn1, fn2, fn3], {});

      const count = yield* Ref.get(counter);
      assert.strictEqual(count, 2); // fn1 and fn3 ran
    }),
  );
});

// =============================================================================
// Phase 7: RenderStrategy
// =============================================================================

describe("RenderStrategy", () => {
  it.effect("Lazy strategy has _tag 'Lazy'", () =>
    Effect.gen(function* () {
      const strategy = yield* RenderStrategy;
      assert.strictEqual(strategy._tag, "Lazy");
    }).pipe(Effect.provide(RenderStrategy.Lazy)),
  );

  it.effect("Eager strategy has _tag 'Eager'", () =>
    Effect.gen(function* () {
      const strategy = yield* RenderStrategy;
      assert.strictEqual(strategy._tag, "Eager");
    }).pipe(Effect.provide(RenderStrategy.Eager)),
  );

  it("should have Lazy as a Layer", () => {
    assert.isTrue(Layer.isLayer(RenderStrategy.Lazy));
  });

  it("should have Eager as a Layer", () => {
    assert.isTrue(Layer.isLayer(RenderStrategy.Eager));
  });
});

// =============================================================================
// Phase 8: ScrollStrategy
// =============================================================================

describe("ScrollStrategy", () => {
  it.effect("Auto has _tag 'Auto' (pure data, no functions)", () =>
    Effect.gen(function* () {
      const strategy = yield* ScrollStrategy;
      assert.strictEqual(strategy._tag, "Auto");
      // Pure data — no function fields
      assert.deepStrictEqual(Object.keys(strategy), ["_tag"]);
    }).pipe(Effect.provide(ScrollStrategy.Auto)),
  );

  it.effect("None has _tag 'None' (pure data)", () =>
    Effect.gen(function* () {
      const strategy = yield* ScrollStrategy;
      assert.strictEqual(strategy._tag, "None");
      assert.deepStrictEqual(Object.keys(strategy), ["_tag"]);
    }).pipe(Effect.provide(ScrollStrategy.None)),
  );

  it("should have Auto as a Layer", () => {
    assert.isTrue(Layer.isLayer(ScrollStrategy.Auto));
  });

  it("should have None as a Layer", () => {
    assert.isTrue(Layer.isLayer(ScrollStrategy.None));
  });
});
