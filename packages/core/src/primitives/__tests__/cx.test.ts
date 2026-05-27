/**
 * cx Unit Tests
 *
 * Tests for the class name composition utility.
 * cx combines class names with support for:
 * - Static strings
 * - Boolean conditionals
 * - Object notation
 * - Signal inputs (returns reactive Signal<string>)
 */
import { assert, describe, effect } from "@effect/vitest";
import { Effect, Exit, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Signal from "../signal.js";
import { cx } from "../cx.js";

class ExpectedSignal extends Schema.TaggedErrorClass<ExpectedSignal>()("ExpectedSignal", {
  got: Schema.String,
}) {}

/** Narrow cx result to Signal, failing if static string */
const expectSignal = (value: string | Signal.Signal<string>) =>
  typeof value === "string" ? new ExpectedSignal({ got: value }) : Effect.succeed(value);

// =============================================================================
// Static class composition (no signals)
// =============================================================================

describe("cx - static", () => {
  effect("should combine multiple class strings", () =>
    Effect.gen(function* () {
      const result = yield* cx("a", "b", "c");
      assert.strictEqual(result, "a b c");
    }),
  );

  effect("should filter out falsy values", () =>
    Effect.gen(function* () {
      const result = yield* cx("a", false, null, undefined, "b");
      assert.strictEqual(result, "a b");
    }),
  );

  effect("should handle conditional object syntax", () =>
    Effect.gen(function* () {
      const result = yield* cx("base", { active: true, disabled: false });
      assert.strictEqual(result, "base active");
    }),
  );

  effect("should return empty string for all falsy inputs", () =>
    Effect.gen(function* () {
      const result = yield* cx(false, null, undefined);
      assert.strictEqual(result, "");
    }),
  );

  effect("should return plain string (not Signal) for static inputs", () =>
    Effect.gen(function* () {
      const result = yield* cx("flex", "gap-2");
      assert.strictEqual(typeof result, "string");
      assert.isFalse(Signal.isSignal(result));
    }),
  );
});

// =============================================================================
// Reactive class composition (with signals)
// =============================================================================

describe("cx - reactive", () => {
  effect("should return Signal<string> when inputs include signals", () =>
    Effect.gen(function* () {
      const variant = yield* Signal.make("primary");
      const result = yield* cx("btn", variant);

      assert.isTrue(Signal.isSignal(result));
    }),
  );

  effect("should resolve signal values in class string", () =>
    Effect.gen(function* () {
      const variant = yield* Signal.make("primary");
      const result = yield* cx("btn", variant);

      // result is Signal<string>, read its value
      const signal = yield* expectSignal(result);
      const value = yield* Signal.get(signal);
      assert.strictEqual(value, "btn primary");
    }),
  );

  effect("should update when signal changes", () =>
    Effect.gen(function* () {
      const variant = yield* Signal.make("primary");
      const result = yield* cx("btn", variant);
      const signal = yield* expectSignal(result);

      assert.strictEqual(yield* Signal.get(signal), "btn primary");

      yield* Signal.set(variant, "secondary");
      yield* TestClock.adjust(10);

      assert.strictEqual(yield* Signal.get(signal), "btn secondary");
    }),
  );

  effect("should handle boolean signals", () =>
    Effect.gen(function* () {
      const active = yield* Signal.make(true);
      const result = yield* cx("nav-item", active);
      const signal = yield* expectSignal(result);

      // Boolean true doesn't add a class string
      assert.strictEqual(yield* Signal.get(signal), "nav-item");
    }),
  );

  effect("should handle signal becoming falsy", () =>
    Effect.gen(function* () {
      const extra = yield* Signal.make<string | boolean | null | undefined>("highlight");
      const result = yield* cx("base", extra);
      const signal = yield* expectSignal(result);

      assert.strictEqual(yield* Signal.get(signal), "base highlight");

      yield* Signal.set(extra, null);
      yield* TestClock.adjust(10);

      assert.strictEqual(yield* Signal.get(signal), "base");
    }),
  );

  effect("should cleanup subscriptions when scope closes", () =>
    Effect.gen(function* () {
      const variant = yield* Signal.make("primary");
      const innerScope = yield* Scope.make();

      yield* Effect.provideService(cx("btn", variant), Signal.CurrentRenderScope, innerScope);

      assert.strictEqual(variant._listeners.size, 1);

      yield* Scope.close(innerScope, Exit.void);

      assert.strictEqual(variant._listeners.size, 0);
    }),
  );

  effect("should handle multiple signals", () =>
    Effect.gen(function* () {
      const size = yield* Signal.make("lg");
      const color = yield* Signal.make("blue");
      const result = yield* cx("btn", size, color);
      const signal = yield* expectSignal(result);

      assert.strictEqual(yield* Signal.get(signal), "btn lg blue");

      yield* Signal.set(size, "sm");
      yield* TestClock.adjust(10);

      assert.strictEqual(yield* Signal.get(signal), "btn sm blue");
    }),
  );
});
