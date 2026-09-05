import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Predicate, Schema } from "effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import { TestClock } from "effect/testing";
import * as Metrics from "../../debug/metrics.js";
import * as Signal from "../../primitives/signal.js";
import { scoped } from "../../testing/effect-vitest.js";
import * as Trace from "../index.js";
import { detachJson } from "../json.js";

describe("Trace.emit", () => {
  it.effect("should preserve a real interruption requested during payload construction", () =>
    Effect.gen(function* () {
      // Scope: cancellation reaches the executing fiber while Trace's synchronous payload boundary runs.
      // Assertion: containment does not recover that interruption or execute the following business step.
      const interruptor = yield* Effect.withFiber((fiber) => Effect.succeed(fiber.id));
      let payloadCalls = 0;
      let continued = 0;
      const recorder = Trace.makeRecorder();
      const worker = yield* Effect.forkScoped(
        Effect.withFiber((fiber) =>
          Trace.record(
            Trace.emit("signal.notify", () => {
              payloadCalls++;
              fiber.interruptUnsafe(interruptor);
              return { signal_id: "interrupted", listener_count: 0 };
            }).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  continued++;
                }),
              ),
            ),
            recorder,
          ),
        ),
      );
      const exit = yield* Fiber.await(worker);
      assert.isTrue(Exit.hasInterrupts(exit));
      assert.strictEqual(payloadCalls, 1);
      assert.strictEqual(continued, 0);
      assert.isAtMost(
        recorder.records().filter((record) => record.name === "signal.notify").length,
        1,
      );
    }),
  );

  scoped("should retain caller interruption requested by a logger after signal commit", () =>
    Effect.gen(function* () {
      // Scope: the native logger requests cancellation after Signal.set has committed its value.
      // Assertion: the caller remains interrupted, its stored value remains applied, and emission is not retried.
      const signal = yield* Signal.make(0);
      const interruptor = yield* Effect.withFiber((fiber) => Effect.succeed(fiber.id));
      let loggerCalls = 0;
      let continued = 0;
      const logger = Logger.make(({ fiber }) => {
        loggerCalls++;
        fiber.interruptUnsafe(interruptor);
      });
      const worker = yield* Effect.forkScoped(
        Signal.set(signal, 1).pipe(
          Effect.andThen(
            Effect.sync(() => {
              continued++;
            }),
          ),
          Effect.provide(Logger.layer([logger])),
          Effect.provideService(References.MinimumLogLevel, "Trace"),
        ),
      );
      const exit = yield* Fiber.await(worker);
      assert.isTrue(Exit.hasInterrupts(exit));
      assert.strictEqual(yield* Signal.peek(signal), 1);
      assert.strictEqual(loggerCalls, 1);
      assert.strictEqual(continued, 0);
    }),
  );

  it.effect("should contain payload and logger defects without retrying instrumentation", () =>
    Effect.gen(function* () {
      // Scope: hostile synchronous instrumentation at the Trace emission boundary.
      // Assertion: both emissions succeed, the hostile logger runs once, and no invalid record is stored.
      const recorder = Trace.makeRecorder();
      const payloadExit = yield* Trace.record(
        Trace.emit("signal.set", () => ({ signal_id: decodeURIComponent("%") })),
        recorder,
      ).pipe(Effect.exit);

      let loggerCalls = 0;
      const hostileLogger = Logger.make(() => {
        loggerCalls++;
        return decodeURIComponent("%");
      });
      const loggerExit = yield* Trace.emit("signal.set", () => ({ signal_id: "s1" })).pipe(
        Effect.provide(Logger.layer([hostileLogger])),
        Effect.provideService(References.MinimumLogLevel, "Trace"),
        Effect.exit,
      );

      assert.isTrue(Exit.isSuccess(payloadExit));
      assert.isTrue(Exit.isSuccess(loggerExit));
      assert.strictEqual(loggerCalls, 1);
      assert.deepStrictEqual(recorder.records(), []);
    }),
  );

  scoped(
    "should preserve a committed signal mutation when payload serialization and logging throw",
    () =>
      Effect.gen(function* () {
        // Scope: Signal.set commits before trace emission, listener scheduling, and metric recording.
        // Assertion: hostile serialization and logging cannot change the Exit, value, notification, or metric.
        const signal = yield* Signal.make<unknown>(0);
        const next = { toJSON: () => decodeURIComponent("%") };
        let notifications = 0;
        yield* Signal.subscribe(signal, () =>
          Effect.sync(() => {
            notifications++;
          }),
        ).pipe(Effect.asVoid);
        const before = yield* Metrics.snapshot;
        const hostileLogger = Logger.make(() => decodeURIComponent("%"));

        const exit = yield* Signal.set(signal, next).pipe(
          Effect.provide(Logger.layer([hostileLogger])),
          Effect.provideService(References.MinimumLogLevel, "Trace"),
          Effect.exit,
        );
        yield* TestClock.adjust(0);
        const after = yield* Metrics.snapshot;

        assert.isTrue(Exit.isSuccess(exit));
        assert.strictEqual(yield* Signal.peek(signal), next);
        assert.strictEqual(notifications, 1);
        assert.isAtLeast(after.signalUpdateCount - before.signalUpdateCount, 1);
      }),
  );

  scoped("should not execute business serialization hooks after a signal commit", () =>
    Effect.gen(function* () {
      // Scope: compares enabled, level-filtered, and logger-free Trace paths after Signal.set commits.
      // Assertion: every path preserves the same Exit, stored object, hook state, and listener count.
      type TraceMode = "enabled" | "filtered" | "absent";
      const runCase = Effect.fnUntraced(function* (mode: TraceMode) {
        const signal = yield* Signal.make<unknown>(0);
        let notifications = 0;
        yield* Signal.subscribe(signal, () =>
          Effect.sync(() => {
            notifications++;
          }),
        ).pipe(Effect.asVoid);

        let toJsonCalls = 0;
        const withToJson = { stable: "before" };
        Object.defineProperty(withToJson, "toJSON", {
          enumerable: true,
          value: () => {
            toJsonCalls++;
            withToJson.stable = "mutated";
            return decodeURIComponent("%");
          },
        });
        let inheritedToJsonCalls = 0;
        class WithInheritedToJson {
          readonly stable = "before";

          toJSON(): string {
            inheritedToJsonCalls++;
            return decodeURIComponent("%");
          }
        }
        const withInheritedToJson = new WithInheritedToJson();

        let getterCalls = 0;
        const withGetter = { stable: "before" };
        Object.defineProperty(withGetter, "danger", {
          enumerable: true,
          get: () => {
            getterCalls++;
            withGetter.stable = "mutated";
            return decodeURIComponent("%");
          },
        });
        const next = { withToJson, withInheritedToJson, withGetter };
        const set = Signal.set(signal, next);
        const exit =
          mode === "enabled"
            ? yield* Trace.record(set, Trace.makeRecorder()).pipe(Effect.exit)
            : mode === "filtered"
              ? yield* set.pipe(
                  Effect.provideService(References.MinimumLogLevel, "Fatal"),
                  Effect.exit,
                )
              : yield* set.pipe(
                  Effect.provide(Logger.layer([])),
                  Effect.provideService(References.MinimumLogLevel, "Trace"),
                  Effect.exit,
                );
        yield* TestClock.adjust(0);
        const stored = yield* Signal.peek(signal);

        return {
          success: Exit.isSuccess(exit),
          storedIdentity: stored === next,
          notifications,
          toJsonCalls,
          inheritedToJsonCalls,
          getterCalls,
          toJsonState: withToJson.stable,
          getterState: withGetter.stable,
        };
      });

      const expected = {
        success: true,
        storedIdentity: true,
        notifications: 1,
        toJsonCalls: 0,
        inheritedToJsonCalls: 0,
        getterCalls: 0,
        toJsonState: "before",
        getterState: "before",
      };
      assert.deepStrictEqual(yield* runCase("enabled"), expected);
      assert.deepStrictEqual(yield* runCase("filtered"), expected);
      assert.deepStrictEqual(yield* runCase("absent"), expected);
    }),
  );

  scoped("should never inspect live Proxy values during signal set or derive", () =>
    Effect.gen(function* () {
      // Scope: compares Proxy-valued Signal commits and derivation under enabled, filtered, and absent sinks.
      // Assertion: Trace performs no Proxy operation and preserves state, projections, and listeners in every mode.
      type TraceMode = "enabled" | "filtered" | "absent";
      const run = <A, E, R>(
        mode: TraceMode,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> =>
        mode === "enabled"
          ? Trace.record(effect, Trace.makeRecorder())
          : mode === "filtered"
            ? effect.pipe(Effect.provideService(References.MinimumLogLevel, "Fatal"))
            : effect.pipe(
                Effect.provide(Logger.layer([])),
                Effect.provideService(References.MinimumLogLevel, "Trace"),
              );

      const runCase = Effect.fnUntraced(function* (mode: TraceMode) {
        let setTraps = 0;
        const setTarget = { state: "stable" };
        const setValue = new Proxy(setTarget, {
          get: (target, key, receiver) => {
            setTraps++;
            setTarget.state = "mutated";
            // oxlint-disable-next-line effect/no-unknown-shape-probing -- The hostile Proxy must otherwise preserve target behavior.
            return Reflect.get(target, key, receiver);
          },
          getOwnPropertyDescriptor: (target, key) => {
            setTraps++;
            setTarget.state = "mutated";
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
          ownKeys: (target) => {
            setTraps++;
            setTarget.state = "mutated";
            return Reflect.ownKeys(target);
          },
        });
        const signal = yield* Signal.make<unknown>(0);
        let notifications = 0;
        yield* Signal.subscribe(signal, () =>
          Effect.sync(() => {
            notifications++;
          }),
        ).pipe(Effect.asVoid);
        const setExit = yield* run(mode, Signal.set(signal, setValue)).pipe(Effect.exit);
        yield* TestClock.adjust(0);

        let deriveTraps = 0;
        const deriveTarget = { state: "stable" };
        const derivedValue = new Proxy(deriveTarget, {
          get: (target, key, receiver) => {
            deriveTraps++;
            deriveTarget.state = "mutated";
            // oxlint-disable-next-line effect/no-unknown-shape-probing -- The hostile Proxy must otherwise preserve target behavior.
            return Reflect.get(target, key, receiver);
          },
          getOwnPropertyDescriptor: (target, key) => {
            deriveTraps++;
            deriveTarget.state = "mutated";
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
          ownKeys: (target) => {
            deriveTraps++;
            deriveTarget.state = "mutated";
            return Reflect.ownKeys(target);
          },
        });
        const source = yield* Signal.make(1);
        let projectionCalls = 0;
        const derived = yield* run(
          mode,
          Signal.derive(source, () => {
            projectionCalls++;
            return derivedValue;
          }),
        );
        yield* Signal.subscribe(derived, () => Effect.void).pipe(Effect.asVoid);

        return {
          setSuccess: Exit.isSuccess(setExit),
          setIdentity: (yield* Signal.peek(signal)) === setValue,
          setState: setTarget.state,
          setTraps,
          notifications,
          derivedIdentity: (yield* Signal.peek(derived)) === derivedValue,
          deriveState: deriveTarget.state,
          deriveTraps,
          projectionCalls,
          sourceListeners: source._listeners.size,
          derivedListeners: derived._listeners.size,
        };
      });

      const expected = {
        setSuccess: true,
        setIdentity: true,
        setState: "stable",
        setTraps: 0,
        notifications: 1,
        derivedIdentity: true,
        deriveState: "stable",
        deriveTraps: 0,
        projectionCalls: 1,
        sourceListeners: 1,
        derivedListeners: 1,
      };
      assert.deepStrictEqual(yield* runCase("enabled"), expected);
      assert.deepStrictEqual(yield* runCase("filtered"), expected);
      assert.deepStrictEqual(yield* runCase("absent"), expected);
    }),
  );

  it.effect("should evaluate enabled payloads once and filtered payloads never", () =>
    Effect.gen(function* () {
      // Scope: payload thunk evaluation across enabled and minimum-level-filtered emissions.
      // Assertion: an enabled event evaluates once; a filtered event performs no application work.
      const recorder = Trace.makeRecorder();
      let enabledCalls = 0;
      yield* Trace.record(
        Trace.emit("signal.set", () => {
          enabledCalls++;
          return { signal_id: "enabled" };
        }),
        recorder,
      );

      let filteredCalls = 0;
      yield* Trace.emit("signal.set", () => {
        filteredCalls++;
        return { signal_id: "filtered" };
      }).pipe(Effect.provideService(References.MinimumLogLevel, "Info"));

      assert.strictEqual(enabledCalls, 1);
      assert.strictEqual(filteredCalls, 0);
    }),
  );

  it.effect("should accept only origin-marked payloads that pass exact decoding", () =>
    Effect.gen(function* () {
      // Scope: origin and runtime schema checks at the recorder boundary.
      // Assertion: homonymous, missing, and excessive payloads are dropped while one valid event records.
      const recorder = Trace.makeRecorder();
      const malformed = { signal_id: "s1", listener_count: 1 };
      Reflect.deleteProperty(malformed, "listener_count");
      const excessive = { signal_id: "s1", listener_count: 1 };
      Object.defineProperty(excessive, "extra", { enumerable: true, value: true });

      yield* Trace.record(
        Effect.gen(function* () {
          yield* Effect.log("signal.notify");
          yield* Trace.emit("signal.notify", () => malformed);
          yield* Trace.emit("signal.notify", () => excessive);
          yield* Trace.emit("signal.notify", () => ({ signal_id: "s1", listener_count: 1 }));
        }),
        recorder,
      );

      assert.deepStrictEqual(
        recorder.records().map((record) => ({ name: record.name, payload: record.payload })),
        [{ name: "signal.notify", payload: { signal_id: "s1", listener_count: 1 } }],
      );
    }),
  );

  it.effect("should reject legacy query-bearing request payloads before recording or export", () =>
    Effect.gen(function* () {
      // Test: should reject legacy query-bearing request payloads before recording or export
      // Scope: runtime exact decoding for the retired api.request.received { method, url } shape.
      // Assertion: the legacy event is dropped and no query sentinel reaches recorder or report output.
      const sentinel = "request-query-sentinel-secret";
      const legacy = { method: "GET", pathname: "/api/session" };
      Reflect.deleteProperty(legacy, "pathname");
      Reflect.set(legacy, "url", `/api/session?token=${sentinel}`);
      const recorder = Trace.makeRecorder();

      yield* Trace.record(
        Effect.gen(function* () {
          yield* Trace.emitPayload("api.request.received", () => legacy);
          yield* Trace.emit("api.request.received", () => ({
            method: "GET",
            pathname: "/api/session",
          }));
        }),
        recorder,
      );

      assert.deepStrictEqual(recorder.records(), [
        {
          name: "api.request.received",
          payload: { method: "GET", pathname: "/api/session" },
          actionId: undefined,
        },
      ]);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.notInclude(JSON.stringify(Trace.toJSON(recorder.records())), sentinel);
      assert.notInclude(Trace.toMarkdown(recorder.records()), sentinel);
    }),
  );

  it.effect("should validate original data properties before lossy detachment", () =>
    Effect.gen(function* () {
      // Scope: runtime Schema validation for variables containing wrong types, accessors, extras, and undefined.
      // Assertion: malformed inputs are dropped without invoking accessors; optional undefined is omitted as absent.
      const wrongType = { signal_id: "wrong", listener_count: 1 };
      Reflect.set(wrongType, "listener_count", "one");
      const wrongFunction = { signal_id: "function", listener_count: 1 };
      Reflect.set(wrongFunction, "listener_count", () => 1);
      let accessorCalls = 0;
      const accessor = {
        signal_id: "accessor",
        get listener_count(): number {
          accessorCalls++;
          return 1;
        },
      };
      const extra = { signal_id: "extra", listener_count: 1 };
      Object.defineProperty(extra, "extra", { enumerable: true, value: true });
      const recorder = Trace.makeRecorder();

      yield* Trace.record(
        Effect.gen(function* () {
          yield* Trace.emitPayload("signal.notify", () => wrongType);
          yield* Trace.emitPayload("signal.notify", () => wrongFunction);
          yield* Trace.emitPayload("signal.notify", () => accessor);
          yield* Trace.emitPayload("signal.notify", () => extra);
          yield* Trace.emit("signal.get", () => ({ signal_id: "valid", trigger: undefined }));
        }),
        recorder,
      );

      assert.strictEqual(accessorCalls, 0);
      assert.deepStrictEqual(
        recorder.records().map((record) => ({ name: record.name, payload: record.payload })),
        [{ name: "signal.get", payload: { signal_id: "valid" } }],
      );
    }),
  );

  it.effect("should trust envelope identity once per reader instead of copied annotations", () =>
    Effect.gen(function* () {
      // Scope: a preserved logger captures, mutates, clones, and synchronously replays Trace annotations.
      // Assertion: one immutable original record is accepted; exact replays and copied envelopes are rejected.
      const recorder = Trace.makeRecorder();
      let preservedAnnotations: Readonly<Record<string, unknown>> | undefined;
      let forgedAnnotations: Readonly<Record<string, unknown>> | undefined;
      const malicious = Logger.make<unknown, void>((options) => {
        const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
        preservedAnnotations = annotations;
        const forged: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(annotations)) {
          if (Predicate.isObject(value)) {
            forged[key] = Object.freeze({ ...value });
            Reflect.set(value, "name", "router.navigate.request");
            const payload = value["payload"];
            if (Predicate.isObject(payload)) Reflect.set(payload, "listener_count", 999);
          } else {
            forged[key] = value;
          }
        }
        forgedAnnotations = forged;
        recorder.logger.log(options);
        recorder.logger.log(options);
      });

      yield* Trace.emit("signal.notify", () => ({ signal_id: "s1", listener_count: 1 })).pipe(
        Effect.provide(Logger.layer([malicious, recorder.logger])),
        Effect.provideService(References.MinimumLogLevel, "Trace"),
      );
      const lateRecorder = Trace.makeRecorder();
      if (preservedAnnotations !== undefined) {
        yield* Effect.annotateLogs(
          Effect.logWithLevel("Debug")("signal.notify"),
          preservedAnnotations,
        ).pipe(Effect.provide(Logger.layer([recorder.logger, lateRecorder.logger])));
      }
      if (forgedAnnotations !== undefined) {
        yield* Effect.annotateLogs(
          Effect.logWithLevel("Debug")("signal.notify"),
          forgedAnnotations,
        ).pipe(Effect.provide(Logger.layer([recorder.logger, lateRecorder.logger])));
      }

      assert.deepStrictEqual(recorder.records(), [
        {
          name: "signal.notify",
          payload: { signal_id: "s1", listener_count: 1 },
          actionId: undefined,
        },
      ]);
      assert.deepStrictEqual(lateRecorder.records(), []);
    }),
  );

  it.effect("should preserve emitted nested facts after application mutation", () =>
    Effect.gen(function* () {
      // Scope: actual Trace emission, recorder history, and both public report formats.
      // Assertion: mutating the original nested object/array never rewrites the observed start event.
      const facts = { nested: { label: "before" }, items: ["before"] };
      const recorder = Trace.makeRecorder();
      yield* Trace.record(
        Trace.withAction(
          "mutable",
          facts,
          Effect.sync(() => {
            facts.nested.label = "after";
            facts.items[0] = "after";
          }),
        ),
        recorder,
      );
      const snapshot = yield* recorder.snapshot;
      const report = Trace.toJSON(recorder.records());
      facts.nested.label = "later";
      facts.items.push("later");
      assert.deepStrictEqual(snapshot[0]?.payload, {
        actionId: "mutable",
        facts: { nested: { label: "before" }, items: ["before"] },
      });
      assert.deepStrictEqual(recorder.records()[0]?.payload, snapshot[0]?.payload);
      assert.deepStrictEqual(report[0]?.payload, snapshot[0]?.payload);
      assert.notInclude(JSON.stringify(report), "after");
      assert.notInclude(JSON.stringify(report), "later");
      assert.notInclude(Trace.toMarkdown(recorder.records()), "later");
    }),
  );

  it.effect("should detach mutable payloads into JSON-safe records", () =>
    Effect.gen(function* () {
      // Scope: bounded JSON snapshot plus report reuse of an already immutable recorder payload.
      // Assertion: detachment is immutable/JSON-safe and reports never redetach the recorded payload.
      const mutable = { label: "before" };
      const cyclic: { big: bigint; self?: unknown } = { big: 1n };
      cyclic.self = cyclic;
      let toJsonCalls = 0;
      const hostile = { stable: true };
      Object.defineProperty(hostile, "toJSON", {
        enumerable: true,
        value: () => {
          toJsonCalls++;
          return decodeURIComponent("%");
        },
      });
      let getterCalls = 0;
      const hostileGetter = Object.defineProperty({ stable: true }, "broken", {
        enumerable: true,
        get: () => {
          getterCalls++;
          return decodeURIComponent("%");
        },
      });
      const unsupported = {
        callback: () => undefined,
        infinite: Number.POSITIVE_INFINITY,
        missing: undefined,
        token: Symbol("token"),
      };
      const revoked = Proxy.revocable({ value: "hidden" }, {});
      revoked.revoke();
      const detached = detachJson({
        mutable,
        cyclic,
        hostile,
        hostileGetter,
        unsupported,
        revoked: revoked.proxy,
      });
      mutable.label = "after";

      assert.deepStrictEqual(detached, {
        mutable: { label: "before" },
        cyclic: { big: "1n", self: "[Circular]" },
        hostile: { stable: true, toJSON: "[Function]" },
        hostileGetter: { stable: true, broken: "[Accessor]" },
        unsupported: {
          callback: "[Function]",
          infinite: "Infinity",
          token: "[Symbol]",
        },
        revoked: "[Unserializable]",
      });
      assert.strictEqual(toJsonCalls, 0);
      assert.strictEqual(getterCalls, 0);
      assert.isTrue(Object.isFrozen(detached));
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.isString(JSON.stringify(detached));

      const recorder = Trace.makeRecorder();
      yield* Trace.record(
        Trace.emit("signal.set", () => ({
          signal_id: "s1",
          value_type: "object",
        })),
        recorder,
      );
      assert.isTrue(Object.isFrozen(recorder.records()[0]?.payload));
      const report = Trace.toJSON(recorder.records());
      assert.isTrue(Object.isFrozen(report));
      assert.isTrue(Object.isFrozen(report[0]));
      assert.strictEqual(report[0]?.payload, recorder.records()[0]?.payload);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.isString(JSON.stringify(recorder.records()));
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.isString(JSON.stringify(report));
      assert.include(Trace.toMarkdown(recorder.records()), '"value_type":"object"');
    }),
  );
});

describe("detachJson", () => {
  it("should bound sparse arrays, depth, entries, and string output", () => {
    // Scope: hostile-size but framework-owned telemetry containers at the JSON snapshot boundary.
    // Assertion: work and output remain bounded, distant sparse accessors are untouched, and markers are stable.
    let accessorCalls = 0;
    const sparse: Array<unknown> = [];
    sparse.length = 100_000;
    Object.defineProperty(sparse, 99_999, {
      enumerable: true,
      get: () => {
        accessorCalls++;
        return "unreachable";
      },
    });
    let nested: unknown = "x".repeat(100_000);
    for (let depth = 0; depth < 100; depth++) nested = { nested };
    const wide: Record<string, number> = {};
    for (let index = 0; index < 100; index++) wide[`key_${index}`] = index;

    const detachedSparse = detachJson(sparse);
    const detachedNested = detachJson(nested);
    const detachedWide = detachJson(wide);

    assert.strictEqual(accessorCalls, 0);
    assert.deepStrictEqual(detachedSparse, ["[Truncated:Entries]"]);
    const rendered = JSON.stringify(detachedNested);
    assert.isBelow(rendered.length, 10_000);
    assert.include(rendered, "[Truncated:");
    assert.isFalse(Array.isArray(detachedWide));
    if (detachedWide !== null && typeof detachedWide === "object" && !Array.isArray(detachedWide)) {
      assert.isAtMost(Object.keys(detachedWide).length, 64);
      assert.strictEqual(
        Object.getOwnPropertyDescriptor(detachedWide, "$trygg_truncated")?.value,
        "[Truncated:Entries]",
      );
    }
  });

  it("should bound descriptor reads and truncate wide Proxies deterministically", () => {
    // Scope: repeated detachment of a hostile 10,000-key Proxy at the global entry budget.
    // Assertion: each pass performs at most 64 descriptor reads and returns the same bounded marker snapshot.
    const target: Record<string, number> = {};
    for (let index = 0; index < 10_000; index++) {
      target[`key_${String(index).padStart(5, "0")}`] = index;
    }
    const detach = () => {
      let ownKeysCalls = 0;
      let descriptorCalls = 0;
      const proxy = new Proxy(target, {
        ownKeys: (value) => {
          ownKeysCalls++;
          return Reflect.ownKeys(value);
        },
        getOwnPropertyDescriptor: (value, key) => {
          descriptorCalls++;
          return Reflect.getOwnPropertyDescriptor(value, key);
        },
      });
      return { value: detachJson(proxy), ownKeysCalls, descriptorCalls };
    };

    const first = detach();
    const second = detach();

    assert.strictEqual(first.ownKeysCalls, 1);
    assert.strictEqual(second.ownKeysCalls, 1);
    assert.isAtMost(first.descriptorCalls, 64);
    assert.isAtMost(second.descriptorCalls, 64);
    assert.deepStrictEqual(first.value, second.value);
    assert.isFalse(Array.isArray(first.value));
    assert.strictEqual(typeof first.value, "object");
    if (first.value !== null && typeof first.value === "object" && !Array.isArray(first.value)) {
      assert.isAtMost(Object.keys(first.value).length, 64);
      assert.strictEqual(
        Object.getOwnPropertyDescriptor(first.value, "$trygg_truncated")?.value,
        "[Truncated:Entries]",
      );
    }
  });

  it("should stop array descriptor reads when a nested object consumes the shared budget", () => {
    // Scope: an in-budget array whose first Proxy child consumes every remaining entry.
    // Assertion: later array slots are not inspected and the whole array uses the stable truncation marker.
    const childTarget: Record<string, number> = {};
    for (let index = 0; index < 10_000; index++) {
      childTarget[`key_${String(index).padStart(5, "0")}`] = index;
    }
    let descriptorCalls = 0;
    const child = new Proxy(childTarget, {
      getOwnPropertyDescriptor: (value, key) => {
        descriptorCalls++;
        return Reflect.getOwnPropertyDescriptor(value, key);
      },
    });
    const array: Array<unknown> = [child];
    array.length = 64;
    const input = new Proxy(array, {
      getOwnPropertyDescriptor: (value, key) => {
        descriptorCalls++;
        return Reflect.getOwnPropertyDescriptor(value, key);
      },
    });

    const detached = detachJson(input);

    assert.isAtMost(descriptorCalls, 64);
    assert.deepStrictEqual(detached, ["[Truncated:Entries]"]);
  });

  it("should keep nested object markers inside the global entry budget", () => {
    // Scope: a wide nested object followed by another parent property.
    // Assertion: both nested and parent truncation markers fit inside the same 64-entry budget.
    const target: Record<string, number> = {};
    for (let index = 0; index < 10_000; index++) {
      target[`key_${String(index).padStart(5, "0")}`] = index;
    }
    let descriptorCalls = 0;
    const nested = new Proxy(target, {
      getOwnPropertyDescriptor: (value, key) => {
        descriptorCalls++;
        return Reflect.getOwnPropertyDescriptor(value, key);
      },
    });

    const detached = detachJson({ nested, tail: "unreachable" });

    assert.isAtMost(descriptorCalls, 64);
    assert.isFalse(Array.isArray(detached));
    if (detached !== null && typeof detached === "object" && !Array.isArray(detached)) {
      const nestedValue = Object.getOwnPropertyDescriptor(detached, "nested")?.value;
      assert.strictEqual(
        Object.getOwnPropertyDescriptor(detached, "$trygg_truncated")?.value,
        "[Truncated:Entries]",
      );
      assert.isFalse(Array.isArray(nestedValue));
      if (nestedValue !== null && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
        assert.isAtMost(Object.keys(detached).length + Object.keys(nestedValue).length, 64);
        assert.strictEqual(
          Object.getOwnPropertyDescriptor(nestedValue, "$trygg_truncated")?.value,
          "[Truncated:Entries]",
        );
      }
    }
  });

  it.effect("should reject a wide exact payload after bounded descriptor validation", () =>
    Effect.gen(function* () {
      // Scope: an exact event payload whose Proxy exposes thousands of excess own properties.
      // Assertion: validation reads at most 64 descriptors and drops the truncated excess shape.
      const target = { signal_id: "wide", listener_count: 1 };
      for (let index = 0; index < 10_000; index++) {
        Reflect.set(target, `extra_${String(index).padStart(5, "0")}`, index);
      }
      let ownKeysCalls = 0;
      let descriptorCalls = 0;
      const payload = new Proxy(target, {
        ownKeys: (value) => {
          ownKeysCalls++;
          return Reflect.ownKeys(value);
        },
        getOwnPropertyDescriptor: (value, key) => {
          descriptorCalls++;
          return Reflect.getOwnPropertyDescriptor(value, key);
        },
      });
      const recorder = Trace.makeRecorder();

      yield* Trace.record(
        Trace.emit("signal.notify", () => payload),
        recorder,
      );

      assert.strictEqual(ownKeysCalls, 1);
      assert.isAtMost(descriptorCalls, 64);
      assert.deepStrictEqual(recorder.records(), []);
    }),
  );

  it.effect("should reject oversized telemetry arrays before Schema decoding", () =>
    Effect.gen(function* () {
      // Scope: a huge sparse framework payload at the validation boundary.
      // Assertion: Schema never walks its holes or distant accessor and no partial event is logged.
      let accessorCalls = 0;
      const allowedSchemes: Array<string> = [];
      allowedSchemes.length = 100_000;
      Object.defineProperty(allowedSchemes, 99_999, {
        enumerable: true,
        get: () => {
          accessorCalls++;
          return "danger";
        },
      });
      const recorder = Trace.makeRecorder();

      yield* Trace.record(
        Trace.emit("safeUrl.blocked", () => ({
          attribute: "href",
          url: "https://example.test",
          allowed_schemes: allowedSchemes,
        })),
        recorder,
      );

      assert.strictEqual(accessorCalls, 0);
      assert.deepStrictEqual(recorder.records(), []);
    }),
  );

  it.effect("should validate then truncate a long payload string", () =>
    Effect.gen(function* () {
      // Scope: a valid string field that exceeds the detached-history string budget.
      // Assertion: Schema accepts its original type before the recorder stores the stable truncation marker.
      const recorder = Trace.makeRecorder();
      yield* Trace.record(
        Trace.emit("router.navigate.commit", () => ({
          path: "x".repeat(10_000),
          query: "",
        })),
        recorder,
      );

      const path = recorder.records()[0]?.payload?.["path"];
      assert.strictEqual(typeof path, "string");
      if (typeof path === "string") {
        assert.strictEqual(path.length, 2_048 + "[Truncated:String]".length);
        assert.isTrue(path.endsWith("[Truncated:String]"));
      }
    }),
  );
});

describe("Trace.withAction", () => {
  it.effect("should retain a paired lifecycle when valid facts exceed detach depth", () =>
    Effect.gen(function* () {
      // Scope: 20 levels of descriptor-only action facts crossing validation and lossy detachment.
      // Assertion: valid facts emit one correlated pair with the depth marker; a deep invalid value is rejected first.
      let descriptorReads = 0;
      const wrap = (value: Schema.Json): Schema.JsonObject =>
        new Proxy(
          { nested: value },
          {
            getOwnPropertyDescriptor: (target, key) => {
              descriptorReads++;
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
          },
        );
      let deepValue: Schema.Json = "leaf";
      for (let depth = 0; depth < 20; depth++) deepValue = wrap(deepValue);
      const facts: Schema.JsonObject = { deep: deepValue };

      const invalidLeaf: Schema.JsonObject = { value: "valid" };
      Reflect.set(invalidLeaf, "value", () => "invalid");
      let invalidValue: Schema.Json = invalidLeaf;
      for (let depth = 0; depth < 20; depth++) invalidValue = { nested: invalidValue };
      const invalidFacts: Schema.JsonObject = { deep: invalidValue };

      const rawActionId = "d".repeat(100_000);
      const canonicalActionId = `${"d".repeat(2_048)}[Truncated:String]`;
      const recorder = Trace.makeRecorder();
      yield* Trace.record(
        Effect.gen(function* () {
          yield* Trace.withAction(rawActionId, facts, Effect.void);
          yield* Trace.emit("contract.action.start", () => ({
            actionId: "invalid",
            facts: invalidFacts,
          }));
        }),
        recorder,
      );

      const lifecycle = recorder
        .records()
        .filter(
          (record) =>
            record.name === "contract.action.start" || record.name === "contract.action.end",
        );
      assert.deepStrictEqual(
        lifecycle.map((record) => record.name),
        ["contract.action.start", "contract.action.end"],
      );
      assert.deepStrictEqual(
        lifecycle.map((record) => record.payload?.["actionId"]),
        [canonicalActionId, canonicalActionId],
      );
      assert.isAtMost(descriptorReads, 64);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.include(JSON.stringify(lifecycle[0]?.payload), "[Truncated:Depth]");

      const report = Trace.toJSON(recorder.records());
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const reportJson = JSON.stringify(report);
      assert.isString(reportJson);
      assert.include(reportJson, "[Truncated:Depth]");
      assert.notInclude(reportJson, rawActionId);
    }),
  );

  it.effect("should retain a bounded start and terminal for wide Proxy facts", () =>
    Effect.gen(function* () {
      // Scope: a valid wide JsonObject fact set crossing validation and detachment budgets.
      // Assertion: descriptor work is bounded and truncation retains a correlated start/end lifecycle.
      const target: Record<string, number> = {};
      for (let index = 0; index < 10_000; index++) {
        target[`fact_${String(index).padStart(5, "0")}`] = index;
      }
      let ownKeysCalls = 0;
      let descriptorCalls = 0;
      const facts = new Proxy(target, {
        ownKeys: (value) => {
          ownKeysCalls++;
          return Reflect.ownKeys(value);
        },
        getOwnPropertyDescriptor: (value, key) => {
          descriptorCalls++;
          return Reflect.getOwnPropertyDescriptor(value, key);
        },
      });
      const recorder = Trace.makeRecorder();

      yield* Trace.record(Trace.withAction("wide", facts, Effect.void), recorder);
      const lifecycle = recorder
        .records()
        .filter(
          (record) =>
            record.name === "contract.action.start" || record.name === "contract.action.end",
        );

      assert.strictEqual(ownKeysCalls, 1);
      assert.isAtMost(descriptorCalls, 64);
      assert.deepStrictEqual(
        lifecycle.map((record) => record.name),
        ["contract.action.start", "contract.action.end"],
      );
      const detachedFacts = lifecycle[0]?.payload?.["facts"];
      assert.isDefined(detachedFacts);
      assert.isFalse(Array.isArray(detachedFacts));
      assert.strictEqual(typeof detachedFacts, "object");
      if (
        detachedFacts !== null &&
        typeof detachedFacts === "object" &&
        !Array.isArray(detachedFacts)
      ) {
        assert.isAtMost(Object.keys(detachedFacts).length, 62);
        assert.strictEqual(
          Object.getOwnPropertyDescriptor(detachedFacts, "$trygg_truncated")?.value,
          "[Truncated:Entries]",
        );
      }
      assert.deepStrictEqual(lifecycle[1]?.payload, {
        actionId: "wide",
        status: "completed",
      });
    }),
  );

  it.effect("should canonicalize a huge action id once across records and reports", () =>
    Effect.gen(function* () {
      // Scope: one oversized action ID across lifecycle payloads, an inner annotation, and both report formats.
      // Assertion: every correlation surface uses the same bounded string and no raw oversized copy survives.
      const rawActionId = "a".repeat(100_000);
      const canonicalActionId = `${"a".repeat(2_048)}[Truncated:String]`;
      const recorder = Trace.makeRecorder();
      yield* Trace.record(
        Trace.withAction(
          rawActionId,
          { operation: "huge-id" },
          Trace.emit("signal.get", () => ({ signal_id: "inside" })),
        ),
        recorder,
      );

      const records = recorder.records();
      const start = records.find((record) => record.name === "contract.action.start");
      const inner = records.find((record) => record.name === "signal.get");
      const end = records.find((record) => record.name === "contract.action.end");
      const report = Trace.toJSON(records);
      const reportStart = report.find((entry) => entry.name === "contract.action.start");
      const reportInner = report.find((entry) => entry.name === "signal.get");
      const reportEnd = report.find((entry) => entry.name === "contract.action.end");

      assert.deepStrictEqual(
        [
          start?.payload?.["actionId"],
          inner?.actionId,
          end?.payload?.["actionId"],
          reportStart?.payload?.["actionId"],
          reportInner?.actionId,
          reportEnd?.payload?.["actionId"],
        ],
        Array.from({ length: 6 }, () => canonicalActionId),
      );
      assert.strictEqual(canonicalActionId.length, 2_048 + "[Truncated:String]".length);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.isBelow(JSON.stringify(report).length, 20_000);
      assert.isBelow(Trace.toMarkdown(records).length, 20_000);
    }),
  );

  it.effect("should classify the complete pure and mixed Cause matrix", () =>
    Effect.gen(function* () {
      // Scope: completed, pure failure/defect/interruption, and mixed terminal Causes.
      // Assertion: only interrupt-only Causes are interrupted; every Exit is preserved with one cause-free terminal.
      interface CauseCase {
        readonly label: string;
        readonly cause: Cause.Cause<string>;
        readonly status: "failed" | "interrupted";
      }
      const cases: ReadonlyArray<CauseCase> = [
        { label: "fail", cause: Cause.fail("expected"), status: "failed" },
        { label: "die", cause: Cause.die("defect"), status: "failed" },
        { label: "interrupt", cause: Cause.interrupt(1), status: "interrupted" },
        {
          label: "interrupt-pair",
          cause: Cause.combine(Cause.interrupt(1), Cause.interrupt(2)),
          status: "interrupted",
        },
        {
          label: "fail-interrupt",
          cause: Cause.combine(Cause.fail("expected"), Cause.interrupt(2)),
          status: "failed",
        },
        {
          label: "die-interrupt",
          cause: Cause.combine(Cause.die("defect"), Cause.interrupt(2)),
          status: "failed",
        },
        {
          label: "fail-die",
          cause: Cause.combine(Cause.fail("expected"), Cause.die("defect")),
          status: "failed",
        },
        {
          label: "fail-die-interrupt",
          cause: Cause.combine(
            Cause.combine(Cause.fail("expected"), Cause.die("defect")),
            Cause.interrupt(2),
          ),
          status: "failed",
        },
      ];

      const completedRecorder = Trace.makeRecorder();
      const completedExit = yield* Trace.record(
        Trace.withAction("completed", { operation: "matrix" }, Effect.succeed("value")),
        completedRecorder,
      ).pipe(Effect.exit);
      assert.deepStrictEqual(completedExit, Exit.succeed("value"));
      assert.deepStrictEqual(
        completedRecorder.records().filter((record) => record.name === "contract.action.end"),
        [
          {
            name: "contract.action.end",
            payload: { actionId: "completed", status: "completed" },
            actionId: undefined,
          },
        ],
      );

      for (const testCase of cases) {
        const recorder = Trace.makeRecorder();
        const exit = yield* Trace.record(
          Trace.withAction(
            testCase.label,
            { operation: "matrix" },
            Effect.failCause(testCase.cause),
          ),
          recorder,
        ).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.deepStrictEqual(exit.cause, testCase.cause);
        const terminals = recorder
          .records()
          .filter((record) => record.name === "contract.action.end");
        assert.strictEqual(terminals.length, 1);
        assert.deepStrictEqual(terminals[0]?.payload, {
          actionId: testCase.label,
          status: testCase.status,
        });
        assert.deepStrictEqual(Object.keys(terminals[0]?.payload ?? {}).sort(), [
          "actionId",
          "status",
        ]);
      }
    }),
  );
  it.effect("should emit one interrupted terminal for explicit interruption", () =>
    Effect.gen(function* () {
      // Scope: an interruption returned directly by the wrapped action.
      // Assertion: the original interrupted Exit survives and one cause-free interrupted terminal is recorded.
      const recorder = Trace.makeRecorder();
      const exit = yield* Trace.record(
        Trace.withAction("explicit", { operation: "test" }, Effect.interrupt),
        recorder,
      ).pipe(Effect.exit);
      const terminals = recorder
        .records()
        .filter((record) => record.name === "contract.action.end");

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
      assert.strictEqual(terminals.length, 1);
      assert.deepStrictEqual(terminals[0]?.payload, {
        actionId: "explicit",
        status: "interrupted",
      });
      assert.isFalse(Object.hasOwn(terminals[0]?.payload ?? {}, "cause"));
    }),
  );

  it.effect("should finalize an externally interrupted action exactly once", () =>
    Effect.gen(function* () {
      // Scope: coordinated external interruption after the action start event has been observed.
      // Assertion: start has one terminal, terminal status is interrupted, and the fiber Exit remains interrupted.
      const recorder = Trace.makeRecorder();
      const started = yield* Deferred.make<void>();
      const fiber = yield* Trace.record(
        Trace.withAction(
          "external",
          { operation: "test" },
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            return yield* Effect.never;
          }),
        ),
        recorder,
      ).pipe(Effect.forkChild);

      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      const lifecycle = recorder
        .records()
        .filter(
          (record) =>
            record.name === "contract.action.start" || record.name === "contract.action.end",
        );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
      assert.deepStrictEqual(
        lifecycle.map((record) => record.name),
        ["contract.action.start", "contract.action.end"],
      );
      assert.deepStrictEqual(lifecycle[0]?.payload, {
        actionId: "external",
        facts: { operation: "test" },
      });
      assert.deepStrictEqual(lifecycle[1]?.payload, {
        actionId: "external",
        status: "interrupted",
      });
    }),
  );
});
