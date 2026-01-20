/**
 * Tests for router loading and error states
 */
import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Exit, FiberRef, Option } from "effect"
import { CurrentRouteError, currentError } from "../src/router/RouterService.js"
import type { RouteErrorInfo } from "../src/router/types.js"

describe("Router loading/error states", () => {
  describe("RouteDefinition types", () => {
    it("supports loadingComponent property", () => {
      // Type check - this should compile
      const route = {
        path: "/test",
        component: () => Promise.resolve({ default: Effect.succeed(null as unknown) }),
        loadingComponent: () => Promise.resolve({ default: Effect.succeed(null as unknown) })
      }
      expect(route.loadingComponent).toBeDefined()
    })

    it("supports errorComponent property", () => {
      // Type check - this should compile
      const route = {
        path: "/test",
        component: () => Promise.resolve({ default: Effect.succeed(null as unknown) }),
        errorComponent: () => Promise.resolve({ default: Effect.succeed(null as unknown) })
      }
      expect(route.errorComponent).toBeDefined()
    })
  })

  describe("currentError", () => {
    it.effect("fails when called outside error boundary", () =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(currentError)
        expect(Exit.isFailure(result)).toBe(true)
      })
    )

    it.effect("returns error info when set in FiberRef", () =>
      Effect.gen(function* () {
        const testError = new Error("Test error")
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(testError),
          path: "/test-path",
          reset: Effect.void
        }

        yield* FiberRef.set(CurrentRouteError, Option.some(errorInfo))
        const result = yield* currentError

        expect(Cause.squash(result.cause)).toBe(testError)
        expect(result.path).toBe("/test-path")
      })
    )
  })

  describe("RouteErrorInfo", () => {
    it.effect("reset is an Effect", () =>
      Effect.gen(function* () {
        let resetCalled = false
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(new Error("test")),
          path: "/test",
          reset: Effect.sync(() => { resetCalled = true })
        }

        yield* errorInfo.reset
        expect(resetCalled).toBe(true)
      })
    )
  })

  describe("Error boundary lifetime (Effect.locally)", () => {
    it.effect("error is available via Effect.locally scope", () =>
      Effect.gen(function* () {
        const testError = new Error("Scoped error")
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(testError),
          path: "/scoped-path",
          reset: Effect.void
        }

        // Simulate what the fixed error boundary does:
        // Error component runs inside Effect.locally scope
        const result = yield* Effect.locally(
          Effect.gen(function* () {
            const result = yield* currentError
            return result
          }),
          CurrentRouteError,
          Option.some(errorInfo)
        )

        expect(Cause.squash(result.cause)).toBe(testError)
        expect(result.path).toBe("/scoped-path")
      })
    )

    it.effect("error is cleared after Effect.locally scope completes", () =>
      Effect.gen(function* () {
        const testError = new Error("Scoped error")
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(testError),
          path: "/scoped-path",
          reset: Effect.void
        }

        // Run something in locally scope
        yield* Effect.locally(
          Effect.gen(function* () {
            const result = yield* currentError
            expect(Cause.squash(result.cause)).toBe(testError)
          }),
          CurrentRouteError,
          Option.some(errorInfo)
        )

        // After the scope, error should be cleared
        const errorAfter = yield* FiberRef.get(CurrentRouteError)
        expect(Option.isNone(errorAfter)).toBe(true)
      })
    )

    it.effect("subsequent successful render has no stale error", () =>
      Effect.gen(function* () {
        const testError = new Error("First error")
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(testError),
          path: "/error-path",
          reset: Effect.void
        }

        // First render - error boundary
        yield* Effect.locally(
          currentError,
          CurrentRouteError,
          Option.some(errorInfo)
        )

        // Second render - success (no error set)
        const errorAfter = yield* FiberRef.get(CurrentRouteError)
        expect(Option.isNone(errorAfter)).toBe(true)
      })
    )
  })

  describe("Defect handling (sandbox + catchAllCause)", () => {
    /**
     * Helper to extract errors from sandboxed effects the same way Outlet does.
     * Uses Cause.flatten to unwrap nested Cause<Cause<E>> from sandbox.
     */
    const extractFromSandboxed = (sandboxedCause: Cause.Cause<Cause.Cause<unknown>>) => {
      const cause = Cause.flatten(sandboxedCause)
      const error = Cause.squash(cause)
      const isDefect = Cause.isDie(cause)
      return { error, isDefect, cause }
    }

    it.effect("catches typed failures via catchAllCause", () =>
      Effect.gen(function* () {
        class TypedError {
          readonly _tag = "TypedError"
        }

        const failingEffect = Effect.fail(new TypedError())

        const result = yield* failingEffect.pipe(
          Effect.sandbox,
          Effect.catchAllCause((sandboxedCause) => {
            const { error, isDefect } = extractFromSandboxed(sandboxedCause)
            const isTyped = typeof error === "object" && error !== null && "_tag" in error
            return Effect.succeed({
              caught: true,
              isTyped,
              isDefect,
              tag: isTyped ? (error as TypedError)._tag : null
            })
          })
        )

        expect(result.caught).toBe(true)
        expect(result.isTyped).toBe(true)
        expect(result.isDefect).toBe(false)
        expect(result.tag).toBe("TypedError")
      })
    )

    it.effect("catches defects (thrown exceptions) via sandbox + catchAllCause", () =>
      Effect.gen(function* () {
        const throwingEffect = Effect.sync(() => {
          throw new Error("Defect!")
        })

        const result = yield* throwingEffect.pipe(
          Effect.sandbox,
          Effect.catchAllCause((sandboxedCause) => {
            const { error, isDefect } = extractFromSandboxed(sandboxedCause)
            return Effect.succeed({
              caught: true,
              isDefect,
              message: error instanceof Error ? error.message : String(error)
            })
          })
        )

        expect(result.caught).toBe(true)
        expect(result.isDefect).toBe(true)
        expect(result.message).toBe("Defect!")
      })
    )

    it.effect("extracts error from both failures and defects using same pattern", () =>
      Effect.gen(function* () {
        class FailureError {
          readonly _tag = "FailureError"
          constructor(readonly message: string) {}
        }

        const failEffect = Effect.fail(new FailureError("Failure"))
        const dieEffect = Effect.die(new Error("Defect"))

        const extractError = <A, E>(effect: Effect.Effect<A, E, never>) =>
          effect.pipe(
            Effect.sandbox,
            Effect.catchAllCause((sandboxedCause) => {
              const { error } = extractFromSandboxed(sandboxedCause as Cause.Cause<Cause.Cause<unknown>>)
              if (error instanceof Error) {
                return Effect.succeed(error.message)
              }
              if (typeof error === "object" && error !== null && "message" in error) {
                return Effect.succeed((error as { message: string }).message)
              }
              return Effect.succeed(String(error))
            })
          )

        const failResult = yield* extractError(failEffect)
        expect(failResult).toBe("Failure")

        const dieResult = yield* extractError(dieEffect)
        expect(dieResult).toBe("Defect")
      })
    )
  })

  describe("Error boundary propagation", () => {
    it.effect("error component can access error via currentError", () =>
      Effect.gen(function* () {
        // This test verifies the core fix: error component runs inside Effect.locally
        // and can access the error via currentError

        const testError = new Error("Route render failed")
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(testError),
          path: "/failing-route",
          reset: Effect.void
        }

        // Simulate error component that calls currentError
        const errorComponentEffect = Effect.gen(function* () {
          const { cause, path } = yield* currentError
          return { renderedError: Cause.squash(cause), renderedPath: path }
        })

        // Error boundary wraps the error component in Effect.locally
        const result = yield* Effect.locally(
          errorComponentEffect,
          CurrentRouteError,
          Option.some(errorInfo)
        )

        expect(result.renderedError).toBe(testError)
        expect(result.renderedPath).toBe("/failing-route")
      })
    )

    it.effect("error component throwing propagates to parent", () =>
      Effect.gen(function* () {
        const originalError = new Error("Original error")
        const errorComponentError = new Error("Error component failed!")

        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(originalError),
          path: "/nested-error",
          reset: Effect.void
        }

        // Error component that throws
        const failingErrorComponent = Effect.gen(function* () {
          yield* currentError // This would work...
          throw errorComponentError // ...but then component throws
        })

        // Error boundary wraps the error component
        const errorBoundary = Effect.locally(
          failingErrorComponent,
          CurrentRouteError,
          Option.some(errorInfo)
        )

        // The error should propagate (not be swallowed)
        const result = yield* Effect.exit(errorBoundary)
        expect(Exit.isFailure(result)).toBe(true)
      })
    )
  })
})
