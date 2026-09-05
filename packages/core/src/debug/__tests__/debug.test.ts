/**
 * Debug and Metrics Unit Tests
 *
 * Tests for the human-facing console logger over the trace stream and the
 * observability metrics.
 *
 * Goals: Reliability, stability
 * - Verify the console logger formats catalog events and passes other logs through
 * - Verify Debug.layer tunes the minimum level, name filter, and batching
 * - Verify metrics are recorded correctly
 */
import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect } from "effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import { TestClock } from "effect/testing";
import * as Debug from "../debug.js";
import * as Metrics from "../metrics.js";
import * as Trace from "../../trace/index.js";

/** A captured `console.log` invocation's format string (its first argument). */
const textOf = (line: ReadonlyArray<unknown> | undefined): string =>
  line === undefined ? "" : String(line[0]);

/**
 * Run `use` with `console.log` stubbed to collect each invocation's arguments,
 * restoring the original on success, failure, or interrupt.
 */
const withConsoleCapture = <A, E, R>(
  use: (lines: Array<ReadonlyArray<unknown>>) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const lines: Array<ReadonlyArray<unknown>> = [];
    const original = console.log;
    console.log = (...args: Array<unknown>) => {
      lines.push(args);
    };
    return use(lines).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          console.log = original;
        }),
      ),
    );
  });

// =============================================================================
// consoleLogger
// =============================================================================
// Scope: The standalone Logger that pretty-prints the trace stream

describe("consoleLogger", () => {
  it.effect("formats a catalog event with category, subtype, and payload", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        yield* Trace.emit("signal.set", () => ({ signal_id: "s1" }));

        assert.strictEqual(lines.length, 1);
        const text = textOf(lines[0]);
        assert.include(text, "trygg");
        assert.include(text, "signal");
        assert.include(text, "set");
        assert.include(text, "signal_id:s1");
      }).pipe(
        Effect.provide(Logger.layer([Debug.consoleLogger])),
        Effect.provideService(References.MinimumLogLevel, "Trace"),
      ),
    ),
  );

  it.effect("passes a non-trace log through plainly, tagged with its level", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        yield* Effect.log("hello world");

        assert.strictEqual(lines.length, 1);
        assert.include(textOf(lines[0]), "hello world");
        assert.include(textOf(lines[0]), "Info");
      }).pipe(Effect.provide(Logger.layer([Debug.consoleLogger]))),
    ),
  );

  it.effect("renders opaque application values without invoking serialization hooks", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        // Test: should render only the trap-free classification of an application value.
        // Scope: Debug formatting after the Trace opaque-value boundary.
        // Assertion: the hook is not called and no live application object reaches Debug.
        let toJsonCalls = 0;
        const hostilePayload = {
          toJSON: () => {
            toJsonCalls++;
            return decodeURIComponent("%");
          },
        };
        const exit = yield* Trace.emit("signal.set", () => ({
          signal_id: "s1",
          value_type: Trace.valueType(hostilePayload),
        })).pipe(
          Effect.provide(Logger.layer([Debug.consoleLogger])),
          Effect.provideService(References.MinimumLogLevel, "Trace"),
          Effect.exit,
        );

        assert.strictEqual(exit._tag, "Success");
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(toJsonCalls, 0);
        assert.include(textOf(lines[0]), "value_type:object");
      }),
    ),
  );

  it.effect("deduplicates preserved annotation replays per Debug logger", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        // Test: should render an exact Trace envelope at most once per Debug reader.
        // Scope: a malicious logger synchronously replays logger options before normal fanout completes.
        // Assertion: direct replays plus the original invocation produce one console line.
        const malicious = Logger.make<unknown, void>((options) => {
          Debug.consoleLogger.log(options);
          Debug.consoleLogger.log(options);
        });

        yield* Trace.emit("signal.notify", () => ({ signal_id: "s1", listener_count: 1 })).pipe(
          Effect.provide(Logger.layer([malicious, Debug.consoleLogger])),
          Effect.provideService(References.MinimumLogLevel, "Trace"),
        );

        assert.strictEqual(lines.length, 1);
        assert.include(textOf(lines[0]), "signal");
        assert.include(textOf(lines[0]), "notify");
      }),
    ),
  );

  it.effect("drops events below the ambient minimum level (no console write)", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        // signal.set is a `cost` event (Debug); the default minimum level is Info.
        yield* Trace.emit("signal.set", () => ({ signal_id: "s1" }));

        assert.strictEqual(lines.length, 0);
      }).pipe(Effect.provide(Logger.layer([Debug.consoleLogger]))),
    ),
  );

  it.effect("does not fail framework work when console.log throws", () =>
    Effect.gen(function* () {
      // Test: should isolate debug console failures.
      // Scope: human-facing logger boundary around Trace.emit.
      // Assertion: the traced effect succeeds even when the console is hostile.
      const original = console.log;
      console.log = () => decodeURIComponent("%");
      const exit = yield* Trace.emit("router.navigate.request", () => ({
        fromPath: "/",
        toPath: "/x",
        replace: false,
      })).pipe(
        Effect.provide(Logger.layer([Debug.consoleLogger])),
        Effect.provideService(References.MinimumLogLevel, "Trace"),
        Effect.exit,
        Effect.ensuring(
          Effect.sync(() => {
            console.log = original;
          }),
        ),
      );

      assert.strictEqual(exit._tag, "Success");
    }),
  );
});

// =============================================================================
// layer
// =============================================================================
// Scope: Installing and tuning the console logger for a subtree

describe("layer", () => {
  it.effect("minLevel lowers the threshold so cost events are printed", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        yield* Trace.emit("signal.set", () => ({ signal_id: "s1" }));

        assert.strictEqual(lines.length, 1);
      }).pipe(Effect.provide(Debug.layer({ minLevel: "Trace" }))),
    ),
  );

  it.effect("a string filter keeps matching catalog events and drops the rest", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        yield* Trace.emit("signal.set", () => ({ signal_id: "s1" }));
        yield* Trace.emit("router.navigate.request", () => ({
          fromPath: "/",
          toPath: "/x",
          replace: false,
        }));

        assert.strictEqual(lines.length, 1);
        assert.include(textOf(lines[0]), "signal");
      }).pipe(Effect.provide(Debug.layer({ minLevel: "Trace", filter: "signal" }))),
    ),
  );

  it.effect("an array filter keeps every listed prefix", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        yield* Trace.emit("signal.set", () => ({ signal_id: "s1" }));
        yield* Trace.emit("render.schedule", () => ({}));
        yield* Trace.emit("router.navigate.request", () => ({
          fromPath: "/",
          toPath: "/x",
          replace: false,
        }));

        assert.strictEqual(lines.length, 2);
        assert.include(textOf(lines[0]), "signal");
        assert.include(textOf(lines[1]), "render");
      }).pipe(Effect.provide(Debug.layer({ minLevel: "Trace", filter: ["signal", "render"] }))),
    ),
  );

  it.effect("a filter never suppresses non-trace logs", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        yield* Effect.log("plain message");

        assert.strictEqual(lines.length, 1);
        assert.include(textOf(lines[0]), "plain message");
      }).pipe(Effect.provide(Debug.layer({ minLevel: "Trace", filter: "signal" }))),
    ),
  );

  it.effect("preserves an outer trace recorder when installed in a subtree", () =>
    withConsoleCapture(() =>
      Effect.gen(function* () {
        // Test: should not replace scoped recorders when Debug.layer is provided lower in the tree.
        // Scope: logger layer composition used by app layouts inside Trace.record/withRecording.
        // Assertion: the recorder still sees the event emitted under Debug.layer.
        const recorder = Trace.makeRecorder();
        yield* Trace.record(
          Trace.emit("signal.set", () => ({ signal_id: "s1" })).pipe(
            Effect.provide(Debug.layer({ minLevel: "Trace" })),
          ),
          recorder,
        );

        assert.deepStrictEqual(
          recorder.records().map((record) => record.name),
          ["signal.set"],
        );
      }),
    ),
  );

  it.effect("an inner Debug layer overrides the root logger and filter", () =>
    withConsoleCapture((lines) => {
      const program = Effect.gen(function* () {
        // Test: should replace the nearest Debug-owned logger instead of composing two console sinks.
        // Scope: nested root/subtree Debug layers with a narrower subtree filter.
        // Assertion: the matching event prints once and the root cannot leak the rejected event.
        yield* Trace.emit("signal.set", () => ({ signal_id: "s1" }));
        yield* Trace.emit("router.navigate.request", () => ({
          fromPath: "/",
          toPath: "/x",
          replace: false,
        }));

        assert.strictEqual(lines.length, 1);
        assert.include(textOf(lines[0]), "signal");
      });
      return Effect.provide(
        Effect.provide(program, Debug.layer({ minLevel: "Trace", filter: "signal" })),
        Logger.layer([Debug.consoleLogger]),
      );
    }),
  );

  it.effect("nested Debug layers preserve an independent recorder", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        // Test: should identify only Debug-owned loggers when applying a nested override.
        // Scope: recorder plus root and filtered subtree Debug layers.
        // Assertion: one console line is written while the recorder independently receives the event.
        const recorder = Trace.makeRecorder();
        const nestedDebug = Effect.provide(
          Effect.provide(
            Trace.emit("signal.set", () => ({ signal_id: "s1" })),
            Debug.layer({ minLevel: "Trace", filter: "signal" }),
          ),
          Debug.layer({ minLevel: "Trace" }),
        );
        yield* Trace.record(nestedDebug, recorder);

        assert.strictEqual(lines.length, 1);
        assert.deepStrictEqual(
          recorder.records().map((record) => record.name),
          ["signal.set"],
        );
      }),
    ),
  );

  it.effect("batchWindow buffers events and flushes them after the window elapses", () =>
    withConsoleCapture((lines) =>
      Effect.gen(function* () {
        yield* Trace.emit("signal.set", () => ({ signal_id: "s1" }));
        yield* Trace.emit("signal.get", () => ({ signal_id: "s1" }));

        // Nothing is written until the batch window elapses.
        assert.strictEqual(lines.length, 0);

        yield* TestClock.adjust(Duration.millis(100));

        assert.strictEqual(lines.length, 2);
      }).pipe(
        Effect.provide(Debug.layer({ minLevel: "Trace", batchWindow: Duration.millis(100) })),
      ),
    ),
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
  it.effect("should register sink", () =>
    Effect.sync(() => {
      const sink = Metrics.MetricsSink.make("test-sink", () => Effect.void);
      Metrics.registerSink(sink);

      assert.isTrue(Metrics.hasSink("test-sink"));

      Metrics.unregisterSink("test-sink");
    }),
  );

  it.effect("should unregister sink by name", () =>
    Effect.sync(() => {
      const sink = Metrics.MetricsSink.make("to-remove", () => Effect.void);
      Metrics.registerSink(sink);

      assert.isTrue(Metrics.hasSink("to-remove"));

      Metrics.unregisterSink("to-remove");

      assert.isFalse(Metrics.hasSink("to-remove"));
    }),
  );

  it.effect("should export to all registered sinks", () =>
    Effect.gen(function* () {
      const snapshots1: Metrics.MetricsSnapshot[] = [];
      const snapshots2: Metrics.MetricsSnapshot[] = [];

      const sink1 = Metrics.MetricsSink.makeCollector("sink1", snapshots1);
      const sink2 = Metrics.MetricsSink.makeCollector("sink2", snapshots2);

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
      const throwingSink = Metrics.MetricsSink.make("thrower", () => Effect.fail("Sink error"));
      const collectorSink = Metrics.MetricsSink.makeCollector("collector", snapshots);

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
      const sink = Metrics.MetricsSink.makeCollector("collector", snapshots);
      Metrics.registerSink(sink);

      yield* Metrics.exportToSinks;
      yield* Metrics.exportToSinks;
      yield* Metrics.exportToSinks;

      assert.strictEqual(snapshots.length, 3);

      Metrics.unregisterSink("collector");
    }),
  );
});
