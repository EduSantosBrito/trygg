/**
 * Router popstate listener lifecycle tests
 * F-004: popstate listener not removed
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "@effect/vitest"
import { Effect, ManagedRuntime } from "effect"
import { Router, browserLayer } from "../src/router/RouterService"

describe("Router popstate listener lifecycle", () => {
  // Track listener additions and removals
  let addedListeners: Array<{ type: string; listener: EventListener }> = []
  let removedListeners: Array<{ type: string; listener: EventListener }> = []
  
  beforeEach(() => {
    addedListeners = []
    removedListeners = []
    
    // Mock window
    vi.stubGlobal("window", {
      location: { pathname: "/", search: "" },
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
        back: vi.fn(),
        forward: vi.fn()
      },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        addedListeners.push({ type, listener })
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        removedListeners.push({ type, listener })
      })
    })
  })
  
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  
  describe("popstate listener registration", () => {
    it("adds popstate listener when layer is built", async () => {
      const runtime = ManagedRuntime.make(browserLayer)
      
      // Use the router (triggers layer build)
      await runtime.runPromise(Effect.flatMap(Router, () => Effect.void))
      
      // Verify listener was added
      const popstateListeners = addedListeners.filter(l => l.type === "popstate")
      expect(popstateListeners.length).toBe(1)
      
      await runtime.dispose()
    })
    
    it("removes popstate listener when scope closes", async () => {
      const runtime = ManagedRuntime.make(browserLayer)
      
      // Use the router
      await runtime.runPromise(Effect.flatMap(Router, () => Effect.void))
      
      // Verify listener was added
      expect(addedListeners.filter(l => l.type === "popstate").length).toBe(1)
      expect(removedListeners.filter(l => l.type === "popstate").length).toBe(0)
      
      // Dispose (closes scope)
      await runtime.dispose()
      
      // Verify listener was removed
      const removedPopstate = removedListeners.filter(l => l.type === "popstate")
      expect(removedPopstate.length).toBe(1)
      
      // Same listener that was added should be removed
      const addedListener = addedListeners.find(l => l.type === "popstate")?.listener
      const removedListener = removedListeners.find(l => l.type === "popstate")?.listener
      expect(addedListener).toBe(removedListener)
    })
    
    it("after unmount listener count returns to zero", async () => {
      // Track net popstate listeners
      let activePopstateCount = 0
      
      vi.stubGlobal("window", {
        location: { pathname: "/", search: "" },
        history: {
          pushState: vi.fn(),
          replaceState: vi.fn(),
          back: vi.fn(),
          forward: vi.fn()
        },
        addEventListener: vi.fn((type: string) => {
          if (type === "popstate") activePopstateCount++
        }),
        removeEventListener: vi.fn((type: string) => {
          if (type === "popstate") activePopstateCount--
        })
      })
      
      const runtime = ManagedRuntime.make(browserLayer)
      
      await runtime.runPromise(Effect.flatMap(Router, () => Effect.void))
      expect(activePopstateCount).toBe(1)
      
      await runtime.dispose()
      expect(activePopstateCount).toBe(0)
    })
  })
  
  describe("duplicate registration guard", () => {
    it("remount creates only one new listener", async () => {
      // First mount
      const runtime1 = ManagedRuntime.make(browserLayer)
      await runtime1.runPromise(Effect.flatMap(Router, () => Effect.void))
      
      // Unmount
      await runtime1.dispose()
      
      // Clear tracking
      const addedBefore = addedListeners.length
      
      // Second mount
      const runtime2 = ManagedRuntime.make(browserLayer)
      await runtime2.runPromise(Effect.flatMap(Router, () => Effect.void))
      
      // Verify only one new listener was added (not duplicates)
      const newAdded = addedListeners.slice(addedBefore).filter(l => l.type === "popstate")
      expect(newAdded.length).toBe(1)
      
      // Cleanup
      await runtime2.dispose()
    })
    
    it("each router service instance owns its own listener", async () => {
      let activeCount = 0
      
      vi.stubGlobal("window", {
        location: { pathname: "/", search: "" },
        history: {
          pushState: vi.fn(),
          replaceState: vi.fn(),
          back: vi.fn(),
          forward: vi.fn()
        },
        addEventListener: vi.fn((type: string) => {
          if (type === "popstate") activeCount++
        }),
        removeEventListener: vi.fn((type: string) => {
          if (type === "popstate") activeCount--
        })
      })
      
      // Create two independent router runtimes (simulating two apps)
      const runtime1 = ManagedRuntime.make(browserLayer)
      const runtime2 = ManagedRuntime.make(browserLayer)
      
      await runtime1.runPromise(Effect.flatMap(Router, () => Effect.void))
      expect(activeCount).toBe(1)
      
      await runtime2.runPromise(Effect.flatMap(Router, () => Effect.void))
      expect(activeCount).toBe(2)
      
      // Close first runtime
      await runtime1.dispose()
      expect(activeCount).toBe(1)
      
      // Close second runtime
      await runtime2.dispose()
      expect(activeCount).toBe(0)
    })
  })
  
  describe("ManagedRuntime integration", () => {
    it("listener is removed when ManagedRuntime disposes", async () => {
      let activeCount = 0
      
      vi.stubGlobal("window", {
        location: { pathname: "/", search: "" },
        history: {
          pushState: vi.fn(),
          replaceState: vi.fn(),
          back: vi.fn(),
          forward: vi.fn()
        },
        addEventListener: vi.fn((type: string) => {
          if (type === "popstate") activeCount++
        }),
        removeEventListener: vi.fn((type: string) => {
          if (type === "popstate") activeCount--
        })
      })
      
      // Create ManagedRuntime (typical app usage)
      const runtime = ManagedRuntime.make(browserLayer)
      
      // Use the runtime
      await runtime.runPromise(Effect.flatMap(Router, () => Effect.void))
      expect(activeCount).toBe(1)
      
      // Dispose runtime (app unmount)
      await runtime.dispose()
      expect(activeCount).toBe(0)
    })
  })
})
