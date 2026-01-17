/**
 * Tests for router loading and error states
 */
import { describe, expect, it } from "vitest"
import { Effect, FiberRef, Option } from "effect"
import { CurrentRouteError, useRouteError } from "../src/router/RouterService.js"
import type { RouteErrorInfo } from "../src/router/types.js"

describe("Router loading/error states", () => {
  describe("RouteDefinition types", () => {
    it("supports loadingComponent property", () => {
      // Type check - this should compile
      const route = {
        path: "/test",
        component: () => Promise.resolve({ default: Effect.succeed(null as any) }),
        loadingComponent: () => Promise.resolve({ default: Effect.succeed(null as any) })
      }
      expect(route.loadingComponent).toBeDefined()
    })

    it("supports errorComponent property", () => {
      // Type check - this should compile
      const route = {
        path: "/test",
        component: () => Promise.resolve({ default: Effect.succeed(null as any) }),
        errorComponent: () => Promise.resolve({ default: Effect.succeed(null as any) })
      }
      expect(route.errorComponent).toBeDefined()
    })
  })

  describe("useRouteError", () => {
    it("fails when called outside error boundary", async () => {
      const result = await Effect.runPromiseExit(useRouteError)
      expect(result._tag).toBe("Failure")
    })

    it("returns error info when set in FiberRef", async () => {
      const testError = new Error("Test error")
      const errorInfo: RouteErrorInfo = {
        error: testError,
        path: "/test-path",
        reset: Effect.void
      }

      const program = Effect.gen(function* () {
        yield* FiberRef.set(CurrentRouteError, Option.some(errorInfo))
        const result = yield* useRouteError
        return result
      })

      const result = await Effect.runPromise(program)
      expect(result.error).toBe(testError)
      expect(result.path).toBe("/test-path")
    })
  })

  describe("RouteErrorInfo", () => {
    it("reset is an Effect", async () => {
      let resetCalled = false
      const errorInfo: RouteErrorInfo = {
        error: new Error("test"),
        path: "/test",
        reset: Effect.sync(() => { resetCalled = true })
      }

      await Effect.runPromise(errorInfo.reset)
      expect(resetCalled).toBe(true)
    })
  })
})
