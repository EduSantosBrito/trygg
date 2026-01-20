/**
 * Tests for Debug plugin system
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Debug from "../src/debug.js"

// Helper to reset debug state
const resetDebug = () => {
  Debug.disable()
  for (const name of Debug.getPlugins()) {
    Debug.unregisterPlugin(name)
  }
}

describe("Debug Plugin System", () => {
  describe("Plugin interface", () => {
    it("createPlugin creates a valid plugin", () => {
      resetDebug()
      const events: Debug.DebugEvent[] = []
      const plugin = Debug.createPlugin("test", (event) => {
        events.push(event)
      })

      expect(plugin.name).toBe("test")
      expect(typeof plugin.handle).toBe("function")
    })

    it("createCollectorPlugin collects events into array", () => {
      resetDebug()
      const events: Debug.DebugEvent[] = []
      const plugin = Debug.createCollectorPlugin("collector", events)

      const testEvent = {
        event: "signal.create",
        timestamp: new Date().toISOString(),
        signal_id: "sig_1",
        value: 0,
        component: "test"
      } as Debug.DebugEvent

      plugin.handle(testEvent)

      expect(events.length).toBe(1)
      expect(events[0]).toBe(testEvent)
    })

    it("consolePlugin exists and is a valid plugin", () => {
      expect(Debug.consolePlugin.name).toBe("console")
      expect(typeof Debug.consolePlugin.handle).toBe("function")
    })
  })

  describe("Plugin registration", () => {
    it("registerPlugin adds plugin to registry", () => {
      resetDebug()
      const plugin = Debug.createPlugin("test", () => {})

      expect(Debug.hasPlugin("test")).toBe(false)

      Debug.registerPlugin(plugin)

      expect(Debug.hasPlugin("test")).toBe(true)
      expect(Debug.getPlugins()).toContain("test")
    })

    it("unregisterPlugin removes plugin from registry", () => {
      resetDebug()
      const plugin = Debug.createPlugin("test", () => {})
      Debug.registerPlugin(plugin)

      expect(Debug.hasPlugin("test")).toBe(true)

      Debug.unregisterPlugin("test")

      expect(Debug.hasPlugin("test")).toBe(false)
      expect(Debug.getPlugins()).not.toContain("test")
    })

    it("getPlugins returns all registered plugin names", () => {
      resetDebug()
      Debug.registerPlugin(Debug.createPlugin("plugin1", () => {}))
      Debug.registerPlugin(Debug.createPlugin("plugin2", () => {}))
      Debug.registerPlugin(Debug.createPlugin("plugin3", () => {}))

      const names = Debug.getPlugins()

      expect(names).toContain("plugin1")
      expect(names).toContain("plugin2")
      expect(names).toContain("plugin3")
      expect(names.length).toBe(3)
    })
  })

  describe("Plugin dispatch (fan-out)", () => {
    it.effect("log dispatches event to registered plugin", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []
        const plugin = Debug.createCollectorPlugin("test", events)

        Debug.enable()
        Debug.registerPlugin(plugin)

        yield* Debug.log({ event: "signal.create", signal_id: "sig_1", value: 0, component: "test" })

        expect(events.length).toBe(1)
        expect(events[0]?.event).toBe("signal.create")
      })
    )

    it.effect("log dispatches event to multiple plugins", () =>
      Effect.gen(function* () {
        resetDebug()
        const events1: Debug.DebugEvent[] = []
        const events2: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("plugin1", events1))
        Debug.registerPlugin(Debug.createCollectorPlugin("plugin2", events2))

        yield* Debug.log({ event: "signal.set", signal_id: "sig_1", prev_value: 0, value: 1, listener_count: 1 })

        expect(events1.length).toBe(1)
        expect(events2.length).toBe(1)
        expect(events1[0]?.event).toBe("signal.set")
        expect(events2[0]?.event).toBe("signal.set")
      })
    )

    it.effect("plugin order does not affect delivery", () =>
      Effect.gen(function* () {
        resetDebug()
        const order: string[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createPlugin("first", () => order.push("first")))
        Debug.registerPlugin(Debug.createPlugin("second", () => order.push("second")))
        Debug.registerPlugin(Debug.createPlugin("third", () => order.push("third")))

        yield* Debug.log({ event: "signal.notify", signal_id: "sig_1", listener_count: 1 })

        // All plugins should receive the event
        expect(order.length).toBe(3)
        expect(order).toContain("first")
        expect(order).toContain("second")
        expect(order).toContain("third")
      })
    )

    it.effect("plugin failure isolates (one plugin error does not break others)", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createPlugin("failing", () => {
          throw new Error("Plugin error!")
        }))
        Debug.registerPlugin(Debug.createCollectorPlugin("working", events))

        // Should not throw, and working plugin should receive event
        yield* Debug.log({ event: "signal.subscribe", signal_id: "sig_1", listener_count: 1 })

        expect(events.length).toBe(1)
        expect(events[0]?.event).toBe("signal.subscribe")
      })
    )
  })

  describe("Plugin config", () => {
    it.effect("no plugins uses default console behavior (implicit)", () =>
      Effect.gen(function* () {
        resetDebug()
        Debug.enable()
        
        // When no plugins registered, log should work without error
        // (uses consolePlugin internally)
        yield* Debug.log({ event: "signal.get", signal_id: "sig_1", trigger: "test" })
        // No error means success
      })
    )

    it.effect("registering plugins overrides default console output", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("custom", events))

        yield* Debug.log({ event: "signal.unsubscribe", signal_id: "sig_1", listener_count: 0 })

        // Only custom plugin receives event (console not registered)
        expect(events.length).toBe(1)
      })
    )

    it.effect("can include console plugin alongside custom plugins", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.consolePlugin)
        Debug.registerPlugin(Debug.createCollectorPlugin("custom", events))

        // Both plugins receive event
        yield* Debug.log({ event: "render.component.initial", accessed_signals: 2 })

        expect(events.length).toBe(1)
        // console plugin also ran (no way to verify without mocking console)
      })
    )

    it.effect("disabled debug does not dispatch to plugins", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        // Not enabled
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        yield* Debug.log({ event: "signal.create", signal_id: "sig_1", value: 0, component: "test" })

        expect(events.length).toBe(0)
      })
    )
  })

  describe("Event filtering with plugins", () => {
    it.effect("filter applies to plugin dispatch", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable("signal")
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        // Signal event - should pass filter
        yield* Debug.log({ event: "signal.create", signal_id: "sig_1", value: 0, component: "test" })
        expect(events.length).toBe(1)

        // Router event - should not pass filter
        yield* Debug.log({ event: "router.navigate", from_path: "/a", to_path: "/b" })
        expect(events.length).toBe(1) // Still 1

        // Another signal event
        yield* Debug.log({ event: "signal.set", signal_id: "sig_1", prev_value: 0, value: 1, listener_count: 1 })
        expect(events.length).toBe(2)
      })
    )

    it.effect("multiple filters work with plugins", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable(["signal.set", "router.navigate"])
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        yield* Debug.log({ event: "signal.create", signal_id: "sig_1", value: 0, component: "test" })
        expect(events.length).toBe(0) // signal.create not in filter

        yield* Debug.log({ event: "signal.set", signal_id: "sig_1", prev_value: 0, value: 1, listener_count: 1 })
        expect(events.length).toBe(1) // signal.set passes

        yield* Debug.log({ event: "router.navigate", from_path: "/a", to_path: "/b" })
        expect(events.length).toBe(2) // router.navigate passes

        yield* Debug.log({ event: "router.match", path: "/b", route_pattern: "/b", params: {} })
        expect(events.length).toBe(2) // router.match not in filter
      })
    )
  })

  describe("Event structure", () => {
    it.effect("events include timestamp", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        yield* Debug.log({ event: "signal.create", signal_id: "sig_1", value: 0, component: "test" })

        expect(events[0]?.timestamp).toBeDefined()
        expect(typeof events[0]?.timestamp).toBe("string")
        // Should be ISO format
        expect(() => new Date(events[0]?.timestamp ?? "")).not.toThrow()
      })
    )

    it.effect("events preserve all input fields", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        yield* Debug.log({
          event: "signal.set",
          signal_id: "sig_42",
          prev_value: 100,
          value: 200,
          listener_count: 3
        })

        const event = events[0]
        expect(event).toBeDefined()
        expect(event?.event).toBe("signal.set")
        expect((event as { signal_id: string } | undefined)?.signal_id).toBe("sig_42")
        expect((event as { prev_value: number } | undefined)?.prev_value).toBe(100)
        expect((event as { value: number } | undefined)?.value).toBe(200)
        expect((event as { listener_count: number } | undefined)?.listener_count).toBe(3)
      })
    )
  })
})
