/**
 * F-003: Tests for parallel signal notification and error isolation
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Signal from "../src/Signal.js"
import * as Debug from "../src/debug.js"

describe("Signal parallel notification (F-003)", () => {
  it.effect("notifies all listeners in parallel", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0)

      // Track call order with timestamps
      const callOrder: Array<{ listener: number; time: number }> = []
      const startTime = Date.now()

      // Create 3 listeners that record when they're called
      const unsub1 = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          callOrder.push({ listener: 1, time: Date.now() - startTime })
        })
      )

      const unsub2 = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          callOrder.push({ listener: 2, time: Date.now() - startTime })
        })
      )

      const unsub3 = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          callOrder.push({ listener: 3, time: Date.now() - startTime })
        })
      )

      // Trigger notification
      yield* Signal.set(signal, 1)

      // All 3 listeners should have been called
      expect(callOrder.length).toBe(3)
      
      // Check all listeners were called (order may vary with parallel execution)
      const calledListeners = callOrder.map(c => c.listener).sort()
      expect(calledListeners).toEqual([1, 2, 3])

      yield* unsub1
      yield* unsub2
      yield* unsub3
    })
  )

  it.effect("isolates errors - failing listener doesn't affect others", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0)
      const results: Array<string> = []

      // First listener - succeeds
      const unsub1 = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          results.push("listener1-called")
        })
      )

      // Second listener - throws error
      const unsub2 = yield* Signal.subscribe(signal, () =>
        Effect.dieMessage("Listener 2 failed")
      )

      // Third listener - succeeds
      const unsub3 = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          results.push("listener3-called")
        })
      )

      // Trigger notification - should not throw
      yield* Signal.set(signal, 1)

      // Both non-failing listeners should have been called
      expect(results).toContain("listener1-called")
      expect(results).toContain("listener3-called")

      yield* unsub1
      yield* unsub2
      yield* unsub3
    })
  )

  it.effect("logs error event for failing listener", () =>
    Effect.gen(function* () {
      // Enable debug and collect events
      Debug.enable()
      const events: Debug.DebugEvent[] = []
      const collector = Debug.createCollectorPlugin("test-collector", events)
      Debug.registerPlugin(collector)

      try {
        const signal = yield* Signal.make(0)

        // Add a listener that throws
        const unsub = yield* Signal.subscribe(signal, () =>
          Effect.die("Test error")
        )

        // Trigger notification
        yield* Signal.set(signal, 1)

        // Find the error event
        type ListenerErrorEvent = Extract<
          Debug.DebugEvent,
          { event: "signal.listener.error" }
        >

        const errorEvents = events.filter(
          (event): event is ListenerErrorEvent => event.event === "signal.listener.error"
        )

        expect(errorEvents.length).toBe(1)
        const errorEvent = errorEvents[0]
        expect(errorEvent).toBeDefined()
        if (errorEvent === undefined) return
        expect(errorEvent.signal_id).toBe(signal._debugId)
        expect(errorEvent.listener_index).toBe(0)
        expect(errorEvent.cause).toContain("Test error")

        yield* unsub
      } finally {
        Debug.unregisterPlugin("test-collector")
        Debug.disable()
      }
    })
  )

  it.effect("handles mid-notification unsubscribe safely (snapshot)", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0)
      const results: Array<string> = []

      // Use a Deferred to track the unsubscribe Effect
      let unsub2: Effect.Effect<void> | null = null

      // First listener - unsubscribes second listener
      const unsub1 = yield* Signal.subscribe(signal, () =>
        Effect.gen(function* () {
          results.push("listener1-start")
          // Unsubscribe listener2 mid-notification
          if (unsub2) {
            yield* unsub2
          }
          results.push("listener1-end")
        })
      )

      // Second listener - gets unsubscribed by first
      unsub2 = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          results.push("listener2-called")
        })
      )

      // Third listener
      const unsub3 = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          results.push("listener3-called")
        })
      )

      // Trigger notification
      yield* Signal.set(signal, 1)

      // Due to snapshotting, listener2 should still be called this cycle
      // (it was in the snapshot before being unsubscribed)
      expect(results).toContain("listener1-start")
      expect(results).toContain("listener1-end")
      expect(results).toContain("listener2-called")
      expect(results).toContain("listener3-called")

      // On next update, listener2 should NOT be called
      results.length = 0
      yield* Signal.set(signal, 2)

      expect(results).toContain("listener1-start")
      expect(results).toContain("listener1-end")
      expect(results).not.toContain("listener2-called")
      expect(results).toContain("listener3-called")

      yield* unsub1
      if (unsub2 !== null) {
        yield* unsub2
      }
      yield* unsub3
    })
  )

  it.effect("completes immediately with empty listener set", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0)

      // No listeners subscribed - should complete without error
      yield* Signal.set(signal, 1)

      // Verify value changed
      const value = yield* Signal.get(signal)
      expect(value).toBe(1)
    })
  )

  it.effect("all listeners throw - Signal.set still succeeds", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(0)

      // All listeners fail
      const unsub1 = yield* Signal.subscribe(signal, () =>
        Effect.dieMessage("Listener 1 failed")
      )
      const unsub2 = yield* Signal.subscribe(signal, () =>
        Effect.dieMessage("Listener 2 failed")
      )
      const unsub3 = yield* Signal.subscribe(signal, () =>
        Effect.dieMessage("Listener 3 failed")
      )

      // Signal.set should still succeed (errors are isolated)
      yield* Signal.set(signal, 42)

      // Value should be updated
      const value = yield* Signal.get(signal)
      expect(value).toBe(42)

      yield* unsub1
      yield* unsub2
      yield* unsub3
    })
  )

  it.effect("backward compatibility - existing Signal behavior unchanged", () =>
    Effect.gen(function* () {
      // Basic signal operations should work as before
      const signal = yield* Signal.make(0)

      // Subscribe
      let notifyCount = 0
      const unsub = yield* Signal.subscribe(signal, () =>
        Effect.sync(() => {
          notifyCount++
        })
      )

      // Set triggers listener
      yield* Signal.set(signal, 1)
      expect(notifyCount).toBe(1)

      // Update triggers listener
      yield* Signal.update(signal, (n) => n + 1)
      expect(notifyCount).toBe(2)

      // Skipped update doesn't trigger listener
      yield* Signal.update(signal, (n) => n) // identity
      expect(notifyCount).toBe(2)

      // Unsubscribe works
      yield* unsub
      yield* Signal.set(signal, 100)
      expect(notifyCount).toBe(2) // unchanged
    })
  )
})
