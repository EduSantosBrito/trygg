/**
 * Tests for trace correlation (F-018)
 */
import { describe, expect, it } from "@effect/vitest"
import { Data, Effect } from "effect"

/** Test error for simulating failures */
class TestError extends Data.TaggedError("TestError")<{ message: string }> {}
import * as Debug from "../src/debug.js"
import * as Router from "../src/router/index.js"
import * as Signal from "../src/Signal.js"

// Helper to reset debug state (sync parts only)
const resetDebug = () => {
  Debug.disable()
  for (const name of Debug.getPlugins()) {
    Debug.unregisterPlugin(name)
  }
}

describe("Trace Correlation", () => {
  describe("Trace ID generation", () => {
    it("nextTraceId generates unique IDs", () => {
      const id1 = Debug.nextTraceId()
      const id2 = Debug.nextTraceId()
      const id3 = Debug.nextTraceId()

      expect(id1).toMatch(/^trace_\d+$/)
      expect(id2).toMatch(/^trace_\d+$/)
      expect(id3).toMatch(/^trace_\d+$/)

      // All unique
      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
      expect(id1).not.toBe(id3)
    })

    it("nextSpanId generates unique IDs", () => {
      const id1 = Debug.nextSpanId()
      const id2 = Debug.nextSpanId()
      const id3 = Debug.nextSpanId()

      expect(id1).toMatch(/^span_\d+$/)
      expect(id2).toMatch(/^span_\d+$/)
      expect(id3).toMatch(/^span_\d+$/)

      // All unique
      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
      expect(id1).not.toBe(id3)
    })
  })

  describe("Trace context management", () => {
    it.effect("setTraceId sets current trace ID", () =>
      Effect.gen(function* () {
        yield* Debug.setTraceId("trace_test_1")
        const ctx = yield* Debug.getTraceContext

        expect(ctx.traceId).toBe("trace_test_1")
      })
    )

    it.effect("clearTraceContext clears all trace context", () =>
      Effect.gen(function* () {
        yield* Debug.setTraceId("trace_test_2")
        yield* Debug.clearTraceContext
        const ctx = yield* Debug.getTraceContext

        expect(ctx.traceId).toBeUndefined()
        expect(ctx.spanId).toBeUndefined()
        expect(ctx.parentSpanId).toBeUndefined()
      })
    )

    it.effect("getTraceContext returns empty object when no context", () =>
      Effect.gen(function* () {
        yield* Debug.clearTraceContext
        const ctx = yield* Debug.getTraceContext

        expect(ctx.traceId).toBeUndefined()
        expect(ctx.spanId).toBeUndefined()
        expect(ctx.parentSpanId).toBeUndefined()
      })
    )
  })

  describe("Span lifecycle", () => {
    it.effect("startSpan creates span and returns end function", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))
        yield* Debug.setTraceId("trace_span_test")

        const endSpan = yield* Debug.startSpan("test-operation")

        // Should have span start event
        expect(events.length).toBe(1)
        expect(events[0]?.event).toBe("trace.span.start")
        expect((events[0] as { name: string }).name).toBe("test-operation")

        yield* endSpan

        // Should have span end event
        expect(events.length).toBe(2)
        expect(events[1]?.event).toBe("trace.span.end")
        expect((events[1] as { name: string }).name).toBe("test-operation")
        expect((events[1] as { status: string }).status).toBe("ok")
      })
    )

    it.effect("startSpan includes attributes in event", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        const endSpan = yield* Debug.startSpan("with-attrs", { route: "/users", method: "GET" })
        yield* endSpan

        const event = events[0] as { attributes?: Record<string, unknown> }
        expect(event.attributes).toEqual({ route: "/users", method: "GET" })
      })
    )

    it.effect("nested spans track parent relationship", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))
        yield* Debug.setTraceId("trace_nested")

        const endOuter = yield* Debug.startSpan("outer")
        // events[0] is the outer span start

        const endInner = yield* Debug.startSpan("inner")
        const innerEvent = events[1] as { spanId?: string; parentSpanId?: string }

        // Inner span should have outer span as parent (outer's spanId)
        expect(innerEvent.parentSpanId).toBeDefined()

        yield* endInner
        yield* endOuter

        // After closing, context should be restored
        const ctx = yield* Debug.getTraceContext
        expect(ctx.spanId).toBeUndefined()
      })
    )
  })

  describe("withSpan helper", () => {
    it.effect("withSpan wraps effect with span", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        const result = yield* Debug.withSpan("sync-op", Effect.succeed(42))

        expect(result).toBe(42)
        expect(events.length).toBe(2)
        expect(events[0]?.event).toBe("trace.span.start")
        expect(events[1]?.event).toBe("trace.span.end")
        expect((events[1] as { status: string }).status).toBe("ok")
      })
    )

    it.effect("withSpan records error status on failure", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        const result = yield* Debug.withSpan(
          "failing-op", 
          new TestError({ message: "Oops!" })
        ).pipe(Effect.either)

        expect(result._tag).toBe("Left")
        expect(events.length).toBe(2)
        expect(events[1]?.event).toBe("trace.span.end")
        expect((events[1] as { status: string }).status).toBe("error")
        expect((events[1] as { error?: string }).error).toContain("Oops!")
      })
    )

    it.effect("withSpan includes attributes", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        yield* Debug.withSpan("with-attrs", Effect.void, { key: "value" })

        expect((events[0] as { attributes?: Record<string, unknown> }).attributes).toEqual({ key: "value" })
      })
    )
  })

  describe("Log includes trace context", () => {
    it.effect("log includes traceId when set", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        yield* Debug.setTraceId("trace_log_test")
        yield* Debug.log({ event: "signal.create", signal_id: "sig_1", value: 0, component: "test" })

        expect(events[0]?.traceId).toBe("trace_log_test")
      })
    )

    it.effect("log includes spanId when inside span", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        yield* Debug.setTraceId("trace_span_log")
        const endSpan = yield* Debug.startSpan("parent-span")

        // Log inside span
        yield* Debug.log({ event: "signal.set", signal_id: "sig_1", prev_value: 0, value: 1, listener_count: 1 })

        const logEvent = events[1] // events[0] is span start
        expect(logEvent?.spanId).toBeDefined()
        expect(logEvent?.traceId).toBe("trace_span_log")

        yield* endSpan
      })
    )

    it.effect("log does not include trace context when not set", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        yield* Debug.clearTraceContext
        yield* Debug.log({ event: "signal.get", signal_id: "sig_1", trigger: "test" })

        // Should not have trace fields (undefined won't be in object)
        expect(events[0]?.traceId).toBeUndefined()
        expect(events[0]?.spanId).toBeUndefined()
      })
    )
  })

  describe("Router navigation creates new trace", () => {
    it.effect("navigate creates new traceId", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        // Create test router
        const layer = Router.testLayer("/")
        const router = yield* Effect.provide(Router.Router, layer)

        // Navigate - should create new trace
        yield* router.navigate("/users")

        // Find navigate event
        const navigateEvent = events.find(e => e.event === "router.navigate")
        expect(navigateEvent).toBeDefined()
        expect(navigateEvent?.traceId).toBeDefined()
        expect(navigateEvent?.traceId).toMatch(/^trace_\d+$/)
      })
    )

    it.effect("new navigation creates new traceId", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        const layer = Router.testLayer("/")
        const router = yield* Effect.provide(Router.Router, layer)

        // First navigation
        yield* router.navigate("/first")
        const firstNavigate = events.find(e => e.event === "router.navigate")
        const firstTraceId = firstNavigate?.traceId

        // Second navigation
        yield* router.navigate("/second")
        const secondNavigate = [...events].reverse().find(e => e.event === "router.navigate")
        const secondTraceId = secondNavigate?.traceId

        // Should have different trace IDs
        expect(firstTraceId).toBeDefined()
        expect(secondTraceId).toBeDefined()
        expect(firstTraceId).not.toBe(secondTraceId)
      })
    )

    it.effect("navigate.complete has same traceId as navigate", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        const layer = Router.testLayer("/")
        const router = yield* Effect.provide(Router.Router, layer)

        yield* router.navigate("/test")

        const navigateEvent = events.find(e => e.event === "router.navigate")
        const completeEvent = events.find(e => e.event === "router.navigate.complete")

        expect(navigateEvent?.traceId).toBeDefined()
        expect(completeEvent?.traceId).toBe(navigateEvent?.traceId)
      })
    )
  })

  describe("Events share traceId within navigation flow", () => {
    it.effect("signal events inside navigation share traceId", () =>
      Effect.gen(function* () {
        resetDebug()
        const events: Debug.DebugEvent[] = []

        Debug.enable()
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events))

        const layer = Router.testLayer("/")
        const router = yield* Effect.provide(Router.Router, layer)

        // Navigate sets traceId
        yield* router.navigate("/test")

        // Get the traceId from navigate
        const navigateEvent = events.find(e => e.event === "router.navigate")
        const traceId = navigateEvent?.traceId

        // Subsequent events should have same traceId
        const count = yield* Signal.make(0)
        yield* Signal.set(count, 1)

        // Find signal.set event after navigate
        const signalSetEvent = events.find(e => e.event === "signal.set")

        // Signal event should share traceId with navigation
        expect(signalSetEvent?.traceId).toBe(traceId)
      })
    )
  })
})
