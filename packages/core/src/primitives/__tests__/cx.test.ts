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
import { assert, describe, it } from "@effect/vitest";
import { Data, Effect, Exit, Scope, TestClock } from "effect";
import * as Signal from "../signal.js";
import { cx } from "../cx.js";

class ExpectedSignal extends Data.TaggedError("ExpectedSignal")<{ readonly got: string }> {}

/** Narrow cx result to Signal, failing if static string */
const expectSignal = (value: string | Signal.Signal<string>) =>
  typeof value === "string" ? new ExpectedSignal({ got: value }) : Effect.succeed(value);

// =============================================================================
// Static class composition (no signals)
// =============================================================================

describe("cx - static", () => {
  it.scoped("should combine multiple class strings", () =>
    Effect.gen(function* () {
      const result = yield* cx("a", "b", "c");
      assert.strictEqual(result, "a b c");
    }),
  );

  it.scoped("should filter out falsy values", () =>
    Effect.gen(function* () {
      const result = yield* cx("a", false, null, undefined, "b");
      assert.strictEqual(result, "a b");
    }),
  );

  it.scoped("should handle conditional object syntax", () =>
    Effect.gen(function* () {
      const result = yield* cx("base", { active: true, disabled: false });
      assert.strictEqual(result, "base active");
    }),
  );

  it.scoped("should return empty string for all falsy inputs", () =>
    Effect.gen(function* () {
      const result = yield* cx(false, null, undefined);
      assert.strictEqual(result, "");
    }),
  );

  it.scoped("should return plain string (not Signal) for static inputs", () =>
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
  it.scoped("should return Signal<string> when inputs include signals", () =>
    Effect.gen(function* () {
      const variant = yield* Signal.make("primary");
      const result = yield* cx("btn", variant);

      assert.isTrue(Signal.isSignal(result));
    }),
  );

  it.scoped("should resolve signal values in class string", () =>
    Effect.gen(function* () {
      const variant = yield* Signal.make("primary");
      const result = yield* cx("btn", variant);

      // result is Signal<string>, read its value
      const signal = yield* expectSignal(result);
      const value = yield* Signal.get(signal);
      assert.strictEqual(value, "btn primary");
    }),
  );

  it.scoped("should update when signal changes", () =>
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

  it.scoped("should handle boolean signals", () =>
    Effect.gen(function* () {
      const active = yield* Signal.make(true);
      const result = yield* cx("nav-item", active);
      const signal = yield* expectSignal(result);

      // Boolean true doesn't add a class string
      assert.strictEqual(yield* Signal.get(signal), "nav-item");
    }),
  );

  it.scoped("should handle signal becoming falsy", () =>
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

  it.scoped("should cleanup subscriptions when scope closes", () =>
    Effect.gen(function* () {
      const variant = yield* Signal.make("primary");
      const innerScope = yield* Scope.make();

      yield* cx("btn", variant).pipe(Effect.locally(Signal.CurrentRenderScope, innerScope));

      assert.strictEqual(variant._listeners.size, 1);

      yield* Scope.close(innerScope, Exit.void);

      assert.strictEqual(variant._listeners.size, 0);
    }),
  );

  it.scoped("should handle multiple signals", () =>
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
