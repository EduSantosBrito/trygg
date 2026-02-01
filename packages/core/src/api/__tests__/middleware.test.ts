/**
 * API Middleware Tests
 *
 * Integration tests verifying the full middleware pipeline:
 * detectApiLayer → layer composition → NodeHttpServer.makeHandler → request handling
 *
 * These mirror the exact dev server flow to catch regressions.
 *
 * @module
 */
import { assert, describe, it } from "@effect/vitest";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Deferred, Effect, Layer, Schema, Scope } from "effect";
import { createServer, request as httpRequest } from "node:http";
import { ApiInitError, createApiMiddleware, type ApiMiddleware } from "../middleware.js";

// =============================================================================
// Test fixtures — mirrors apps/examples/app/api.ts structure
// =============================================================================

// Mirrors apps/examples/app/api.ts exactly — same structure, simpler data
const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

class UsersGroup extends HttpApiGroup.make("users")
  .add(HttpApiEndpoint.get("listUsers", "/users").addSuccess(Schema.Array(User)))
  .prefix("/api") {}

class Api extends HttpApi.make("app").add(UsersGroup) {}

const UsersLive = HttpApiBuilder.group(Api, "users", (handlers) =>
  handlers.handle("listUsers", () => Effect.succeed([{ id: "1", name: "Alice" }])),
);

const ApiLive = HttpApiBuilder.api(Api).pipe(Layer.provide(UsersLive));

/**
 * Simulate what Vite's ssrLoadModule returns — a module record
 * with named exports. This is the exact shape detectApiLayer receives.
 */
const fakeApiModule: Record<string, unknown> = {
  User,
  Api,
  UsersLive,
  ApiLive,
};

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Start a real Node HTTP server with given middleware and return its port.
 * Registers finalizer for cleanup on the current scope.
 */
const startTestServer = (mw: ApiMiddleware): Effect.Effect<number, ApiInitError, Scope.Scope> =>
  Effect.gen(function* () {
    const server = createServer((req, res) => {
      mw.middleware(req, res, () => {
        res.statusCode = 404;
        res.end("Not handled by middleware");
      });
    });

    const port = yield* Effect.async<number, ApiInitError>((resume) => {
      server.on("error", (err) =>
        resume(Effect.fail(new ApiInitError({ message: `listen failed: ${err}` }))),
      );
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr !== null && typeof addr === "object") {
          resume(Effect.succeed(addr.port));
        } else {
          resume(Effect.fail(new ApiInitError({ message: "unexpected address type" })));
        }
      });
    });

    yield* Effect.addFinalizer(() =>
      Effect.async<void>((resume) => {
        server.close(() => resume(Effect.void));
      }),
    );

    return port;
  });

/**
 * Make an HTTP GET request and return status + body.
 */
const httpGet = (port: number, path: string): Effect.Effect<{ status: number; body: string }> =>
  Effect.async<{ status: number; body: string }>((resume) => {
    const req = httpRequest(`http://127.0.0.1:${port}${path}`, (res) => {
      const chunks: Array<Buffer> = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resume(
          Effect.succeed({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      });
    });
    req.end();
  });

// =============================================================================
// Error Types - Verify yieldable
// =============================================================================

describe("ApiInitError", () => {
  it.scoped("should be yieldable in Effect.gen", () =>
    Effect.gen(function* () {
      const error = new ApiInitError({ message: "test error" });

      const result = yield* Effect.fail(error).pipe(Effect.flip);

      assert.strictEqual(result._tag, "ApiInitError");
      assert.strictEqual(result.message, "test error");
    }),
  );

  it.scoped("should include optional cause", () =>
    Effect.gen(function* () {
      const cause = new Error("root cause");
      const error = new ApiInitError({ message: "test", cause });

      const result = yield* Effect.fail(error).pipe(Effect.flip);

      assert.strictEqual(result.cause, cause);
    }),
  );

  it.scoped("should allow catching by tag", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(new ApiInitError({ message: "test" })).pipe(
        Effect.catchTag("ApiInitError", (e) => Effect.succeed(`caught: ${e.message}`)),
      );

      const result = yield* effect;

      assert.strictEqual(result, "caught: test");
    }),
  );

  it.scoped("should allow recovering from errors", () =>
    Effect.gen(function* () {
      const recovered = yield* Deferred.make<void>();
      const effect = Effect.fail(new ApiInitError({ message: "failed" })).pipe(
        Effect.catchAll(() => Deferred.succeed(recovered, void 0)),
      );

      yield* effect;

      const isDone = yield* Deferred.isDone(recovered);
      assert.isTrue(isDone);
    }),
  );
});

// =============================================================================
// Integration: Full middleware pipeline
// =============================================================================
// Mirrors the exact flow: createApiMiddleware → detectApiLayer → compose →
// NodeHttpServer.makeHandler → handle request.
// If this test fails with 404, the layer composition is broken.

describe("createApiMiddleware", () => {
  it.scoped("should handle requests to API endpoints with 200", () =>
    Effect.gen(function* () {
      const mw = yield* createApiMiddleware({
        loadApiModule: () => Effect.succeed(fakeApiModule),
        onError: () => Effect.void,
      });

      const port = yield* startTestServer(mw);
      const { status, body } = yield* httpGet(port, "/api/users");

      assert.strictEqual(status, 200);
      const parsed = yield* Schema.decodeUnknown(Schema.parseJson(Schema.Array(User)))(body);
      assert.deepStrictEqual(parsed, [{ id: "1", name: "Alice" }]);
    }),
  );

  it.scoped("should handle requests when module loaded from separate file", () =>
    Effect.gen(function* () {
      const mw = yield* createApiMiddleware({
        loadApiModule: () =>
          Effect.tryPromise({
            try: () => import("./fixture-api.js").then((m): Record<string, unknown> => ({ ...m })),
            catch: (e) => new ApiInitError({ message: `import failed: ${e}` }),
          }),
        onError: () => Effect.void,
      });

      const port = yield* startTestServer(mw);
      const { status, body } = yield* httpGet(port, "/api/users");

      assert.strictEqual(status, 200);
      const parsed = yield* Schema.decodeUnknown(Schema.parseJson(Schema.Array(User)))(body);
      assert.deepStrictEqual(parsed, [{ id: "1", name: "Alice" }]);
    }),
  );

  it.scoped("should return 500 when loadApiModule fails", () =>
    Effect.gen(function* () {
      const mw = yield* createApiMiddleware({
        loadApiModule: () => Effect.fail(new ApiInitError({ message: "module not found" })),
        onError: () => Effect.void,
      });

      const port = yield* startTestServer(mw);
      const { status } = yield* httpGet(port, "/api/users");

      assert.strictEqual(status, 500);
    }),
  );

  it.scoped("should return 500 when module has no API exports", () =>
    Effect.gen(function* () {
      const mw = yield* createApiMiddleware({
        loadApiModule: () => Effect.succeed({ unrelated: "value" }),
        onError: () => Effect.void,
      });

      const port = yield* startTestServer(mw);
      const { status } = yield* httpGet(port, "/api/users");

      assert.strictEqual(status, 500);
    }),
  );
});
