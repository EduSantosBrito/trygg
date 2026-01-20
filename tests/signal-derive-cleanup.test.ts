/**
 * Tests for Signal.derive subscription cleanup
 * 
 * F-003: Signal.derive subscriptions not cleaned up
 * These tests verify that derive subscriptions are properly cleaned up
 * when scopes close, preventing memory leaks.
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import * as Signal from "../src/Signal.js"

describe("Signal.derive cleanup", () => {
  describe("Implicit scope (from Effect context)", () => {
    it.effect("derive uses scope from Effect.scoped automatically", () =>
      Effect.gen(function* () {
        const source = yield* Signal.make(5)
        const initialListenerCount = source._listeners.size

        // Track that derive was cleaned up
        let derivedValue = 0

        // Run in scoped block - derive gets scope implicitly
        yield* Effect.scoped(
          Effect.gen(function* () {
            const derived = yield* Signal.derive(source, (n) => n * 2)
            derivedValue = yield* Signal.get(derived)
            expect(derivedValue).toBe(10)
            expect(source._listeners.size).toBe(initialListenerCount + 1)
          })
        )

        // After scoped block exits, subscription should be cleaned up
        expect(source._listeners.size).toBe(initialListenerCount)
      })
    )
  })

  describe("Explicit scope cleanup", () => {
    it.effect("derive subscription is cleaned up when scope closes", () =>
      Effect.gen(function* () {
        // Create a source signal
        const source = yield* Signal.make(5)
        const initialListenerCount = source._listeners.size

        // Create a scope to simulate component mount
        const scope = yield* Scope.make()

        // Create derived signal with explicit scope
        const derived = yield* Signal.derive(source, (n) => n * 2, { scope })

        // Verify derived signal has correct initial value
        const initialValue = yield* Signal.get(derived)
        expect(initialValue).toBe(10)

        // Verify subscription was added (listener count increased)
        expect(source._listeners.size).toBe(initialListenerCount + 1)

        // Close scope (simulate unmount)
        yield* Scope.close(scope, Exit.void)

        // Verify subscription was cleaned up (listener count back to baseline)
        expect(source._listeners.size).toBe(initialListenerCount)
      })
    )

    it.effect("derived signal updates before scope closes", () =>
      Effect.gen(function* () {
        const source = yield* Signal.make(3)
        const scope = yield* Scope.make()

        const derived = yield* Signal.derive(source, (n) => n * 10, { scope })

        // Initial value
        expect(yield* Signal.get(derived)).toBe(30)

        // Update source - derived should update
        yield* Signal.set(source, 5)
        expect(yield* Signal.get(derived)).toBe(50)

        // Another update
        yield* Signal.set(source, 7)
        expect(yield* Signal.get(derived)).toBe(70)

        // Cleanup
        yield* Scope.close(scope, Exit.void)
      })
    )

    it.effect("remount creates new subscription without duplicates", () =>
      Effect.gen(function* () {
        const source = yield* Signal.make(1)
        const initialListenerCount = source._listeners.size

        // First mount
        const scope1 = yield* Scope.make()
        const derived1 = yield* Signal.derive(source, (n) => n + 1, { scope: scope1 })
        expect(yield* Signal.get(derived1)).toBe(2)
        expect(source._listeners.size).toBe(initialListenerCount + 1)

        // Unmount
        yield* Scope.close(scope1, Exit.void)
        expect(source._listeners.size).toBe(initialListenerCount)

        // Remount (new scope, new derived)
        const scope2 = yield* Scope.make()
        const derived2 = yield* Signal.derive(source, (n) => n + 1, { scope: scope2 })
        expect(yield* Signal.get(derived2)).toBe(2)
        
        // Should still only have 1 new subscription (no duplicates from previous mount)
        expect(source._listeners.size).toBe(initialListenerCount + 1)

        // Cleanup
        yield* Scope.close(scope2, Exit.void)
        expect(source._listeners.size).toBe(initialListenerCount)
      })
    )
  })

  describe("Long-lived derive with explicit scope", () => {
    it.effect("subscription persists until scope closes", () =>
      Effect.gen(function* () {
        const source = yield* Signal.make(10)
        const initialListenerCount = source._listeners.size

        // Create explicit scope for long-lived signal
        const scope = yield* Scope.make()

        // Create derived with explicit scope
        const derived = yield* Signal.derive(source, (n) => n * 3, { scope })

        // Verify subscription exists
        expect(source._listeners.size).toBe(initialListenerCount + 1)
        expect(yield* Signal.get(derived)).toBe(30)

        // Update source - derived should track
        yield* Signal.set(source, 20)
        expect(yield* Signal.get(derived)).toBe(60)

        // Close scope to release
        yield* Scope.close(scope, Exit.void)

        // Verify subscription released
        expect(source._listeners.size).toBe(initialListenerCount)
      })
    )

    it.effect("multiple derived signals from same source", () =>
      Effect.gen(function* () {
        const source = yield* Signal.make(5)
        const initialListenerCount = source._listeners.size

        const scope = yield* Scope.make()

        // Create multiple derived signals
        const doubled = yield* Signal.derive(source, (n) => n * 2, { scope })
        const squared = yield* Signal.derive(source, (n) => n * n, { scope })

        // Both subscriptions exist
        expect(source._listeners.size).toBe(initialListenerCount + 2)
        expect(yield* Signal.get(doubled)).toBe(10)
        expect(yield* Signal.get(squared)).toBe(25)

        // Update source - both should track
        yield* Signal.set(source, 4)
        expect(yield* Signal.get(doubled)).toBe(8)
        expect(yield* Signal.get(squared)).toBe(16)

        // Close scope - both cleaned
        yield* Scope.close(scope, Exit.void)
        expect(source._listeners.size).toBe(initialListenerCount)
      })
    )
  })

  describe("Chained derived signals", () => {
    it.effect("chained derive subscriptions all cleaned up", () =>
      Effect.gen(function* () {
        const source = yield* Signal.make(2)
        const sourceInitialListeners = source._listeners.size

        const scope = yield* Scope.make()

        // Create chain: source -> doubled -> quadrupled
        const doubled = yield* Signal.derive(source, (n) => n * 2, { scope })
        const quadrupled = yield* Signal.derive(doubled, (n) => n * 2, { scope })

        // Verify initial values
        expect(yield* Signal.get(doubled)).toBe(4)
        expect(yield* Signal.get(quadrupled)).toBe(8)

        // Source has 1 subscriber (doubled)
        expect(source._listeners.size).toBe(sourceInitialListeners + 1)
        // Doubled has 1 subscriber (quadrupled)
        expect(doubled._listeners.size).toBe(1)

        // Update source - both should track
        yield* Signal.set(source, 3)
        expect(yield* Signal.get(doubled)).toBe(6)
        expect(yield* Signal.get(quadrupled)).toBe(12)

        // Close scope - all subscriptions should be cleaned
        yield* Scope.close(scope, Exit.void)

        expect(source._listeners.size).toBe(sourceInitialListeners)
        expect(doubled._listeners.size).toBe(0)
      })
    )
  })
})
