/**
 * Unsafe Quarantine Module Tests
 *
 * Tests for type-boundary coercions quarantined in internal/unsafe.ts.
 * Validates runtime correctness of operations that TypeScript cannot verify.
 *
 * Test Categories:
 * - Layer merging: unsafeMergeLayers (0/1/N layers, last-write-wins)
 * - Context building: unsafeBuildContext (service provision correctness)
 * - Component tagging: unsafeTagCallable (callable + metadata preservation)
 * - Function union: unsafeCallNoArgs (no-arg factory invocation)
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, ServiceMap } from "effect";

import {
  unsafeMergeLayers,
  unsafeBuildContext,
  unsafeTagCallable,
  unsafeCallNoArgs,
} from "../unsafe.js";

// =============================================================================
// Test Services
// =============================================================================

class ServiceA extends ServiceMap.Service<ServiceA, { readonly value: string }>()("ServiceA") {}
class ServiceB extends ServiceMap.Service<ServiceB, { readonly count: number }>()("ServiceB") {}

const layerA = Layer.succeed(ServiceA, { value: "alpha" });
const layerB = Layer.succeed(ServiceB, { count: 42 });
const layerA2 = Layer.succeed(ServiceA, { value: "overridden" });

// =============================================================================
// unsafeMergeLayers
// =============================================================================

describe("unsafeMergeLayers", () => {
  it.effect("should return Layer.empty for empty array", () =>
    Effect.gen(function* () {
      const merged = yield* unsafeMergeLayers([]);
      // Building a context from empty layer should succeed with empty context
      const ctx = yield* unsafeBuildContext<never>([merged]);
      assert.isDefined(ctx);
    }),
  );

  it.effect("should return the single layer unchanged", () =>
    Effect.gen(function* () {
      const merged = yield* unsafeMergeLayers([layerA]);
      const ctx = yield* unsafeBuildContext<ServiceA>([merged]);
      const svc = ServiceMap.get(ctx, ServiceA);
      assert.strictEqual(svc.value, "alpha");
    }),
  );

  it.effect("should merge multiple heterogeneous layers", () =>
    Effect.gen(function* () {
      const merged = yield* unsafeMergeLayers([layerA, layerB]);
      const ctx = yield* unsafeBuildContext<ServiceA | ServiceB>([merged]);
      const a = ServiceMap.get(ctx, ServiceA);
      const b = ServiceMap.get(ctx, ServiceB);
      assert.strictEqual(a.value, "alpha");
      assert.strictEqual(b.count, 42);
    }),
  );

  it.effect("should apply last-write-wins for duplicate services", () =>
    Effect.gen(function* () {
      const merged = yield* unsafeMergeLayers([layerA, layerA2]);
      const ctx = yield* unsafeBuildContext<ServiceA>([merged]);
      const svc = ServiceMap.get(ctx, ServiceA);
      assert.strictEqual(svc.value, "overridden");
    }),
  );
});

// =============================================================================
// unsafeBuildContext
// =============================================================================

describe("unsafeBuildContext", () => {
  it.effect("should return empty context for empty layers", () =>
    Effect.gen(function* () {
      const ctx = yield* unsafeBuildContext<never>([]);
      assert.isDefined(ctx);
    }),
  );

  it.effect("should build context with single service layer", () =>
    Effect.gen(function* () {
      const ctx = yield* unsafeBuildContext<ServiceA>([layerA]);
      const svc = ServiceMap.get(ctx, ServiceA);
      assert.strictEqual(svc.value, "alpha");
    }),
  );

  it.effect("should build context with multiple service layers", () =>
    Effect.gen(function* () {
      const ctx = yield* unsafeBuildContext<ServiceA | ServiceB>([layerA, layerB]);
      const a = ServiceMap.get(ctx, ServiceA);
      const b = ServiceMap.get(ctx, ServiceB);
      assert.strictEqual(a.value, "alpha");
      assert.strictEqual(b.count, 42);
    }),
  );

  it.effect("should apply last-write-wins for conflicting services", () =>
    Effect.gen(function* () {
      const ctx = yield* unsafeBuildContext<ServiceA>([layerA, layerA2]);
      const svc = ServiceMap.get(ctx, ServiceA);
      assert.strictEqual(svc.value, "overridden");
    }),
  );
});

// =============================================================================
// unsafeTagCallable
// =============================================================================

describe("unsafeTagCallable", () => {
  interface Tagged {
    (x: number): string;
    readonly _tag: string;
    readonly _meta: number;
  }

  it("should preserve function callability", () => {
    const fn = (x: number): string => `value:${x}`;
    const tagged = unsafeTagCallable<Tagged>(fn, { _tag: "Test", _meta: 99 });

    assert.strictEqual(tagged(5), "value:5");
  });

  it("should attach all metadata properties", () => {
    const fn = (x: number): string => `value:${x}`;
    const tagged = unsafeTagCallable<Tagged>(fn, { _tag: "Test", _meta: 99 });

    assert.strictEqual(tagged._tag, "Test");
    assert.strictEqual(tagged._meta, 99);
  });

  it("should allow typeof check (remains a function)", () => {
    const fn = (): void => {};
    const tagged = unsafeTagCallable<{ (): void; _tag: string }>(fn, { _tag: "X" });

    assert.strictEqual(typeof tagged, "function");
  });
});

// =============================================================================
// unsafeCallNoArgs
// =============================================================================

describe("unsafeCallNoArgs", () => {
  it("should call zero-arg function and return result", () => {
    const factory = () => 42;
    const result = unsafeCallNoArgs<number>(factory);
    assert.strictEqual(result, 42);
  });

  it("should call function returning Effect", () => {
    const factory = () => Effect.succeed("hello");
    const result = unsafeCallNoArgs<Effect.Effect<string>>(factory);
    assert.isTrue(Effect.isEffect(result));
  });
});
