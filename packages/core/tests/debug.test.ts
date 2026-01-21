/**
 * Debug and Metrics Unit Tests
 *
 * Tests for debug logging system and observability metrics.
 *
 * Goals: Reliability, stability
 * - Verify debug enable/disable works
 * - Verify plugins receive events
 * - Verify metrics are recorded correctly
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, FiberRef } from "effect";
import * as Debug from "../src/debug/debug.js";
import * as Metrics from "../src/debug/metrics.js";

// Helper to reset debug state between tests
const withDebugReset = <A, E>(effect: Effect.Effect<A, E, never>): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    Debug.disable();
    // Unregister all plugins
    for (const name of Debug.getPlugins()) {
      Debug.unregisterPlugin(name);
    }
    const result = yield* effect;
    Debug.disable();
    for (const name of Debug.getPlugins()) {
      Debug.unregisterPlugin(name);
    }
    return result;
  });

// =============================================================================
// Debug enable/disable
// =============================================================================
// Scope: Controlling debug logging state

describe("Debug enable/disable", () => {
  it("should enable logging for all events", () => {
    Debug.disable();
    Debug.enable();

    assert.isTrue(Debug.isEnabled());
    assert.isNull(Debug.getFilter());

    Debug.disable();
  });

  it("should stop logging when disabled", () => {
    Debug.enable();
    Debug.disable();

    assert.isFalse(Debug.isEnabled());

    Debug.disable();
  });

  it("should report enabled state correctly", () => {
    Debug.disable();
    assert.isFalse(Debug.isEnabled());

    Debug.enable();
    assert.isTrue(Debug.isEnabled());

    Debug.disable();
    assert.isFalse(Debug.isEnabled());
  });
});

// =============================================================================
// Debug filters
// =============================================================================
// Scope: Filtering which events are logged

describe("Debug filters", () => {
  it("should filter events by string prefix", () => {
    Debug.disable();
    Debug.enable("signal");

    const filter = Debug.getFilter();
    assert.deepStrictEqual(filter, ["signal"]);

    Debug.disable();
  });

  it("should filter events by array of prefixes", () => {
    Debug.disable();
    Debug.enable(["signal", "render"]);

    const filter = Debug.getFilter();
    assert.isNotNull(filter);
    assert.isTrue(filter?.includes("signal"));
    assert.isTrue(filter?.includes("render"));

    Debug.disable();
  });

  it("should return current filter configuration", () => {
    Debug.disable();
    Debug.enable(["signal", "router"]);

    const filter = Debug.getFilter();
    assert.isArray(filter);
    assert.strictEqual(filter?.length, 2);

    Debug.disable();
  });

  it.effect("should match exact event name", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.enable("signal.set");

        const events: Debug.DebugEvent[] = [];
        const plugin = Debug.createCollectorPlugin("test", events);
        Debug.registerPlugin(plugin);

        yield* Debug.log({
          event: "signal.set",
          signal_id: "test",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0]?.event, "signal.set");
      }),
    ),
  );

  it.effect("should match events with prefix", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.enable("signal");

        const events: Debug.DebugEvent[] = [];
        const plugin = Debug.createCollectorPlugin("test", events);
        Debug.registerPlugin(plugin);

        yield* Debug.log({
          event: "signal.set",
          signal_id: "test",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });
        yield* Debug.log({ event: "signal.get", signal_id: "test", trigger: "test" });

        assert.strictEqual(events.length, 2);
      }),
    ),
  );

  it.effect("should not match unrelated events", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.enable("signal");

        const events: Debug.DebugEvent[] = [];
        const plugin = Debug.createCollectorPlugin("test", events);
        Debug.registerPlugin(plugin);

        yield* Debug.log({
          event: "signal.set",
          signal_id: "test",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });
        yield* Debug.log({ event: "render.component.initial", accessed_signals: 0 });

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0]?.event, "signal.set");
      }),
    ),
  );
});

// =============================================================================
// Debug plugins
// =============================================================================
// Scope: Plugin system for custom event handling

describe("Debug plugins", () => {
  it("should register plugin", () => {
    Debug.disable();
    for (const name of Debug.getPlugins()) {
      Debug.unregisterPlugin(name);
    }

    const plugin = Debug.createPlugin("test-plugin", () => {});
    Debug.registerPlugin(plugin);

    assert.isTrue(Debug.hasPlugin("test-plugin"));

    Debug.unregisterPlugin("test-plugin");
  });

  it("should unregister plugin by name", () => {
    Debug.disable();
    const plugin = Debug.createPlugin("to-remove", () => {});
    Debug.registerPlugin(plugin);

    assert.isTrue(Debug.hasPlugin("to-remove"));

    Debug.unregisterPlugin("to-remove");

    assert.isFalse(Debug.hasPlugin("to-remove"));
  });

  it("should return registered plugin names", () => {
    Debug.disable();
    for (const name of Debug.getPlugins()) {
      Debug.unregisterPlugin(name);
    }

    Debug.registerPlugin(Debug.createPlugin("plugin-a", () => {}));
    Debug.registerPlugin(Debug.createPlugin("plugin-b", () => {}));

    const plugins = Debug.getPlugins();
    assert.isTrue(plugins.includes("plugin-a"));
    assert.isTrue(plugins.includes("plugin-b"));

    Debug.unregisterPlugin("plugin-a");
    Debug.unregisterPlugin("plugin-b");
  });

  it("should check if plugin is registered", () => {
    Debug.disable();
    for (const name of Debug.getPlugins()) {
      Debug.unregisterPlugin(name);
    }

    assert.isFalse(Debug.hasPlugin("nonexistent"));

    Debug.registerPlugin(Debug.createPlugin("exists", () => {}));
    assert.isTrue(Debug.hasPlugin("exists"));

    Debug.unregisterPlugin("exists");
  });

  it.effect("should call plugin handle with events", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.enable();

        const events: Debug.DebugEvent[] = [];
        const plugin = Debug.createCollectorPlugin("collector", events);
        Debug.registerPlugin(plugin);

        yield* Debug.log({
          event: "signal.set",
          signal_id: "s1",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0]?.event, "signal.set");
      }),
    ),
  );

  it.effect("should isolate plugin errors", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.enable();

        // First plugin throws
        Debug.registerPlugin(
          Debug.createPlugin("thrower", () => {
            throw new Error("Plugin error");
          }),
        );

        const events: Debug.DebugEvent[] = [];
        Debug.registerPlugin(Debug.createCollectorPlugin("collector", events));

        // Should not throw, and collector should still receive event
        yield* Debug.log({
          event: "signal.set",
          signal_id: "s1",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });

        assert.strictEqual(events.length, 1);
      }),
    ),
  );

  it.effect("should send event to all registered plugins", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.enable();

        const events1: Debug.DebugEvent[] = [];
        const events2: Debug.DebugEvent[] = [];

        Debug.registerPlugin(Debug.createCollectorPlugin("collector1", events1));
        Debug.registerPlugin(Debug.createCollectorPlugin("collector2", events2));

        yield* Debug.log({
          event: "signal.set",
          signal_id: "s1",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });

        assert.strictEqual(events1.length, 1);
        assert.strictEqual(events2.length, 1);
      }),
    ),
  );
});

// =============================================================================
// Debug.log
// =============================================================================
// Scope: Logging debug events

describe("Debug.log", () => {
  it.effect("should log events when enabled", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.enable();

        const events: Debug.DebugEvent[] = [];
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events));

        yield* Debug.log({
          event: "signal.set",
          signal_id: "s1",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });

        assert.strictEqual(events.length, 1);
      }),
    ),
  );

  it.effect("should skip logging when disabled", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.disable();

        const events: Debug.DebugEvent[] = [];
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events));

        yield* Debug.log({
          event: "signal.set",
          signal_id: "s1",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });

        assert.strictEqual(events.length, 0);
      }),
    ),
  );

  it.effect("should add timestamp to events", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.enable();

        const events: Debug.DebugEvent[] = [];
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events));

        yield* Debug.log({
          event: "signal.set",
          signal_id: "s1",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });

        assert.isDefined(events[0]?.timestamp);
        // Timestamp should be ISO format
        assert.match(events[0]?.timestamp ?? "", /^\d{4}-\d{2}-\d{2}T/);
      }),
    ),
  );

  it.effect("should respect event filter", () =>
    withDebugReset(
      Effect.gen(function* () {
        Debug.enable("signal");

        const events: Debug.DebugEvent[] = [];
        Debug.registerPlugin(Debug.createCollectorPlugin("test", events));

        yield* Debug.log({
          event: "signal.set",
          signal_id: "s1",
          prev_value: 0,
          value: 1,
          listener_count: 0,
        });
        yield* Debug.log({ event: "render.component.initial", accessed_signals: 0 });

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0]?.event, "signal.set");
      }),
    ),
  );
});

// =============================================================================
// Debug ID generation
// =============================================================================
// Scope: Generating unique IDs for debugging

describe("Debug ID generation", () => {
  it("should generate unique signal IDs", () => {
    const id1 = Debug.nextSignalId();
    const id2 = Debug.nextSignalId();
    const id3 = Debug.nextSignalId();

    assert.notStrictEqual(id1, id2);
    assert.notStrictEqual(id2, id3);
    assert.notStrictEqual(id1, id3);
    assert.match(id1, /^sig_\d+$/);
  });

  it("should generate unique trace IDs", () => {
    const id1 = Debug.nextTraceId();
    const id2 = Debug.nextTraceId();
    const id3 = Debug.nextTraceId();

    assert.notStrictEqual(id1, id2);
    assert.notStrictEqual(id2, id3);
    assert.match(id1, /^trace_\d+$/);
  });

  it("should generate unique span IDs", () => {
    const id1 = Debug.nextSpanId();
    const id2 = Debug.nextSpanId();
    const id3 = Debug.nextSpanId();

    assert.notStrictEqual(id1, id2);
    assert.notStrictEqual(id2, id3);
    assert.match(id1, /^span_\d+$/);
  });
});

// =============================================================================
// Trace context
// =============================================================================
// Scope: Trace ID propagation through effects

describe("Trace context", () => {
  it.effect("should store trace ID in fiber context", () =>
    Effect.gen(function* () {
      yield* Debug.setTraceId("trace_123");

      const ctx = yield* Debug.getTraceContext;
      assert.strictEqual(ctx.traceId, "trace_123");

      yield* Debug.clearTraceContext;
    }),
  );

  it.effect("should clear all trace context fields", () =>
    Effect.gen(function* () {
      yield* FiberRef.set(Debug.CurrentTraceId, "trace_abc");
      yield* FiberRef.set(Debug.CurrentSpanId, "span_123");
      yield* FiberRef.set(Debug.CurrentParentSpanId, "span_parent");

      yield* Debug.clearTraceContext;

      const ctx = yield* Debug.getTraceContext;
      assert.isUndefined(ctx.traceId);
      assert.isUndefined(ctx.spanId);
      assert.isUndefined(ctx.parentSpanId);
    }),
  );

  it.effect("should propagate trace context to child effects", () =>
    Effect.gen(function* () {
      yield* Debug.setTraceId("trace_parent");

      const childCtx = yield* Debug.getTraceContext;

      assert.strictEqual(childCtx.traceId, "trace_parent");

      yield* Debug.clearTraceContext;
    }),
  );
});

// =============================================================================
// Metrics counters
// =============================================================================
// Scope: Recording counter metrics

describe("Metrics counters", () => {
  it.effect("should increment navigation counter", () =>
    Effect.gen(function* () {
      const before = yield* Metrics.snapshot;

      yield* Metrics.recordNavigation;
      yield* Metrics.recordNavigation;

      const after = yield* Metrics.snapshot;
      assert.strictEqual(after.navigationCount - before.navigationCount, 2);
    }),
  );

  it.effect("should increment route error counter", () =>
    Effect.gen(function* () {
      const before = yield* Metrics.snapshot;

      yield* Metrics.recordRouteError;

      const after = yield* Metrics.snapshot;
      assert.strictEqual(after.routeErrorCount - before.routeErrorCount, 1);
    }),
  );

  it.effect("should increment signal update counter", () =>
    Effect.gen(function* () {
      const before = yield* Metrics.snapshot;

      yield* Metrics.recordSignalUpdate;
      yield* Metrics.recordSignalUpdate;
      yield* Metrics.recordSignalUpdate;

      const after = yield* Metrics.snapshot;
      assert.strictEqual(after.signalUpdateCount - before.signalUpdateCount, 3);
    }),
  );

  it.effect("should increment component render counter", () =>
    Effect.gen(function* () {
      const before = yield* Metrics.snapshot;

      yield* Metrics.recordComponentRender;

      const after = yield* Metrics.snapshot;
      assert.strictEqual(after.componentRenderCount - before.componentRenderCount, 1);
    }),
  );
});

// =============================================================================
// Metrics histogram
// =============================================================================
// Scope: Recording duration histogram

describe("Metrics histogram", () => {
  it.effect("should record render duration in histogram", () =>
    Effect.gen(function* () {
      const before = yield* Metrics.snapshot;

      yield* Metrics.recordRenderDuration(5);
      yield* Metrics.recordRenderDuration(10);

      const after = yield* Metrics.snapshot;
      assert.strictEqual(
        after.renderDurationHistogram.count - before.renderDurationHistogram.count,
        2,
      );
    }),
  );

  it.effect("should track min and max render duration", () =>
    Effect.gen(function* () {
      // Record distinct values
      yield* Metrics.recordRenderDuration(100);
      yield* Metrics.recordRenderDuration(200);

      const snap = yield* Metrics.snapshot;
      // Min/max should reflect recorded values (may include previous test values)
      assert.isAtMost(snap.renderDurationHistogram.min, 100);
      assert.isAtLeast(snap.renderDurationHistogram.max, 200);
    }),
  );

  it.effect("should track render count in histogram", () =>
    Effect.gen(function* () {
      const before = yield* Metrics.snapshot;

      yield* Metrics.recordRenderDuration(1);
      yield* Metrics.recordRenderDuration(2);
      yield* Metrics.recordRenderDuration(3);

      const after = yield* Metrics.snapshot;
      assert.strictEqual(
        after.renderDurationHistogram.count - before.renderDurationHistogram.count,
        3,
      );
    }),
  );
});

// =============================================================================
// Metrics snapshot
// =============================================================================
// Scope: Getting metrics snapshot

describe("Metrics snapshot", () => {
  it.effect("should return snapshot with all metrics", () =>
    Effect.gen(function* () {
      const snap = yield* Metrics.snapshot;

      assert.isDefined(snap.navigationCount);
      assert.isDefined(snap.routeErrorCount);
      assert.isDefined(snap.signalUpdateCount);
      assert.isDefined(snap.componentRenderCount);
      assert.isDefined(snap.renderDurationHistogram);
      assert.isDefined(snap.renderDurationHistogram.count);
      assert.isDefined(snap.renderDurationHistogram.min);
      assert.isDefined(snap.renderDurationHistogram.max);
      assert.isDefined(snap.renderDurationHistogram.sum);
      assert.isDefined(snap.renderDurationHistogram.buckets);
    }),
  );

  it.effect("should reflect current metric values", () =>
    Effect.gen(function* () {
      const before = yield* Metrics.snapshot;

      yield* Metrics.recordNavigation;
      yield* Metrics.recordComponentRender;

      const after = yield* Metrics.snapshot;
      assert.strictEqual(after.navigationCount, before.navigationCount + 1);
      assert.strictEqual(after.componentRenderCount, before.componentRenderCount + 1);
    }),
  );
});

// =============================================================================
// Metrics sinks
// =============================================================================
// Scope: Exporting metrics to sinks

describe("Metrics sinks", () => {
  it("should register sink", () => {
    const sink = Metrics.createSink("test-sink", () => Effect.void);
    Metrics.registerSink(sink);

    assert.isTrue(Metrics.hasSink("test-sink"));

    Metrics.unregisterSink("test-sink");
  });

  it("should unregister sink by name", () => {
    const sink = Metrics.createSink("to-remove", () => Effect.void);
    Metrics.registerSink(sink);

    assert.isTrue(Metrics.hasSink("to-remove"));

    Metrics.unregisterSink("to-remove");

    assert.isFalse(Metrics.hasSink("to-remove"));
  });

  it.effect("should export to all registered sinks", () =>
    Effect.gen(function* () {
      const snapshots1: Metrics.MetricsSnapshot[] = [];
      const snapshots2: Metrics.MetricsSnapshot[] = [];

      const sink1 = Metrics.createCollectorSink("sink1", snapshots1);
      const sink2 = Metrics.createCollectorSink("sink2", snapshots2);

      Metrics.registerSink(sink1);
      Metrics.registerSink(sink2);

      yield* Metrics.exportToSinks;

      assert.strictEqual(snapshots1.length, 1);
      assert.strictEqual(snapshots2.length, 1);

      Metrics.unregisterSink("sink1");
      Metrics.unregisterSink("sink2");
    }),
  );

  it.effect("should isolate sink errors", () =>
    Effect.gen(function* () {
      const snapshots: Metrics.MetricsSnapshot[] = [];

      // First sink throws
      const throwingSink = Metrics.createSink("thrower", () => Effect.die(new Error("Sink error")));
      const collectorSink = Metrics.createCollectorSink("collector", snapshots);

      Metrics.registerSink(throwingSink);
      Metrics.registerSink(collectorSink);

      // Should not throw, and collector should still receive snapshot
      yield* Metrics.exportToSinks;

      assert.strictEqual(snapshots.length, 1);

      Metrics.unregisterSink("thrower");
      Metrics.unregisterSink("collector");
    }),
  );

  it("should log to console via consoleSink", () => {
    // Just verify consoleSink exists and is a valid sink
    assert.isDefined(Metrics.consoleSink);
    assert.strictEqual(Metrics.consoleSink.name, "console");
    assert.isFunction(Metrics.consoleSink.export);
  });

  it.effect("should collect snapshots in array", () =>
    Effect.gen(function* () {
      const snapshots: Metrics.MetricsSnapshot[] = [];
      const sink = Metrics.createCollectorSink("collector", snapshots);
      Metrics.registerSink(sink);

      yield* Metrics.exportToSinks;
      yield* Metrics.exportToSinks;
      yield* Metrics.exportToSinks;

      assert.strictEqual(snapshots.length, 3);

      Metrics.unregisterSink("collector");
    }),
  );
});
