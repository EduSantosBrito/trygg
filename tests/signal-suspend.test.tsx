/**
 * Signal.suspend tests
 *
 * Verifies async component state tracking, dep-based caching,
 * and handler invocation for Pending/Failure/Success states.
 */
import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Option, TestClock } from "effect"
import * as Signal from "../src/Signal.js"
import { Element, text } from "../src/Element.js"
import { gen as componentGen } from "../src/Component.js"

// =============================================================================
// Test Components
// =============================================================================

/** Simple sync component that returns text */
const SyncText = componentGen(function* () {
  return text("success")
})

/** Async component that sleeps then returns text */
const AsyncText = componentGen(function* () {
  yield* Effect.sleep("100 millis")
  return text("loaded")
})

/** Async component that fails */
const FailingComponent = componentGen(function* () {
  yield* Effect.sleep("50 millis")
  return yield* Effect.fail("oops")
})

// =============================================================================
// Tests
// =============================================================================

describe("Signal.suspend", () => {
  it.scoped("shows Pending then Success for sync component", () =>
    Effect.gen(function* () {
      const Suspended = yield* Signal.suspend(SyncText, {
        Pending: () => text("pending"),
        Failure: () => text("failure"),
        Success: <SyncText />
      })

      // Initial state should be pending (sync component runs async internally)
      const initial = yield* Signal.get(Suspended._signal)
      expect(initial._tag).toBe("Text")

      // After microtask, should be success
      yield* Effect.yieldNow()
      const final = yield* Signal.get(Suspended._signal)
      expect(final._tag).toBe("Text")
      if (final._tag === "Text") {
        expect(final.content).toBe("success")
      }
    })
  )

  it.scoped("shows Pending while async work in progress", () =>
    Effect.gen(function* () {
      const Suspended = yield* Signal.suspend(AsyncText, {
        Pending: () => text("loading..."),
        Failure: () => text("error"),
        Success: <AsyncText />
      })

      // Should show pending immediately
      const initial = yield* Signal.get(Suspended._signal)
      expect(initial._tag).toBe("Text")
      if (initial._tag === "Text") {
        expect(initial.content).toBe("loading...")
      }

      // After time passes, should show success
      yield* TestClock.adjust("200 millis")
      const final = yield* Signal.get(Suspended._signal)
      expect(final._tag).toBe("Text")
      if (final._tag === "Text") {
        expect(final.content).toBe("loaded")
      }
    })
  )

  it.scoped("shows Failure when component fails", () =>
    Effect.gen(function* () {
      const Suspended = yield* Signal.suspend(FailingComponent, {
        Pending: () => text("loading"),
        Failure: (cause: Cause.Cause<string>) => {
          const error = Cause.failureOption(cause)
          return text(Option.isSome(error) ? `error: ${error.value}` : "unknown error")
        },
        Success: <FailingComponent />
      })

      // Initial is pending
      const initial = yield* Signal.get(Suspended._signal)
      if (initial._tag === "Text") {
        expect(initial.content).toBe("loading")
      }

      // After failure
      yield* TestClock.adjust("100 millis")
      const final = yield* Signal.get(Suspended._signal)
      expect(final._tag).toBe("Text")
      if (final._tag === "Text") {
        expect(final.content).toBe("error: oops")
      }
    })
  )

  it.scoped("passes stale element to Pending handler with dep-based caching", () =>
    Effect.gen(function* () {
      const userId = yield* Signal.make(1)

      // Component that reads userId signal
      const UserComponent = componentGen(function* () {
        const id = yield* Signal.get(userId)
        yield* Effect.sleep("50 millis")
        return text(`user-${id}`)
      })

      const Suspended = yield* Signal.suspend(UserComponent, {
        Pending: (stale: Element | null) => stale ?? text("loading"),
        Failure: () => text("error"),
        Success: <UserComponent />
      })

      // Initial pending (no stale)
      const initial = yield* Signal.get(Suspended._signal)
      if (initial._tag === "Text") {
        expect(initial.content).toBe("loading")
      }

      // After first load
      yield* TestClock.adjust("100 millis")
      const loaded = yield* Signal.get(Suspended._signal)
      if (loaded._tag === "Text") {
        expect(loaded.content).toBe("user-1")
      }

      // Change dep - should show pending with no stale (new dep key)
      yield* Signal.set(userId, 2)
      yield* Effect.yieldNow()

      const pending = yield* Signal.get(Suspended._signal)
      if (pending._tag === "Text") {
        // New dep key = no cache = loading (no stale)
        expect(pending.content).toBe("loading")
      }

      // After load completes
      yield* TestClock.adjust("100 millis")
      const newLoaded = yield* Signal.get(Suspended._signal)
      if (newLoaded._tag === "Text") {
        expect(newLoaded.content).toBe("user-2")
      }

      // Go back to userId=1 - should have cache
      yield* Signal.set(userId, 1)
      yield* Effect.yieldNow()

      // Should show stale (cached user-1) during pending
      const cachedPending = yield* Signal.get(Suspended._signal)
      if (cachedPending._tag === "Text") {
        // With caching, userId=1 was previously fetched, so stale = "user-1"
        expect(cachedPending.content).toBe("user-1")
      }
    })
  )

  it.effect("cleans up subscriptions on scope close", () =>
    Effect.gen(function* () {
      const dep = yield* Signal.make(1)
      const initialListeners = dep._listeners.size

      // Component that reads dep signal
      const DepComponent = componentGen(function* () {
        const id = yield* Signal.get(dep)
        yield* Effect.sleep("50 millis")
        return text(`value-${id}`)
      })

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Signal.suspend(DepComponent, {
            Pending: () => text("pending"),
            Failure: () => text("error"),
            Success: <DepComponent />
          })

          yield* TestClock.adjust("100 millis")

          // Should have subscription
          expect(dep._listeners.size).toBe(initialListeners + 1)
        })
      )

      // After scope closes, subscription should be cleaned up
      expect(dep._listeners.size).toBe(initialListeners)
    })
  )
})
