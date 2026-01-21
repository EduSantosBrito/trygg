/**
 * Suspense Rendering Test
 * 
 * Tests that Suspense elements render correctly, swapping fallback for resolved content.
 * Uses debug collector plugin to verify the rendering flow.
 */
import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, TestClock, Scope } from "effect"
import { render } from "../src/testing.js"
import * as Debug from "../src/debug.js"
import { Element, suspense, componentElement } from "../src/Element.js"
import * as Signal from "../src/Signal.js"

describe("Suspense rendering", () => {
  it.scoped("renders fallback then swaps to resolved content", () =>
    Effect.gen(function* () {
      const events: Debug.DebugEvent[] = []
      const collector = Debug.createCollectorPlugin("test-collector", events)
      
      Debug.enable()
      Debug.registerPlugin(collector)
      
      const deferred = yield* Deferred.make<Element, unknown>()
      const fallbackElement = <div data-testid="fallback">Loading...</div>
      const suspenseElement = suspense(deferred, fallbackElement)
      
      const result = yield* render(suspenseElement)
      
      expect(result.queryByTestId("fallback")).not.toBeNull()
      
      yield* TestClock.adjust("10 millis")
      
      console.log("Events before resolve:", events.map(e => e.event))
      
      expect(events.some(e => e.event === "render.suspense.start")).toBe(true)
      expect(events.some(e => e.event === "render.suspense.fallback")).toBe(true)
      expect(events.some(e => e.event === "render.suspense.wait.start")).toBe(true)
      
      const resolvedElement = <div data-testid="resolved">Resolved Content</div>
      yield* Deferred.succeed(deferred, resolvedElement)
      
      yield* TestClock.adjust("100 millis")
      
      console.log("Events after resolve:", events.map(e => e.event))
      
      expect(events.some(e => e.event === "render.suspense.resolved.rendered")).toBe(true)
      expect(result.queryByTestId("resolved")).not.toBeNull()
      expect(result.queryByTestId("fallback")).toBeNull()
      
      Debug.unregisterPlugin("test-collector")
      Debug.disable()
    })
  )
  
  it.scoped("handles Component elements in resolved content", () =>
    Effect.gen(function* () {
      const events: Debug.DebugEvent[] = []
      const collector = Debug.createCollectorPlugin("test-collector", events)
      
      Debug.enable()
      Debug.registerPlugin(collector)
      
      const deferred = yield* Deferred.make<Element, unknown>()
      const fallbackElement = <span data-testid="loading">Loading</span>
      const suspenseElement = suspense(deferred, fallbackElement)
      
      const result = yield* render(suspenseElement)
      
      expect(result.queryByTestId("loading")).not.toBeNull()
      
      const ComponentContent = Effect.gen(function* () {
        return <div data-testid="component-content">Component Rendered</div>
      })
      const compElement = componentElement(() => ComponentContent)
      
      yield* Deferred.succeed(deferred, compElement)
      yield* TestClock.adjust("100 millis")
      
      console.log("Component test events:", events.map(e => e.event))
      console.log("Container HTML:", result.container.innerHTML)
      
      expect(result.queryByTestId("component-content")).not.toBeNull()
      expect(result.queryByTestId("loading")).toBeNull()
      
      Debug.unregisterPlugin("test-collector")
      Debug.disable()
    })
  )

  it.scoped("handles pre-resolved deferred", () =>
    Effect.gen(function* () {
      const events: Debug.DebugEvent[] = []
      const collector = Debug.createCollectorPlugin("test-collector", events)
      
      Debug.enable()
      Debug.registerPlugin(collector)
      
      const deferred = yield* Deferred.make<Element, unknown>()
      
      // Resolve BEFORE rendering
      const resolvedElement = <div data-testid="pre-resolved">Pre-resolved</div>
      yield* Deferred.succeed(deferred, resolvedElement)
      
      const fallbackElement = <span data-testid="loading">Loading</span>
      const suspenseElement = suspense(deferred, fallbackElement)
      
      const result = yield* render(suspenseElement)
      
      yield* TestClock.adjust("100 millis")
      
      console.log("Pre-resolved events:", events.map(e => e.event))
      console.log("Container HTML:", result.container.innerHTML)
      
      expect(result.queryByTestId("pre-resolved")).not.toBeNull()
      
      Debug.unregisterPlugin("test-collector")
      Debug.disable()
    })
  )

  it.scoped("Component returning Suspense element (Outlet pattern)", () =>
    Effect.gen(function* () {
      const events: Debug.DebugEvent[] = []
      const collector = Debug.createCollectorPlugin("test-collector", events)
      
      Debug.enable()
      Debug.registerPlugin(collector)
      
      // This mimics the Outlet pattern:
      // Component effect creates deferred, forks loader, returns Suspense
      const OutletLike = componentElement(() => Effect.gen(function* () {
        const deferred = yield* Deferred.make<Element, unknown>()
        
        // Fork a fiber that resolves the deferred (like route loading)
        yield* Effect.fork(
          Effect.gen(function* () {
            yield* Effect.sleep("10 millis")
            const routeContent = <div data-testid="route-content">Route Loaded</div>
            yield* Deferred.succeed(deferred, routeContent)
          })
        )
        
        const loading = <span data-testid="loading">Loading route...</span>
        return suspense(deferred, loading)
      }))
      
      const result = yield* render(OutletLike)
      
      console.log("Initial HTML:", result.container.innerHTML)
      
      // Check initial state - loading should be visible!
      const initialLoading = result.queryByTestId("loading")
      console.log("Initial loading visible:", initialLoading !== null)
      console.log("Initial loading in DOM:", initialLoading?.isConnected)
      
      // Let fibers run
      yield* TestClock.adjust("50 millis")
      
      console.log("After 50ms HTML:", result.container.innerHTML)
      console.log("Outlet pattern events:", events.map(e => e.event))
      
      const routeContent = result.queryByTestId("route-content")
      const loading = result.queryByTestId("loading")
      
      console.log("route-content found:", routeContent !== null)
      console.log("loading found:", loading !== null)
      
      expect(routeContent).not.toBeNull()
      expect(routeContent?.textContent).toBe("Route Loaded")
      expect(loading).toBeNull()
      
      Debug.unregisterPlugin("test-collector")
      Debug.disable()
    })
  )

  it.scoped("Component re-render with new Suspense (navigation pattern)", () =>
    Effect.gen(function* () {
      const events: Debug.DebugEvent[] = []
      const collector = Debug.createCollectorPlugin("test-collector", events)
      
      Debug.enable()
      Debug.registerPlugin(collector)
      
      // Signal to trigger re-render (simulates route change)
      const routeSignal = yield* Signal.make(1)
      
      // Component that returns different Suspense on each render
      // Using Outlet's pattern: forkIn with its own scope
      const RouterLike = componentElement(() => Effect.gen(function* () {
        const route = yield* Signal.get(routeSignal)
        
        const deferred = yield* Deferred.make<Element, unknown>()
        
        // Create a separate scope for the loader fiber (like Outlet does)
        const loaderScope = yield* Scope.make()
        
        // Fork fiber to resolve deferred - use forkIn with dedicated scope
        yield* Effect.forkIn(
          Effect.gen(function* () {
            yield* Effect.sleep("10 millis")
            const content = <div data-testid={`route-${route}`}>Route {route} Content</div>
            yield* Deferred.succeed(deferred, content)
          }),
          loaderScope
        )
        
        const loading = <span data-testid="loading">Loading route {route}...</span>
        return suspense(deferred, loading)
      }))
      
      const result = yield* render(RouterLike)
      
      console.log("Initial HTML:", result.container.innerHTML)
      
      // Let first route load
      yield* TestClock.adjust("50 millis")
      
      console.log("After route 1 loads:", result.container.innerHTML)
      expect(result.queryByTestId("route-1")).not.toBeNull()
      
      // Trigger re-render (simulate navigation)
      events.length = 0  // Clear events
      yield* Signal.set(routeSignal, 2)
      
      // Let microtasks run
      yield* TestClock.adjust("1 millis")
      
      console.log("After signal change:", result.container.innerHTML)
      console.log("Events after navigation:", events.map(e => e.event))
      
      // Let second route load
      yield* TestClock.adjust("50 millis")
      
      console.log("After route 2 loads:", result.container.innerHTML)
      
      // Route 2 should be visible
      const route2 = result.queryByTestId("route-2")
      console.log("route-2 found:", route2 !== null)
      
      expect(route2).not.toBeNull()
      expect(route2?.textContent).toBe("Route 2 Content")
      
      Debug.unregisterPlugin("test-collector")
      Debug.disable()
    })
  )
})
