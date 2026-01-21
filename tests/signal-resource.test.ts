/**
 * Signal.resource tests
 *
 * Verifies resource state transitions, Exit/Cause wiring,
 * implicit dependency refresh, and cleanup behavior.
 */
import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Exit, Option, TestClock } from "effect"
import * as Signal from "../src/Signal.js"

describe("Signal.resource", () => {
  it.scoped("transitions from loading to success", () =>
    Effect.gen(function* () {
      const resource = yield* Signal.resource(
        Effect.gen(function* () {
          yield* Effect.sleep("10 millis")
          return "ok"
        })
      )

      const initial = yield* Signal.get(resource.state)
      expect(initial._tag).toBe("Loading")

      yield* TestClock.adjust("20 millis")

      const next = yield* Signal.get(resource.state)
      expect(next._tag).toBe("Success")
      if (next._tag === "Success") {
        expect(next.value).toBe("ok")
        expect(Exit.isSuccess(next.exit)).toBe(true)
      }
    })
  )

  it.scoped("captures failure cause", () =>
    Effect.gen(function* () {
      const resource = yield* Signal.resource(
        Effect.gen(function* () {
          yield* Effect.sleep("10 millis")
          return yield* Effect.fail("bad")
        })
      )

      yield* TestClock.adjust("20 millis")

      const state = yield* Signal.get(resource.state)
      expect(state._tag).toBe("Failure")
      if (state._tag === "Failure") {
        const failure = Cause.failureOption(state.cause)
        expect(Option.isSome(failure)).toBe(true)
        if (Option.isSome(failure)) {
          expect(failure.value).toBe("bad")
        }
      }
    })
  )

  it.scoped("refreshes implicitly and keeps previous value", () =>
    Effect.gen(function* () {
      const userId = yield* Signal.make(1)
      const resource = yield* Signal.resource(
        Effect.gen(function* () {
          const id = yield* Signal.get(userId)
          yield* Effect.sleep("10 millis")
          return id
        })
      )

      yield* TestClock.adjust("20 millis")

      const initial = yield* Signal.get(resource.state)
      expect(initial._tag).toBe("Success")
      if (initial._tag === "Success") {
        expect(initial.value).toBe(1)
      }

      yield* Signal.set(userId, 2)

      const refreshing = yield* Signal.get(resource.state)
      expect(refreshing._tag).toBe("Refreshing")
      if (refreshing._tag === "Refreshing") {
        expect(Exit.isSuccess(refreshing.previous)).toBe(true)
        if (Exit.isSuccess(refreshing.previous)) {
          expect(refreshing.previous.value).toBe(1)
        }
      }

      yield* TestClock.adjust("20 millis")

      const updated = yield* Signal.get(resource.state)
      expect(updated._tag).toBe("Success")
      if (updated._tag === "Success") {
        expect(updated.value).toBe(2)
      }
    })
  )

  it.effect("cleans up dependency subscriptions on scope close", () =>
    Effect.gen(function* () {
      const userId = yield* Signal.make(1)
      const initialListeners = userId._listeners.size

      yield* Effect.scoped(
        Effect.gen(function* () {
          const resource = yield* Signal.resource(
            Effect.gen(function* () {
              const id = yield* Signal.get(userId)
              yield* Effect.sleep("10 millis")
              return id
            })
          )

          yield* TestClock.adjust("20 millis")

          const state = yield* Signal.get(resource.state)
          expect(state._tag).toBe("Success")
          expect(userId._listeners.size).toBe(initialListeners + 1)
        })
      )

      expect(userId._listeners.size).toBe(initialListeners)
    })
  )
})
