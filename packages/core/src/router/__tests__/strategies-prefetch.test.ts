// Phases 6-8: Prefetch, RenderStrategy, ScrollStrategy Tests
//
// Tests for parallel prefetch execution, RenderStrategy.Lazy/Eager,
// and ScrollStrategy.Auto/None.
import { assert, describe, it } from "@effect/vitest";
import { scoped } from "../../testing/effect-vitest.js";
import { Effect, Layer, Ref } from "effect";
import { runPrefetch } from "../prefetch.js";
import { RenderStrategy } from "../render-strategy.js";
import { ScrollStrategy } from "../scroll-strategy.js";
import { unsafeEraseR } from "../../internal/unsafe.js";

// =============================================================================
// Phase 6: Prefetch
// =============================================================================

describe("runPrefetch", () => {
  it("should run all prefetch effects in parallel", async () => {
    await Effect.runPromise(
      unsafeEraseR(
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
      ),
    );
  });

  it("should not fail when prefetch errors", async () => {
    await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const fn1 = () => Effect.succeed("ok");
          const fn2 = () => Effect.fail("prefetch-error");
          const fn3 = () => Effect.succeed("also-ok");

          // Should not throw — errors are logged and swallowed
          yield* runPrefetch([fn1, fn2, fn3], {});
        }),
      ),
    );
  });

  it("should handle empty prefetch list", async () => {
    await Effect.runPromise(unsafeEraseR(runPrefetch([], {})));
  });

  it("should pass context to prefetch functions", async () => {
    await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const received = yield* Ref.make<unknown>(null);
          const ctx = { params: { id: 123 } };

          const fn = (c: unknown) => Ref.set(received, c).pipe(Effect.as("resource"));

          yield* runPrefetch([fn], ctx);

          const result = yield* Ref.get(received);
          assert.deepStrictEqual(result, ctx);
        }),
      ),
    );
  });

  it("should run multiple prefetches even if one fails", async () => {
    await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const counter = yield* Ref.make(0);

          const fn1 = () => Ref.update(counter, (n) => n + 1).pipe(Effect.as("r1"));
          const fn2 = () => Effect.fail("error");
          const fn3 = () => Ref.update(counter, (n) => n + 1).pipe(Effect.as("r3"));

          yield* runPrefetch([fn1, fn2, fn3], {});

          const count = yield* Ref.get(counter);
          assert.strictEqual(count, 2); // fn1 and fn3 ran
        }),
      ),
    );
  });
});

// =============================================================================
// Phase 7: RenderStrategy
// =============================================================================

describe("RenderStrategy", () => {
  scoped("Lazy strategy has _tag 'Lazy'", () =>
    Effect.gen(function* () {
      const strategy = yield* RenderStrategy;
      assert.strictEqual(strategy._tag, "Lazy");
    }).pipe(Effect.provide(RenderStrategy.Lazy)),
  );

  scoped("Eager strategy has _tag 'Eager'", () =>
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
  scoped("Auto has _tag 'Auto' (pure data, no functions)", () =>
    Effect.gen(function* () {
      const strategy = yield* ScrollStrategy;
      assert.strictEqual(strategy._tag, "Auto");
      // Pure data — no function fields
      assert.deepStrictEqual(Object.keys(strategy), ["_tag"]);
    }).pipe(Effect.provide(ScrollStrategy.Auto)),
  );

  scoped("None has _tag 'None' (pure data)", () =>
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
