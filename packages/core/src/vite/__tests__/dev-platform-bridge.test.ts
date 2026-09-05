// @vitest-environment node
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option, Predicate, Schema } from "effect";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiRequestError, MAX_REQUEST_BODY_BYTES } from "../dev-platform.js";
import { fromNodeRequest, getBody, toNodeResponse } from "../dev-platform-bun.js";

const IncomingMessageSchema = Schema.declare((value: unknown): value is IncomingMessage =>
  Predicate.isObject(value),
);
const ServerResponseSchema = Schema.declare((value: unknown): value is ServerResponse =>
  Predicate.isObject(value),
);
const decodeIncomingMessage = Schema.decodeUnknownSync(IncomingMessageSchema);
const decodeServerResponse = Schema.decodeUnknownSync(ServerResponseSchema);

interface IncomingHarness {
  readonly emitter: EventEmitter;
  readonly request: IncomingMessage;
  readonly resumeCount: () => number;
}

const makeIncoming = (method = "POST"): IncomingHarness => {
  const emitter = new EventEmitter();
  let resumed = 0;
  Object.assign(emitter, {
    complete: false,
    headers: { host: "localhost" },
    method,
    pause: () => emitter,
    resume: () => {
      resumed += 1;
      return emitter;
    },
    url: "/api/upload",
  });
  return {
    emitter,
    request: decodeIncomingMessage(emitter),
    resumeCount: () => resumed,
  };
};

interface ResponseHarness {
  readonly emitter: EventEmitter;
  readonly headers: ReadonlyMap<string, string | number | ReadonlyArray<string>>;
  readonly response: ServerResponse;
}

const makeResponse = (): ResponseHarness => {
  const emitter = new EventEmitter();
  const headers = new Map<string, string | number | ReadonlyArray<string>>();
  Object.assign(emitter, {
    headersSent: false,
    statusCode: 200,
    writableEnded: false,
    end() {
      Reflect.set(emitter, "writableEnded", true);
      return emitter;
    },
    setHeader(name: string, value: string | number | ReadonlyArray<string>) {
      headers.set(name.toLowerCase(), value);
      return emitter;
    },
    write(_value: Uint8Array, callback: (error?: Error | null) => void) {
      callback();
      return true;
    },
  });
  return {
    emitter,
    headers,
    response: decodeServerResponse(emitter),
  };
};

const assertNoBodyListeners = (emitter: EventEmitter): void => {
  for (const event of ["data", "end", "error", "aborted", "close"]) {
    assert.strictEqual(emitter.listenerCount(event), 0, `${event} listener leaked`);
  }
};

describe("development HTTP bridge", () => {
  it.effect("should accept a request body exactly at the configured limit", () =>
    Effect.gen(function* () {
      // Scope: covers the inclusive request-capacity boundary for chunked bodies.
      // Assertion: exactly MAX bytes succeed and every native listener is removed.
      const incoming = makeIncoming();
      const reading = yield* getBody(incoming.request).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      incoming.emitter.emit("data", Buffer.alloc(MAX_REQUEST_BODY_BYTES));
      incoming.emitter.emit("end");
      const body = yield* Fiber.join(reading);

      assert.isTrue(Option.isSome(body));
      if (Option.isSome(body)) assert.strictEqual(body.value.byteLength, MAX_REQUEST_BODY_BYTES);
      assert.strictEqual(incoming.resumeCount(), 0);
      assertNoBodyListeners(incoming.emitter);
    }),
  );

  it.effect("should reject and drain a chunked request above the configured limit", () =>
    Effect.gen(function* () {
      // Scope: covers incremental overload handling without trusting Content-Length.
      // Assertion: MAX+1 fails as BodyTooLarge, resumes draining, and removes listeners.
      const incoming = makeIncoming();
      const reading = yield* getBody(incoming.request).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      incoming.emitter.emit("data", Buffer.alloc(MAX_REQUEST_BODY_BYTES));
      incoming.emitter.emit("data", Buffer.alloc(1));
      const exit = yield* Fiber.await(reading);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, ApiRequestError);
        if (error instanceof ApiRequestError) assert.strictEqual(error.reason, "BodyTooLarge");
      }
      assert.strictEqual(incoming.resumeCount(), 1);
      assertNoBodyListeners(incoming.emitter);
    }),
  );

  it.effect("should abort a pending body read through the Request signal", () =>
    Effect.gen(function* () {
      // Scope: covers shutdown/response-close cancellation before IncomingMessage end.
      // Assertion: abort fails as Aborted and detaches every request listener.
      const incoming = makeIncoming();
      const controller = new AbortController();
      const reading = yield* getBody(incoming.request, controller.signal).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      controller.abort();
      const exit = yield* Fiber.await(reading);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, ApiRequestError);
        if (error instanceof ApiRequestError) assert.strictEqual(error.reason, "Aborted");
      }
      assertNoBodyListeners(incoming.emitter);
    }),
  );

  it.effect("should propagate an AbortSignal into the web Request", () =>
    Effect.gen(function* () {
      // Scope: covers the Node IncomingMessage to web Request cancellation boundary.
      // Assertion: aborting the bridge controller is observable on Request.signal.
      const incoming = makeIncoming("GET");
      const controller = new AbortController();
      const request = yield* fromNodeRequest(incoming.request, controller.signal);

      controller.abort();

      assert.isTrue(request.signal.aborted);
    }),
  );

  it.effect("should cancel and release a response reader when the client disconnects", () =>
    Effect.gen(function* () {
      // Scope: covers disconnect while a web response stream is blocked in reader.read().
      // Assertion: the bridge fails as Aborted, cancels once, releases the lock, and removes listeners.
      let cancelCount = 0;
      const stream = new ReadableStream<Uint8Array>({
        cancel() {
          cancelCount += 1;
        },
      });
      const response = new Response(stream);
      const outgoing = makeResponse();
      const writing = yield* toNodeResponse(response, outgoing.response).pipe(Effect.forkChild);
      while (outgoing.emitter.listenerCount("close") === 0) {
        yield* Effect.yieldNow;
      }

      outgoing.emitter.emit("close");
      const exit = yield* Fiber.await(writing);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, ApiRequestError);
        if (error instanceof ApiRequestError) assert.strictEqual(error.reason, "Aborted");
      }
      assert.strictEqual(cancelCount, 1);
      assert.strictEqual(outgoing.emitter.listenerCount("close"), 0);
      const reader = response.body?.getReader();
      assert.isDefined(reader);
      reader?.releaseLock();
    }),
  );

  it.effect("should preserve repeated Set-Cookie fields as distinct Node header values", () =>
    Effect.gen(function* () {
      // Scope: covers non-combinable response headers, including an Expires comma.
      // Assertion: Node receives the two original cookie lines as an array.
      const headers = new Headers();
      headers.append("set-cookie", "session=one; Path=/; HttpOnly");
      headers.append("set-cookie", "refresh=two; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/api");
      const outgoing = makeResponse();

      yield* toNodeResponse(new Response(null, { headers }), outgoing.response);

      assert.deepStrictEqual(outgoing.headers.get("set-cookie"), [
        "session=one; Path=/; HttpOnly",
        "refresh=two; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/api",
      ]);
    }),
  );
});
