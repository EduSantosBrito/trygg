/**
 * Tests for Outlet matcher memoization (F-010)
 * 
 * Verifies:
 * 1. Matcher is compiled once per routes tree reference
 * 2. Re-renders with same routes → no recompile
 * 3. New routes reference → recompile
 * 4. Different Outlet instances → separate caches
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "@effect/vitest"
import { Effect, Layer, Scope } from "effect"
import * as Renderer from "../src/Renderer.js"
import * as Router from "../src/router/index.js"
import { text, Element } from "../src/Element.js"
import * as Debug from "../src/debug.js"
import type { RoutesManifest } from "../src/router/types.js"

/** Combined layer for Router + Renderer */
const testLayers = Layer.mergeAll(
  Renderer.browserLayer,
  Router.testLayer()
)

/**
 * Helper to run renderer effects with a clean DOM container and router.
 * Uses Effect.runPromise directly to avoid @effect/vitest scope interference.
 */
const withTestEnv = <A, E>(
  fn: (container: HTMLElement) => Effect.Effect<A, E, Scope.Scope | Renderer.Renderer | Router.Router>
): Effect.Effect<A, E, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const container = document.createElement("div")
      document.body.appendChild(container)
      
      try {
        return yield* fn(container)
      } finally {
        container.remove()
      }
    })
  ).pipe(Effect.provide(testLayers))

/**
 * Helper to render an element
 */
const renderElement: (
  container: HTMLElement,
  element: Element
) => Effect.Effect<Renderer.RenderResult, unknown, Scope.Scope | Renderer.Renderer> = Effect.fnUntraced(
  function* (container: HTMLElement, element: Element) {
    const renderer = yield* Renderer.Renderer
    return yield* renderer.render(element, container)
  }
)

/** Simple routes for testing */
const createTestRoutes = (): RoutesManifest => [
  {
    path: "/",
    component: () => Promise.resolve({ default: Effect.succeed(text("Home")) })
  },
  {
    path: "/about",
    component: () => Promise.resolve({ default: Effect.succeed(text("About")) })
  },
  {
    path: "/users/:id",
    component: () => Promise.resolve({ default: Effect.succeed(text("User")) })
  }
]

describe("Outlet matcher memoization (F-010)", () => {
  let compileCount = 0
  let cachedCount = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let logSpy: any
  
  beforeEach(() => {
    compileCount = 0
    cachedCount = 0
    Debug.enable("router.matcher")
    
    // Spy on the log function - must return Effect since Debug.log is now Effect-based
    const originalLog = Debug.log
    logSpy = vi.spyOn(Debug, "log").mockImplementation((event) => {
      if (event.event === "router.matcher.compile") {
        compileCount++
      } else if (event.event === "router.matcher.cached") {
        cachedCount++
      }
      return originalLog(event)
    })
  })
  
  afterEach(() => {
    Debug.disable()
    logSpy.mockRestore()
  })

  describe("Same routes reference", () => {
    // These tests use Effect.runPromise directly because they involve rendering + navigation
    // which requires careful scope management that conflicts with @effect/vitest's it.effect
    it("re-render with same routes → compile count is 1", async () => {
      await Effect.runPromise(
        withTestEnv((container) =>
          Effect.gen(function* () {
            const routes = createTestRoutes()
            const outlet = Router.Outlet({ routes })
            
            // Initial render - should compile once
            yield* renderElement(container, outlet)
            expect(compileCount).toBe(1)
            expect(cachedCount).toBe(0)
            
            // Navigate to trigger re-render
            const router = yield* Router.Router
            yield* router.navigate("/about")
            yield* Effect.sleep(10) // Wait for re-render
            
            // Should use cached matcher (not recompile)
            // compileCount should stay at 1, cachedCount should increase
            expect(compileCount).toBe(1)
          })
        )
      )
    })

    it("multiple navigations → compile count stays at 1", async () => {
      await Effect.runPromise(
        withTestEnv((container) =>
          Effect.gen(function* () {
            const routes = createTestRoutes()
            const outlet = Router.Outlet({ routes })
            
            yield* renderElement(container, outlet)
            expect(compileCount).toBe(1)
            
            const router = yield* Router.Router
            
            // Navigate multiple times
            yield* router.navigate("/about")
            yield* Effect.sleep(10)
            
            yield* router.navigate("/users/42")
            yield* Effect.sleep(10)
            
            yield* router.navigate("/")
            yield* Effect.sleep(10)
            
            // Should still be compiled only once
            expect(compileCount).toBe(1)
          })
        )
      )
    })
  })

  describe("Different routes reference", () => {
    it("new routes reference → recompile", async () => {
      await Effect.runPromise(
        withTestEnv((container) =>
          Effect.gen(function* () {
            // First routes instance
            const routes1 = createTestRoutes()
            const outlet1 = Router.Outlet({ routes: routes1 })
            
            yield* renderElement(container, outlet1)
            expect(compileCount).toBe(1)
            
            // Clear container
            container.innerHTML = ""
            
            // New routes instance (different reference)
            const routes2 = createTestRoutes()
            const outlet2 = Router.Outlet({ routes: routes2 })
            
            yield* renderElement(container, outlet2)
            
            // Should recompile for new routes reference
            // Each Outlet has its own cache, so creating a new Outlet compiles its matcher
            expect(compileCount).toBe(2)
          })
        )
      )
    })
  })

  describe("Different Outlet instances", () => {
    it("each Outlet has its own cache", async () => {
      await Effect.runPromise(
        withTestEnv((container) =>
          Effect.gen(function* () {
            // Same routes reference
            const routes = createTestRoutes()
            
            // Two separate outlets (even with same routes, different Outlet instances)
            const outlet1 = Router.Outlet({ routes })
            const outlet2 = Router.Outlet({ routes })
            
            yield* renderElement(container, outlet1)
            expect(compileCount).toBe(1)
            
            const container2 = document.createElement("div")
            document.body.appendChild(container2)
            
            try {
              yield* renderElement(container2, outlet2)
              // Second Outlet compiles its own matcher
              expect(compileCount).toBe(2)
            } finally {
              container2.remove()
            }
          })
        )
      )
    })
  })

  describe("Unmount/remount", () => {
    it("remount same Outlet reference → uses cached matcher", async () => {
      await Effect.runPromise(
        withTestEnv((container) =>
          Effect.gen(function* () {
            const routes = createTestRoutes()
            const outlet = Router.Outlet({ routes })
            
            // First render
            yield* renderElement(container, outlet)
            expect(compileCount).toBe(1)
            
            // Clear container (simulates unmount)
            container.innerHTML = ""
            
            // Re-render same Outlet instance
            yield* renderElement(container, outlet)
            
            // Same Outlet instance should still have cache in closure
            // Note: The Outlet function creates closure vars that persist
            expect(compileCount).toBe(1)
          })
        )
      )
    })
  })
})
