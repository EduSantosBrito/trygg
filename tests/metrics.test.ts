/**
 * Tests for Metrics module (F-019)
 */
import { describe, expect, it, beforeEach } from "@effect/vitest"
import { Effect } from "effect"
import * as Metrics from "../src/metrics.js"
import * as Signal from "../src/Signal.js"
import * as Router from "../src/router/index.js"

// Helper to reset metrics sinks
const resetSinks = () => {
  for (const name of Metrics.getSinks()) {
    Metrics.unregisterSink(name)
  }
}

describe("Metrics (F-019)", () => {
  beforeEach(() => {
    resetSinks()
  })

  describe("Metrics snapshot API", () => {
    it.effect("snapshot returns current metric values", () =>
      Effect.gen(function* () {
        const snap = yield* Metrics.snapshot
        
        expect(snap.navigationCount).toBeGreaterThanOrEqual(0)
        expect(snap.routeErrorCount).toBeGreaterThanOrEqual(0)
        expect(snap.signalUpdateCount).toBeGreaterThanOrEqual(0)
        expect(snap.componentRenderCount).toBeGreaterThanOrEqual(0)
        expect(snap.renderDurationHistogram).toBeDefined()
        expect(snap.renderDurationHistogram.count).toBeGreaterThanOrEqual(0)
      })
    )

    it.effect("recordNavigation increments navigation counter", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        yield* Metrics.recordNavigation
        yield* Metrics.recordNavigation
        const after = yield* Metrics.snapshot
        
        expect(after.navigationCount).toBe(before.navigationCount + 2)
      })
    )

    it.effect("recordRouteError increments error counter", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        yield* Metrics.recordRouteError
        const after = yield* Metrics.snapshot
        
        expect(after.routeErrorCount).toBe(before.routeErrorCount + 1)
      })
    )

    it.effect("recordSignalUpdate increments signal counter", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        yield* Metrics.recordSignalUpdate
        yield* Metrics.recordSignalUpdate
        yield* Metrics.recordSignalUpdate
        const after = yield* Metrics.snapshot
        
        expect(after.signalUpdateCount).toBe(before.signalUpdateCount + 3)
      })
    )

    it.effect("recordComponentRender increments render counter", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        yield* Metrics.recordComponentRender
        const after = yield* Metrics.snapshot
        
        expect(after.componentRenderCount).toBe(before.componentRenderCount + 1)
      })
    )

    it.effect("recordRenderDuration updates histogram", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        yield* Metrics.recordRenderDuration(5.5)
        yield* Metrics.recordRenderDuration(10.2)
        const after = yield* Metrics.snapshot
        
        expect(after.renderDurationHistogram.count).toBe(before.renderDurationHistogram.count + 2)
        expect(after.renderDurationHistogram.sum).toBeGreaterThan(before.renderDurationHistogram.sum)
      })
    )
  })

  describe("Metrics sink API", () => {
    it("registerSink adds sink to registry", () => {
      const sink = Metrics.createSink("test", () => Effect.void)
      
      expect(Metrics.hasSink("test")).toBe(false)
      Metrics.registerSink(sink)
      expect(Metrics.hasSink("test")).toBe(true)
      expect(Metrics.getSinks()).toContain("test")
    })

    it("unregisterSink removes sink from registry", () => {
      const sink = Metrics.createSink("test", () => Effect.void)
      Metrics.registerSink(sink)
      
      expect(Metrics.hasSink("test")).toBe(true)
      Metrics.unregisterSink("test")
      expect(Metrics.hasSink("test")).toBe(false)
    })

    it.effect("exportToSinks calls all registered sinks", () =>
      Effect.gen(function* () {
        const snapshots1: Metrics.MetricsSnapshot[] = []
        const snapshots2: Metrics.MetricsSnapshot[] = []
        
        Metrics.registerSink(Metrics.createCollectorSink("sink1", snapshots1))
        Metrics.registerSink(Metrics.createCollectorSink("sink2", snapshots2))
        
        yield* Metrics.exportToSinks
        
        expect(snapshots1.length).toBe(1)
        expect(snapshots2.length).toBe(1)
        expect(snapshots1[0]).toEqual(snapshots2[0])
      })
    )

    it.effect("exportToSinks catches sink errors", () =>
      Effect.gen(function* () {
        const snapshots: Metrics.MetricsSnapshot[] = []
        
        Metrics.registerSink(Metrics.createSink("failing", () => 
          Effect.die(new Error("Sink error"))
        ))
        Metrics.registerSink(Metrics.createCollectorSink("working", snapshots))
        
        // Should not throw
        yield* Metrics.exportToSinks
        
        // Working sink should still receive snapshot
        expect(snapshots.length).toBe(1)
      })
    )

    it("consoleSink exists and is valid", () => {
      expect(Metrics.consoleSink.name).toBe("console")
      expect(typeof Metrics.consoleSink.export).toBe("function")
    })
  })

  describe("Integration: Navigation increments counter", () => {
    it.effect("Router.navigate increments navigation counter", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        
        const router = yield* Router.Router
        yield* router.navigate("/test-path")
        
        const after = yield* Metrics.snapshot
        expect(after.navigationCount).toBe(before.navigationCount + 1)
      }).pipe(Effect.provide(Router.testLayer("/")))
    )

    it.effect("multiple navigations increment counter correctly", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        
        const router = yield* Router.Router
        yield* router.navigate("/path1")
        yield* router.navigate("/path2")
        yield* router.navigate("/path3")
        
        const after = yield* Metrics.snapshot
        expect(after.navigationCount).toBe(before.navigationCount + 3)
      }).pipe(Effect.provide(Router.testLayer("/")))
    )
  })

  describe("Integration: Signal updates increment counter", () => {
    it.effect("Signal.set increments signal update counter", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        
        const signal = yield* Signal.make(0)
        yield* Signal.set(signal, 1)
        yield* Signal.set(signal, 2)
        
        const after = yield* Metrics.snapshot
        expect(after.signalUpdateCount).toBe(before.signalUpdateCount + 2)
      })
    )

    it.effect("Signal.update increments signal update counter", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        
        const signal = yield* Signal.make(0)
        yield* Signal.update(signal, n => n + 1)
        yield* Signal.update(signal, n => n + 1)
        
        const after = yield* Metrics.snapshot
        expect(after.signalUpdateCount).toBe(before.signalUpdateCount + 2)
      })
    )

    it.effect("skipped updates do NOT increment counter", () =>
      Effect.gen(function* () {
        const before = yield* Metrics.snapshot
        
        const signal = yield* Signal.make(5)
        yield* Signal.set(signal, 5) // Same value, should skip
        
        const after = yield* Metrics.snapshot
        expect(after.signalUpdateCount).toBe(before.signalUpdateCount) // No increment
      })
    )
  })

  describe("Export sink integration", () => {
    it.effect("collector sink captures all metric values", () =>
      Effect.gen(function* () {
        const snapshots: Metrics.MetricsSnapshot[] = []
        Metrics.registerSink(Metrics.createCollectorSink("test", snapshots))
        
        // Generate some metrics
        yield* Metrics.recordNavigation
        yield* Metrics.recordSignalUpdate
        yield* Metrics.recordComponentRender
        yield* Metrics.recordRenderDuration(15)
        
        yield* Metrics.exportToSinks
        
        expect(snapshots.length).toBe(1)
        const snap = snapshots[0]
        expect(snap).toBeDefined()
        if (snap) {
          expect(snap.navigationCount).toBeGreaterThan(0)
          expect(snap.signalUpdateCount).toBeGreaterThan(0)
          expect(snap.componentRenderCount).toBeGreaterThan(0)
          expect(snap.renderDurationHistogram.count).toBeGreaterThan(0)
        }
      })
    )
  })
})
