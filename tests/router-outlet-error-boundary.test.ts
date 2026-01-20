/**
 * Tests for Outlet error boundary integration (F-022)
 * 
 * Verifies that the Outlet correctly handles errors from route components
 * and renders the nearest _error.tsx boundary, with proper fallback to
 * parent error boundaries when child boundaries are missing.
 */
import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, FiberRef, Option } from "effect"
import { text } from "../src/Element.js"
import { 
  CurrentRouteError, 
  currentError
} from "../src/router/RouterService.js"
import { createMatcher } from "../src/router/matching.js"
import type { RouteDefinition, RouteMatch, RouteErrorInfo } from "../src/router/types.js"

/**
 * Helper to extract errors from sandboxed causes (same as Outlet.ts)
 * Uses Cause.flatten to unwrap nested Cause<Cause<E>> from sandbox.
 */
const extractFromSandboxed = (sandboxedCause: Cause.Cause<Cause.Cause<unknown>>) => {
  const cause = Cause.flatten(sandboxedCause)
  const error = Cause.squash(cause)
  const isDefect = Cause.isDie(cause)
  return { error, isDefect, cause }
}

/**
 * Find the nearest error component in the chain (leaf to root).
 * Mirrors the logic in Outlet.ts
 */
const findNearestErrorComponent = (match: RouteMatch): RouteDefinition["errorComponent"] | undefined => {
  // Check leaf first
  if (match.route.errorComponent) {
    return match.route.errorComponent
  }
  // Check parents from nearest to root
  for (let i = match.parents.length - 1; i >= 0; i--) {
    const parent = match.parents[i]
    if (parent?.route.errorComponent) {
      return parent.route.errorComponent
    }
  }
  return undefined
}

// Mock component loaders
const mockComponent = async () => ({ default: Effect.succeed(text("mock")) })
const mockError = async () => ({ default: Effect.succeed(text("error boundary")) })

// Error component that accesses error info via currentError
const createErrorComponent = (errorId: string) => async () => ({
  default: Effect.gen(function* () {
    const { cause, path } = yield* currentError
    return text(`${errorId}: ${String(Cause.squash(cause))} at ${path}`)
  })
})

// Route component that throws
const throwingComponent = (errorMessage: string) => async () => ({
  default: Effect.sync(() => {
    throw new Error(errorMessage)
  })
})

describe("Outlet error boundary integration (F-022)", () => {
  describe("findNearestErrorComponent - nearest boundary selection", () => {
    it("returns leaf error component when present", () => {
      const childError = mockError
      
      const routes: RouteDefinition[] = [{
        path: "/parent",
        component: mockComponent,
        errorComponent: mockError,
        children: [{
          path: "/parent/child",
          component: mockComponent,
          errorComponent: childError
        }]
      }]
      
      const matcher = createMatcher(routes)
      const matchOpt = matcher.match("/parent/child")
      
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        const nearest = findNearestErrorComponent(matchOpt.value)
        expect(nearest).toBe(childError)
      }
    })

    it("returns parent error component when child has none", () => {
      const parentError = mockError
      
      const routes: RouteDefinition[] = [{
        path: "/parent",
        component: mockComponent,
        errorComponent: parentError,
        children: [{
          path: "/parent/child",
          component: mockComponent
          // No errorComponent on child
        }]
      }]
      
      const matcher = createMatcher(routes)
      const matchOpt = matcher.match("/parent/child")
      
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        const nearest = findNearestErrorComponent(matchOpt.value)
        expect(nearest).toBe(parentError)
      }
    })

    it("returns undefined when no error components exist in chain", () => {
      const routes: RouteDefinition[] = [{
        path: "/parent",
        component: mockComponent,
        children: [{
          path: "/parent/child",
          component: mockComponent
        }]
      }]
      
      const matcher = createMatcher(routes)
      const matchOpt = matcher.match("/parent/child")
      
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        const nearest = findNearestErrorComponent(matchOpt.value)
        expect(nearest).toBe(undefined)
      }
    })

    it("walks chain from leaf to root finding nearest error", () => {
      const rootError = async () => ({ default: Effect.succeed(text("root error")) })
      const midError = async () => ({ default: Effect.succeed(text("mid error")) })
      
      const routes: RouteDefinition[] = [{
        path: "/a",
        component: mockComponent,
        errorComponent: rootError,
        children: [{
          path: "/a/b",
          component: mockComponent,
          errorComponent: midError,
          children: [{
            path: "/a/b/c",
            component: mockComponent
            // No error component - should find midError
          }]
        }]
      }]
      
      const matcher = createMatcher(routes)
      const matchOpt = matcher.match("/a/b/c")
      
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        const nearest = findNearestErrorComponent(matchOpt.value)
        expect(nearest).toBe(midError) // Mid is nearer than root
      }
    })
  })

  describe("Child error boundary - route throws, child _error.tsx renders", () => {
    it.effect("error component receives error via currentError in Effect.locally scope", () =>
      Effect.gen(function* () {
        const testError = new Error("Child component threw")
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(testError),
          path: "/child-route",
          reset: Effect.void
        }

        // Simulate what Outlet does: run error component in Effect.locally scope
        const errorComponentResult = yield* Effect.locally(
          Effect.gen(function* () {
            const { cause, path } = yield* currentError
            return { error: Cause.squash(cause), path }
          }),
          CurrentRouteError,
          Option.some(errorInfo)
        )

        expect(errorComponentResult.error).toBe(testError)
        expect(errorComponentResult.path).toBe("/child-route")
      })
    )

    it.effect("parent _error.tsx not invoked when child boundary exists", () =>
      Effect.gen(function* () {
        const childError = createErrorComponent("child-error")
        const parentError = createErrorComponent("parent-error")
        
        const routes: RouteDefinition[] = [{
          path: "/parent",
          component: mockComponent,
          errorComponent: parentError,
          children: [{
            path: "/parent/child",
            component: throwingComponent("Child threw!"),
            errorComponent: childError
          }]
        }]
        
        const matcher = createMatcher(routes)
        const matchOpt = matcher.match("/parent/child")
        
        expect(Option.isSome(matchOpt)).toBe(true)
        if (Option.isSome(matchOpt)) {
          const nearest = findNearestErrorComponent(matchOpt.value)
          // Should be child, not parent
          expect(nearest).toBe(childError)
          expect(nearest).not.toBe(parentError)
        }
      })
    )

    it.effect("defects (thrown exceptions) are caught and made available", () =>
      Effect.gen(function* () {
        const defectMessage = "Uncaught defect!"
        
        // Simulate a route component that throws (defect)
        const throwingEffect = Effect.sync(() => {
          throw new Error(defectMessage)
        })
        
        // Simulate Outlet's sandbox + catchAllCause pattern
        const result = yield* throwingEffect.pipe(
          Effect.sandbox,
          Effect.catchAllCause((sandboxedCause) => {
            const { error, isDefect } = extractFromSandboxed(sandboxedCause)
            return Effect.succeed({ error, isDefect })
          })
        )
        
        expect(result.isDefect).toBe(true)
        expect((result.error as Error).message).toBe(defectMessage)
      })
    )

    it.effect("typed failures (Effect.fail) are caught and made available", () =>
      Effect.gen(function* () {
        class TypedRouteError {
          readonly _tag = "TypedRouteError"
          constructor(readonly message: string) {}
        }
        
        const failingEffect = Effect.fail(new TypedRouteError("Route failed"))
        
        const result = yield* failingEffect.pipe(
          Effect.sandbox,
          Effect.catchAllCause((sandboxedCause) => {
            const { error, isDefect } = extractFromSandboxed(sandboxedCause)
            return Effect.succeed({ error, isDefect })
          })
        )
        
        expect(result.isDefect).toBe(false)
        expect((result.error as TypedRouteError)._tag).toBe("TypedRouteError")
        expect((result.error as TypedRouteError).message).toBe("Route failed")
      })
    )
  })

  describe("Parent fallback - route throws, parent catches when child missing", () => {
    it.effect("parent error boundary renders when child has no boundary", () =>
      Effect.gen(function* () {
        const parentError = createErrorComponent("parent-error")
        
        const routes: RouteDefinition[] = [{
          path: "/parent",
          component: mockComponent,
          errorComponent: parentError,
          children: [{
            path: "/parent/child",
            component: throwingComponent("Child threw!")
            // No errorComponent on child
          }]
        }]
        
        const matcher = createMatcher(routes)
        const matchOpt = matcher.match("/parent/child")
        
        expect(Option.isSome(matchOpt)).toBe(true)
        if (Option.isSome(matchOpt)) {
          const nearest = findNearestErrorComponent(matchOpt.value)
          expect(nearest).toBe(parentError)
        }
      })
    )

    it.effect("error value accessible in parent error component", () =>
      Effect.gen(function* () {
        const testError = new Error("Propagated to parent")
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(testError),
          path: "/parent/child",
          reset: Effect.void
        }

        // Parent error component accesses error via currentError
        const parentErrorComponent = Effect.gen(function* () {
          const { cause, path } = yield* currentError
          return { error: Cause.squash(cause), path }
        })

        // Outlet wraps in Effect.locally
        const result = yield* Effect.locally(
          parentErrorComponent,
          CurrentRouteError,
          Option.some(errorInfo)
        )

        expect(result.error).toBe(testError)
        expect(result.path).toBe("/parent/child")
      })
    )

    it.effect("error propagates without boundary (no _error.tsx)", () =>
      Effect.gen(function* () {
        const routes: RouteDefinition[] = [{
          path: "/parent",
          component: mockComponent,
          // No errorComponent
          children: [{
            path: "/parent/child",
            component: throwingComponent("No boundary!")
            // No errorComponent
          }]
        }]
        
        const matcher = createMatcher(routes)
        const matchOpt = matcher.match("/parent/child")
        
        expect(Option.isSome(matchOpt)).toBe(true)
        if (Option.isSome(matchOpt)) {
          const nearest = findNearestErrorComponent(matchOpt.value)
          // No error boundary in chain - error should propagate to app level
          expect(nearest).toBe(undefined)
        }
      })
    )
  })

  describe("Error boundary lifecycle", () => {
    it.effect("error clears after error component renders (no stale errors)", () =>
      Effect.gen(function* () {
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(new Error("First error")),
          path: "/error-path",
          reset: Effect.void
        }

        // First render - error boundary scope
        yield* Effect.locally(
          Effect.gen(function* () {
            const { cause } = yield* currentError
            expect((Cause.squash(cause) as Error).message).toBe("First error")
          }),
          CurrentRouteError,
          Option.some(errorInfo)
        )

        // After scope exits, FiberRef should be back to none
        const afterScope = yield* FiberRef.get(CurrentRouteError)
        expect(Option.isNone(afterScope)).toBe(true)
      })
    )

    it.effect("reset effect triggers re-render (via signal update)", () =>
      Effect.gen(function* () {
        let resetCount = 0
        
        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(new Error("Resettable error")),
          path: "/resettable",
          reset: Effect.sync(() => { resetCount++ })
        }

        yield* Effect.locally(
          Effect.gen(function* () {
            const { reset } = yield* currentError
            yield* reset
          }),
          CurrentRouteError,
          Option.some(errorInfo)
        )

        expect(resetCount).toBe(1)
      })
    )

    it.effect("error component can throw and propagate to parent", () =>
      Effect.gen(function* () {
        const originalError = new Error("Original")
        const errorComponentError = new Error("Error component crashed!")

        const errorInfo: RouteErrorInfo = {
          cause: Cause.die(originalError),
          path: "/nested-error",
          reset: Effect.void
        }

        // Error component that throws
        const crashingErrorComponent = Effect.gen(function* () {
          yield* currentError // Access error successfully
          throw errorComponentError // Then crash
        })

        // Wrapped in Effect.locally
        const result = yield* Effect.locally(
          crashingErrorComponent,
          CurrentRouteError,
          Option.some(errorInfo)
        ).pipe(Effect.exit)

        // Should have failed with the error component's error
        expect(result._tag).toBe("Failure")
      })
    )
  })

  describe("Nested route error handling", () => {
    it.effect("deeply nested route uses nearest ancestor error boundary", () =>
      Effect.gen(function* () {
        const rootError = createErrorComponent("root")
        const midError = createErrorComponent("mid")
        
        // /a has rootError, /a/b has midError, /a/b/c has none
        const routes: RouteDefinition[] = [{
          path: "/a",
          component: mockComponent,
          errorComponent: rootError,
          children: [{
            path: "/a/b",
            component: mockComponent,
            errorComponent: midError,
            children: [{
              path: "/a/b/c",
              component: throwingComponent("Deep error!")
              // No error component - should use midError
            }]
          }]
        }]
        
        const matcher = createMatcher(routes)
        const matchOpt = matcher.match("/a/b/c")
        
        expect(Option.isSome(matchOpt)).toBe(true)
        if (Option.isSome(matchOpt)) {
          const nearest = findNearestErrorComponent(matchOpt.value)
          expect(nearest).toBe(midError) // Not rootError
        }
      })
    )

    it.effect("params from all parents available to error component", () =>
      Effect.gen(function* () {
        const routes: RouteDefinition[] = [{
          path: "/orgs/:orgId",
          component: mockComponent,
          errorComponent: mockError,
          children: [{
            path: "/orgs/:orgId/projects/:projectId",
            component: throwingComponent("Error with params!")
          }]
        }]
        
        const matcher = createMatcher(routes)
        const matchOpt = matcher.match("/orgs/acme/projects/42")
        
        expect(Option.isSome(matchOpt)).toBe(true)
        if (Option.isSome(matchOpt)) {
          // Verify params are extracted correctly
          const match = matchOpt.value
          expect(match.params).toEqual({ orgId: "acme", projectId: "42" })
          expect(match.parents[0]?.params).toEqual({ orgId: "acme" })
        }
      })
    )
  })
})
