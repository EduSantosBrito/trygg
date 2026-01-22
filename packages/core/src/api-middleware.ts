/**
 * API Middleware for Vite Dev Server
 *
 * Converts Node.js HTTP to Web APIs and routes to Effect HttpApi handlers.
 * Supports streaming request/response bodies for SSR and partial rendering.
 *
 * @since 1.0.0
 */
import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { Layer } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Connect } from "vite";

// =============================================================================
// Node → Web Request Conversion
// =============================================================================

/**
 * Convert Node.js IncomingMessage to Web API Request.
 * Supports streaming request bodies for large payloads.
 *
 * @since 1.0.0
 */
export function nodeToWebRequest(req: IncomingMessage, baseUrl: string): Request {
  const url = new URL(req.url ?? "/", baseUrl);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  // Stream body for non-GET/HEAD requests
  const method = req.method ?? "GET";
  const hasBody = !["GET", "HEAD"].includes(method);

  let body: ReadableStream<Uint8Array> | undefined;
  if (hasBody) {
    // Convert Node Readable stream to Web ReadableStream
    body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
  }

  return new Request(url, {
    method,
    headers,
    body,
    // @ts-expect-error - duplex required for streaming request body in Node
    duplex: hasBody ? "half" : undefined,
  });
}

// =============================================================================
// Web Response → Node Conversion
// =============================================================================

/**
 * Stream Web API Response to Node.js ServerResponse.
 * Preserves streaming for efficient large response handling.
 *
 * @since 1.0.0
 */
export async function webResponseToNode(webRes: Response, nodeRes: ServerResponse): Promise<void> {
  nodeRes.statusCode = webRes.status;
  nodeRes.statusMessage = webRes.statusText;

  webRes.headers.forEach((value, key) => {
    // Skip pseudo-headers that can't be set
    if (!key.startsWith(":")) {
      nodeRes.setHeader(key, value);
    }
  });

  if (webRes.body) {
    const reader = webRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeRes.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  nodeRes.end();
}

// =============================================================================
// API Middleware Factory
// =============================================================================

/**
 * Options for creating API middleware
 * @since 1.0.0
 */
export interface ApiMiddlewareOptions {
  /** Load the API module (called on init and reload) */
  readonly loadApiModule: () => Promise<{ ApiLive: Layer.Layer<unknown, unknown, unknown> }>;
  /** Called when handler errors occur */
  readonly onError: (error: unknown) => void;
  /** Base URL for request construction (default: http://localhost:5173) */
  readonly baseUrl?: string;
}

/**
 * API Middleware interface
 * @since 1.0.0
 */
export interface ApiMiddleware {
  /** Connect middleware function */
  readonly middleware: Connect.NextHandleFunction;
  /** Reload handlers (call after api.ts changes) */
  readonly reload: () => Promise<void>;
  /** Cleanup resources */
  readonly dispose: () => Promise<void>;
}

/**
 * Create API middleware for Vite dev server.
 *
 * Intercepts `/api/*` requests and routes them to Effect HttpApi handlers.
 * Supports hot reloading when api.ts changes.
 *
 * @since 1.0.0
 */
export async function createApiMiddleware(options: ApiMiddlewareOptions): Promise<ApiMiddleware> {
  const { loadApiModule, onError, baseUrl = "http://localhost:5173" } = options;

  let handler: ((req: Request) => Promise<Response>) | null = null;
  let disposeHandler: (() => Promise<void>) | null = null;
  let lastError: unknown = null;

  const initHandler = async (): Promise<void> => {
    try {
      const apiModule = await loadApiModule();

      // Provide HttpServer.layerContext to ApiLive since it needs DefaultServices
      // Cast to never since we can't know the exact Layer type at compile time
      const apiLayer = Layer.provide(apiModule.ApiLive, HttpServer.layerContext) as never;

      const result = HttpApiBuilder.toWebHandler(apiLayer);

      handler = result.handler;
      disposeHandler = result.dispose;
      lastError = null;
    } catch (error) {
      handler = null;
      disposeHandler = null;
      lastError = error;
      onError(error);
    }
  };

  // Initialize on creation
  await initHandler();

  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    // Only handle /api/* requests
    if (!req.url?.startsWith("/api/")) {
      return next();
    }

    // Handler not loaded (error during init)
    if (!handler) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "API handler not available",
          message: lastError instanceof Error ? lastError.message : "Check console for errors",
        }),
      );
      return;
    }

    try {
      const webRequest = nodeToWebRequest(req, baseUrl);
      const webResponse = await handler(webRequest);
      await webResponseToNode(webResponse, res);
    } catch (error) {
      onError(error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  };

  return {
    middleware,
    reload: async () => {
      await disposeHandler?.();
      await initHandler();
    },
    dispose: async () => {
      await disposeHandler?.();
      handler = null;
      disposeHandler = null;
    },
  };
}
