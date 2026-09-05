import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  ConfigProvider,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Predicate,
  Schema,
  Tracer,
} from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Profiling from "../profiling.js";
import { scoped } from "../testing/effect-vitest.js";
import { render } from "../testing/index.js";
import * as Signal from "../primitives/signal.js";

const Payload = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      resource: Schema.Struct({
        attributes: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.Unknown })),
      }),
      scopeSpans: Schema.Array(
        Schema.Struct({
          spans: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              spanId: Schema.String,
              traceId: Schema.String,
              parentSpanId: Schema.optional(Schema.String),
              startTimeUnixNano: Schema.String,
              endTimeUnixNano: Schema.String,
              attributes: Schema.Array(Schema.Unknown),
              status: Schema.Struct({ code: Schema.Number }),
            }),
          ),
        }),
      ),
    }),
  ),
});

const decodePayload = Schema.decodeUnknownEffect(Schema.fromJsonString(Payload));

const makeHarness = Effect.fnUntraced(function* (
  options: Partial<Profiling.ProfilingOptions> = {},
) {
  const requests: Array<{ readonly url: string; readonly body: string }> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({
        url: request.url,
        body: Predicate.isTagged(request.body, "Uint8Array")
          ? new TextDecoder().decode(request.body.body)
          : "",
      });
      return HttpClientResponse.fromWeb(request, new Response('{"partialSuccess":{}}'));
    }),
  );
  const layer = Profiling.layer({
    url: "http://collector.test/v1/traces",
    serviceName: "trygg-profile-test",
    exportIntervalMs: 60_000,
    ...options,
  }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));
  const spans = Effect.gen(function* () {
    const payloads = yield* Effect.forEach(requests, (request) => decodePayload(request.body));
    return payloads.flatMap((p) =>
      p.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)),
    );
  });
  return { layer, requests, spans };
});

const phase = (name: string) => Effect.withSpan(name, {}, { captureStackTrace: false });

describe("OTLP render profiling", () => {
  scoped(
    "should bound shutdown while the transport is suspended without interrupting the workload",
    () =>
      Effect.gen(function* () {
        // Scope: an unavailable collector must not hold owner shutdown indefinitely.
        // Assertion: the transport is interrupted at the configured deadline and the result survives.
        const entered = yield* Deferred.make<void>();
        const released = yield* Deferred.make<void>();
        const client = HttpClient.make(() =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(released, undefined)),
          ),
        );
        const layer = Profiling.layer({
          url: "http://collector.test/v1/traces",
          serviceName: "test",
          shutdownTimeoutMs: 100,
        }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));
        const fiber = yield* Effect.succeed(42).pipe(
          phase("trygg.keyedList.granular"),
          Effect.provide(layer),
          Effect.forkChild,
        );
        yield* Deferred.await(entered);
        yield* TestClock.adjust(100);
        assert.strictEqual(yield* Fiber.join(fiber), 42);
        assert.isTrue(yield* Deferred.isDone(released));
      }),
  );

  scoped("should preserve combined Causes when the collector rejects the export", () =>
    Effect.gen(function* () {
      // Scope: rejected telemetry is independent of application and cleanup failures.
      // Assertion: both original Reasons survive and only one non-retryable HTTP attempt occurs.
      let requests = 0;
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          requests++;
          return HttpClientResponse.fromWeb(request, new Response("", { status: 400 }));
        }),
      );
      const layer = Profiling.layer({
        url: "http://collector.test/v1/traces",
        serviceName: "test",
      }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));
      const exit = yield* Effect.fail("application").pipe(
        Effect.ensuring(Effect.failCause(Cause.die("cleanup"))),
        phase("trygg.keyedList.granular"),
        Effect.provide(layer),
        Effect.exit,
      );
      if (Exit.isSuccess(exit)) return assert.fail("Expected original failures");
      assert.isTrue(
        exit.cause.reasons.some((r) => Cause.isFailReason(r) && r.error === "application"),
      );
      assert.isTrue(exit.cause.reasons.some((r) => Cause.isDieReason(r) && r.defect === "cleanup"));
      assert.strictEqual(requests, 1);
    }),
  );

  scoped("should not inherit ambient OTEL resource attributes", () =>
    Effect.gen(function* () {
      // Scope: unrelated environment resource configuration can contain sensitive deployment metadata.
      // Assertion: explicit service/session identifiers export, ambient resource data does not.
      const h = yield* makeHarness({ sessionId: "explicit-session" });
      yield* Effect.void.pipe(
        phase("trygg.keyedList.granular"),
        Effect.provide(h.layer),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnvRecord({
            OTEL_RESOURCE_ATTRIBUTES: "secret=ambient-secret",
            OTEL_SERVICE_NAME: "ambient-service",
          }),
        ),
      );
      const body = h.requests.map((r) => r.body).join("");
      assert.include(body, "explicit-session");
      assert.notInclude(body, "ambient");
    }),
  );

  scoped(
    "should export granular phases while preserving row identity and joining the actual worker",
    () =>
      Effect.gen(function* () {
        // Scope: a real keyed row reads a Signal and acquires an Effect-valued property.
        // Assertion: one granular worker exports nested phases and updates the existing DOM node.
        const h = yield* makeHarness({ startPaused: true });
        yield* Effect.gen(function* () {
          const tick = yield* Signal.make(0);
          const items = yield* Signal.make([1]);
          const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          const { container } = yield* render(
            <ul>
              {Signal.each(
                items,
                () =>
                  Effect.gen(function* () {
                    const value = yield* Signal.get(tick);
                    yield* Signal.derive(tick, (n) => n + 1);
                    if (value > 0)
                      yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                    return <li data-value={Effect.succeed(value)}>{value}</li>;
                  }),
                { key: (item) => item },
              )}
            </ul>,
          );
          const row = container.querySelector("li");
          const session = yield* Profiling.Session;
          yield* session.start;
          yield* Signal.set(tick, 1);
          assert.isTrue(Exit.isSuccess(yield* Fiber.await(yield* Deferred.await(entered))));
          yield* session.stop;
          assert.strictEqual(container.querySelector("li"), row);
          assert.strictEqual(row?.getAttribute("data-value"), "1");
        }).pipe(Effect.scoped, Effect.provide(h.layer));
        const spans = yield* h.spans;
        const root = spans.find((s) => s.name === "trygg.keyedList.granular");
        assert.isDefined(root);
        const derivation = spans.find((s) => s.name === "Signal.derive");
        assert.isDefined(derivation);
        assert.strictEqual(derivation?.traceId, root?.traceId);
        assert.strictEqual(
          spans.find((s) => s.spanId === derivation?.parentSpanId)?.name,
          "trygg.keyedList.render",
        );
        assert.strictEqual(root?.parentSpanId, undefined);
        for (const name of ["prepare", "render", "properties", "reconcile", "cleanup"]) {
          const span = spans.find((s) => s.name === `trygg.keyedList.${name}`);
          assert.isDefined(span, name);
          assert.strictEqual(span?.traceId, root?.traceId, name);
          assert.isTrue(
            spans.some((s) => s.spanId === span?.parentSpanId),
            name,
          );
        }
      }),
  );

  scoped("should export parented render spans and flush them when its Layer closes", () =>
    Effect.gen(function* () {
      // Scope: real Effect spans flow through the native OTLP serializer/exporter into an in-memory HttpClient.
      // Assertion: exact endpoint, parent relationship, valid timing, service identity and no exporter self-traces.
      const h = yield* makeHarness();
      yield* Effect.void.pipe(
        phase("trygg.keyedList.prepare"),
        phase("trygg.keyedList.granular"),
        Effect.provide(h.layer),
      );
      assert.strictEqual(h.requests.length, 1);
      assert.strictEqual(h.requests[0]?.url, "http://collector.test/v1/traces");
      const spans = yield* h.spans;
      assert.deepStrictEqual(
        spans.map((s) => s.name),
        ["trygg.keyedList.prepare", "trygg.keyedList.granular"],
      );
      const [child, parent] = spans;
      assert.strictEqual(child?.parentSpanId, parent?.spanId);
      assert.strictEqual(child?.traceId, parent?.traceId);
      assert.isTrue(spans.every((s) => BigInt(s.endTimeUnixNano) >= BigInt(s.startTimeUnixNano)));
      assert.include(h.requests[0]?.body ?? "", "trygg-profile-test");
    }),
  );

  scoped("should drop excess spans without blocking work or resetting its session budget", () =>
    Effect.gen(function* () {
      // Scope: profiling has a finite admission budget even across repeated start/stop windows.
      // Assertion: two of ten root spans export, eight are dropped, and every user operation completes.
      const h = yield* makeHarness({ maxSpans: 2 });
      const snapshot = yield* Effect.gen(function* () {
        const session = yield* Profiling.Session;
        let completed = 0;
        for (let index = 0; index < 10; index++) {
          yield* session.start;
          yield* Effect.sync(() => {
            completed++;
          }).pipe(phase("trygg.keyedList.granular"));
          yield* session.stop;
        }
        assert.strictEqual(completed, 10);
        return yield* session.snapshot;
      }).pipe(Effect.provide(h.layer));
      assert.strictEqual(snapshot.admitted, 2);
      assert.strictEqual(snapshot.recorded, 2);
      assert.strictEqual(snapshot.dropped, 8);
      assert.lengthOf(yield* h.spans, 2);
    }),
  );

  scoped("should omit paused, unsampled and unknown spans without consuming the budget", () =>
    Effect.gen(function* () {
      // Scope: users can omit initialization and unknown application spans from a profiling window.
      // Assertion: only the known span started after admission opens exports.
      const h = yield* makeHarness({ startPaused: true, maxSpans: 1 });
      yield* Effect.gen(function* () {
        const session = yield* Profiling.Session;
        yield* Effect.void.pipe(phase("trygg.keyedList.granular"));
        yield* session.start;
        yield* Effect.void.pipe(Effect.withSpan("trygg.keyedList.granular", { sampled: false }));
        yield* Effect.void.pipe(phase("secret-user-name"));
        yield* Effect.void.pipe(phase("trygg.keyedList.granular"));
        const snapshot = yield* session.snapshot;
        assert.strictEqual(snapshot.admitted, 1);
        assert.strictEqual(snapshot.filtered, 3);
      }).pipe(Effect.provide(h.layer));
      assert.lengthOf(yield* h.spans, 1);
      assert.notInclude(h.requests.map((r) => r.body).join(""), "secret-user-name");
    }),
  );

  for (const outcome of ["failure", "defect", "interrupt"]) {
    scoped(`should preserve the application ${outcome} while projecting exported data`, () =>
      Effect.gen(function* () {
        // Scope: telemetry must not serialize user attributes, event data, links, error values or stacks.
        // Assertion: the original Cause survives, while only its outcome category is exported.
        const h = yield* makeHarness();
        const secret = { message: "secret-error-content" };
        const cause =
          outcome === "failure"
            ? Cause.fail(secret)
            : outcome === "defect"
              ? Cause.die(secret)
              : Cause.interrupt(17);
        const exit = yield* Effect.gen(function* () {
          const span = yield* Effect.currentSpan;
          span.attribute("secret", secret);
          span.event("secret-event", 1n, { value: secret });
          return yield* Effect.failCause(cause);
        }).pipe(phase("trygg.keyedList.granular"), Effect.exit, Effect.provide(h.layer));
        if (Exit.isSuccess(exit)) return assert.fail("Expected the original Cause");
        assert.deepStrictEqual(
          exit.cause.reasons.map((r) => r._tag),
          cause.reasons.map((r) => r._tag),
        );
        for (const reason of exit.cause.reasons) {
          if (Cause.isFailReason(reason)) assert.strictEqual(reason.error, secret);
          if (Cause.isDieReason(reason)) assert.strictEqual(reason.defect, secret);
        }
        assert.notInclude(h.requests.map((r) => r.body).join(""), "secret");
        const spans = yield* h.spans;
        assert.lengthOf(spans, 1);
        assert.strictEqual(spans[0]?.status.code, outcome === "interrupt" ? 1 : 2);
      }),
    );
  }

  scoped("should reject new admissions and late endings after its owner closes", () =>
    Effect.gen(function* () {
      // Scope: callers may retain a tracer, span or session service past the provider's lifetime.
      // Assertion: no late HTTP work, no budget reset, and idempotent span ending.
      const h = yield* makeHarness();
      const retained = yield* Effect.gen(function* () {
        const tracer = yield* Tracer.Tracer;
        const options = {
          name: "trygg.keyedList.granular",
          parent: Option.none(),
          annotations: Context.empty(),
          links: [],
          startTime: 1n,
          kind: "internal",
          root: true,
          sampled: true,
        } satisfies Parameters<Tracer.Tracer["span"]>[0];
        return { session: yield* Profiling.Session, tracer, options, span: tracer.span(options) };
      }).pipe(Effect.provide(h.layer));
      yield* retained.session.start;
      retained.span.end(2n, Exit.void);
      retained.span.end(3n, Exit.void);
      retained.tracer.span(retained.options).end(2n, Exit.void);
      yield* retained.session.flush;
      const snapshot = yield* retained.session.snapshot;
      assert.isTrue(snapshot.closed);
      assert.isFalse(snapshot.active);
      assert.strictEqual(snapshot.recorded, 0);
      assert.lengthOf(h.requests, 0);
      assert.strictEqual(retained.span.status._tag, "Ended");
    }),
  );

  for (const options of [
    { url: "file:///secret" },
    { url: "https://user:secret@collector.test/v1/traces" },
    { url: "https://collector.test/v1/traces?secret=value" },
    { maxSpans: 0 },
    { maxSpans: 1.5 },
    { maxBatchSize: -1 },
    { exportIntervalMs: 0 },
    { shutdownTimeoutMs: Infinity },
  ]) {
    it.effect(
      `should reject invalid profiling options ${Object.keys(options)[0]}=${Object.values(options)[0]}`,
      () =>
        Effect.gen(function* () {
          // Scope: invalid profiling configuration must fail before acquiring any transport resources.
          // Assertion: a typed configuration error with no sensitive value in its message.
          const h = yield* makeHarness(options);
          const exit = yield* Effect.void.pipe(Effect.provide(h.layer), Effect.exit);
          if (Exit.isSuccess(exit)) return assert.fail("Expected invalid options");
          assert.isTrue(
            exit.cause.reasons.some(
              (r) => Cause.isFailReason(r) && r.error instanceof Profiling.ProfilingConfigError,
            ),
          );
          assert.notInclude(Cause.pretty(exit.cause), "secret");
          assert.lengthOf(h.requests, 0);
        }),
    );
  }
});
