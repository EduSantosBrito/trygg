/**
 * API Middleware Unit Tests
 *
 * Tests for Node.js ↔ Web API conversions and middleware behavior.
 *
 * Test Categories:
 * - nodeToWebRequest: Convert Node IncomingMessage to Web Request
 * - webResponseToNode: Convert Web Response to Node ServerResponse
 * - createApiMiddleware: Middleware factory behavior
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { nodeToWebRequest, webResponseToNode } from "../src/api-middleware.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockIncomingMessage(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const { method = "GET", url = "/", headers = {}, body } = options;

  const socket = new Socket();
  const req = new IncomingMessage(socket);

  req.method = method;
  req.url = url;
  req.headers = headers;

  if (body) {
    // Push body data
    req.push(body);
    req.push(null);
  }

  return req;
}

interface MockServerResponse extends ServerResponse {
  _statusCode: number;
  _headers: Map<string, string>;
  _body: Buffer[];
  _ended: boolean;
}

function createMockServerResponse(): MockServerResponse {
  const res = new ServerResponse({} as IncomingMessage) as MockServerResponse;

  res._statusCode = 200;
  res._headers = new Map();
  res._body = [];
  res._ended = false;

  // Override methods to capture output - use res directly to avoid 'this' typing issues
  res.writeHead = ((statusCode: number) => {
    res._statusCode = statusCode;
    return res;
  }) as typeof res.writeHead;

  res.setHeader = ((name: string, value: string | number | readonly string[]) => {
    res._headers.set(name, String(value));
    return res;
  }) as typeof res.setHeader;

  res.write = ((chunk: Buffer | string) => {
    res._body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }) as typeof res.write;

  res.end = ((chunk?: Buffer | string) => {
    if (chunk) {
      res._body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    res._ended = true;
  }) as typeof res.end;

  Object.defineProperty(res, "statusCode", {
    get: () => res._statusCode,
    set: (value: number) => {
      res._statusCode = value;
    },
  });

  return res;
}

// =============================================================================
// nodeToWebRequest Tests
// =============================================================================

describe("nodeToWebRequest", () => {
  it("should convert GET request with URL", () => {
    const req = createMockIncomingMessage({
      method: "GET",
      url: "/api/users?page=1",
    });

    const webReq = nodeToWebRequest(req, "http://localhost:5173");

    assert.strictEqual(webReq.method, "GET");
    assert.strictEqual(webReq.url, "http://localhost:5173/api/users?page=1");
    assert.isNull(webReq.body);
  });

  it("should convert headers correctly", () => {
    const req = createMockIncomingMessage({
      method: "GET",
      url: "/api/users",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-custom-header": "custom-value",
      },
    });

    const webReq = nodeToWebRequest(req, "http://localhost:5173");

    assert.strictEqual(webReq.headers.get("content-type"), "application/json");
    assert.strictEqual(webReq.headers.get("accept"), "application/json");
    assert.strictEqual(webReq.headers.get("x-custom-header"), "custom-value");
  });

  it("should handle POST request with body", () => {
    const req = createMockIncomingMessage({
      method: "POST",
      url: "/api/users",
      headers: { "content-type": "application/json" },
      body: '{"name":"test"}',
    });

    const webReq = nodeToWebRequest(req, "http://localhost:5173");

    assert.strictEqual(webReq.method, "POST");
    assert.isNotNull(webReq.body);
  });

  it("should handle missing URL", () => {
    const req = createMockIncomingMessage({
      method: "GET",
    });
    req.url = undefined;

    const webReq = nodeToWebRequest(req, "http://localhost:5173");

    assert.strictEqual(webReq.url, "http://localhost:5173/");
  });

  it("should handle array header values", () => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = "GET";
    req.url = "/api/users";
    req.headers = {
      "set-cookie": ["cookie1=value1", "cookie2=value2"],
    } as unknown as Record<string, string>;

    const webReq = nodeToWebRequest(req, "http://localhost:5173");

    // Array headers should be joined with comma
    assert.strictEqual(webReq.headers.get("set-cookie"), "cookie1=value1, cookie2=value2");
  });
});

// =============================================================================
// webResponseToNode Tests
// =============================================================================

describe("webResponseToNode", () => {
  it.scoped("should set status code", () =>
    Effect.gen(function* () {
      const webRes = new Response(null, { status: 201 });
      const nodeRes = createMockServerResponse();

      yield* Effect.promise(() => webResponseToNode(webRes, nodeRes));

      assert.strictEqual(nodeRes._statusCode, 201);
      assert.isTrue(nodeRes._ended);
    }),
  );

  it.scoped("should set headers", () =>
    Effect.gen(function* () {
      const webRes = new Response(null, {
        headers: {
          "content-type": "application/json",
          "x-custom": "value",
        },
      });
      const nodeRes = createMockServerResponse();

      yield* Effect.promise(() => webResponseToNode(webRes, nodeRes));

      assert.strictEqual(nodeRes._headers.get("content-type"), "application/json");
      assert.strictEqual(nodeRes._headers.get("x-custom"), "value");
    }),
  );

  it.scoped("should stream body", () =>
    Effect.gen(function* () {
      const MessageSchema = Schema.Struct({ message: Schema.String });
      const body = yield* Schema.encode(Schema.parseJson(MessageSchema))({ message: "hello" });
      const webRes = new Response(body, {
        headers: { "content-type": "application/json" },
      });
      const nodeRes = createMockServerResponse();

      yield* Effect.promise(() => webResponseToNode(webRes, nodeRes));

      const responseBody = Buffer.concat(nodeRes._body).toString();
      assert.strictEqual(responseBody, body);
    }),
  );

  it.scoped("should handle empty body", () =>
    Effect.gen(function* () {
      const webRes = new Response(null, { status: 204 });
      const nodeRes = createMockServerResponse();

      yield* Effect.promise(() => webResponseToNode(webRes, nodeRes));

      assert.strictEqual(nodeRes._statusCode, 204);
      assert.strictEqual(nodeRes._body.length, 0);
      assert.isTrue(nodeRes._ended);
    }),
  );

  it.scoped("should handle large streaming body", () =>
    Effect.gen(function* () {
      // Create a large body
      const largeData = "x".repeat(10000);
      const webRes = new Response(largeData);
      const nodeRes = createMockServerResponse();

      yield* Effect.promise(() => webResponseToNode(webRes, nodeRes));

      const responseBody = Buffer.concat(nodeRes._body).toString();
      assert.strictEqual(responseBody.length, 10000);
    }),
  );
});
