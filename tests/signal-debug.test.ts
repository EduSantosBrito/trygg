/**
 * Tests for Signal sync callback reactivity
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, SubscriptionRef } from "effect"
import * as Signal from "../src/Signal.js"

describe("Signal", () => {
  it.effect("SubscriptionRef basic update works", () =>
    Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make(0)

      // Get initial value
      const initial = yield* SubscriptionRef.get(ref)
      expect(initial).toBe(0)

      // Update
      yield* SubscriptionRef.set(ref, 1)

      // Get updated value
      const updated = yield* SubscriptionRef.get(ref)
      expect(updated).toBe(1)
    })
  )

  it.effect("Signal.subscribe triggers on value change", () =>
    Effect.gen(function* () {
      // Create a signal manually (outside render phase)
      const ref = yield* SubscriptionRef.make(0)
      const signal: Signal.Signal<number> = {
        _tag: "Signal",
        _ref: ref,
        _listeners: new Set(),
        _debugId: "test_sig_1"
      }

      // Track listener calls
      let callCount = 0
      const unsubscribe = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          callCount++
        })
      )

      expect(callCount).toBe(0)

      // Update and notify (simulating what the setter does)
      yield* SubscriptionRef.set(signal._ref, 1)
      for (const listener of signal._listeners) {
        yield* listener()
      }

      expect(callCount).toBe(1)

      // Another update
      yield* SubscriptionRef.set(signal._ref, 2)
      for (const listener of signal._listeners) {
        yield* listener()
      }

      expect(callCount).toBe(2)

      // Unsubscribe and update - should not trigger
      yield* unsubscribe
      yield* SubscriptionRef.set(signal._ref, 3)
      for (const listener of signal._listeners) {
        yield* listener()
      }

      expect(callCount).toBe(2) // Still 2, unsubscribed
    })
  )

  it.effect("Signal.set skips notification when value is unchanged (primitive)", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(42)

      // Track listener calls
      let callCount = 0
      const _unsub = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          callCount++
        })
      )
      void _unsub // silence unused variable warning

      expect(callCount).toBe(0)

      // Set to same value - should NOT trigger listener
      yield* Signal.set(signal, 42)
      expect(callCount).toBe(0)

      // Set to different value - should trigger
      yield* Signal.set(signal, 100)
      expect(callCount).toBe(1)

      // Set to same value again - should NOT trigger
      yield* Signal.set(signal, 100)
      expect(callCount).toBe(1)
    })
  )

  it.effect("Signal.set skips notification for Option.none() (structural equality)", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(Option.none<string>())

      let callCount = 0
      const _unsub2 = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          callCount++
        })
      )
      void _unsub2 // silence unused variable warning

      // Set to Option.none() again - should NOT trigger (structural equality)
      yield* Signal.set(signal, Option.none())
      expect(callCount).toBe(0)

      // Set to Option.some - should trigger
      yield* Signal.set(signal, Option.some("hello"))
      expect(callCount).toBe(1)

      // Set to same Option.some - should NOT trigger
      yield* Signal.set(signal, Option.some("hello"))
      expect(callCount).toBe(1)

      // Set back to Option.none - should trigger
      yield* Signal.set(signal, Option.none())
      expect(callCount).toBe(2)
    })
  )

  it.effect("Signal.update skips notification when value is unchanged", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(5)

      let callCount = 0
      const _unsub3 = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          callCount++
        })
      )
      void _unsub3 // silence unused variable warning

      // Identity function - should NOT trigger
      yield* Signal.update(signal, (n) => n)
      expect(callCount).toBe(0)

      // Math.max that doesn't change value - should NOT trigger
      yield* Signal.update(signal, (n) => Math.max(n, 0))
      expect(callCount).toBe(0)

      // Actual increment - should trigger
      yield* Signal.update(signal, (n) => n + 1)
      expect(callCount).toBe(1)

      // Confirm value changed
      const value = yield* Signal.get(signal)
      expect(value).toBe(6)
    })
  )
})
