/**
 * @since 1.0.0
 * Test Server - Debug plugin with HTTP API for LLM observability
 *
 * Captures debug events to SQLite and exposes an HTTP server for querying.
 * LLMs can query logs in real-time while the application runs.
 *
 * ## Quick Start
 *
 * Use `Debug.serverLayer()` to start the server with debug plugin integration:
 *
 * ```typescript
 * import { Effect } from "effect"
 * import * as Debug from "effect-ui/debug"
 * import { TestServer } from "effect-ui"
 *
 * const program = Effect.gen(function* () {
 *   const server = yield* TestServer
 *   console.log(`Server at ${server.url}`)
 *
 *   // Debug.log calls are captured by TestServer
 *   Debug.enable()
 *   yield* Debug.log({ event: "signal.set", signal_id: "sig_1", prev_value: 0, value: 1, listener_count: 1 })
 *
 *   // Server available at http://localhost:4567
 *   // GET /        → llms.txt (API documentation)
 *   // GET /logs    → Query logs
 *   // GET /stats   → Event counts by level
 * })
 *
 * // Run with scope for automatic cleanup
 * Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(Debug.serverLayer({ port: 4567 })))))
 * ```
 */
import { Schema, Effect, Context, Scope } from "effect"
import type { DebugEvent, EventType } from "./debug.js"

// ============================================================================
// Configuration
// ============================================================================

/**
 * Test server configuration
 * @since 1.0.0
 */
export interface TestServerConfig {
  /** HTTP server port (default: 4567) */
  readonly port?: number
  /** SQLite database path (default: ".effect/debug-events.db") */
  readonly dbPath?: string
  /** Write connection info to this file (default: ".effect/llm-test-server.json") */
  readonly connectionInfoPath?: string
  /** Keep server running after scope closes, until /shutdown is called (default: false) */
  readonly keepAlive?: boolean
}

/**
 * Default configuration
 */
const defaultConfig: Required<TestServerConfig> = {
  port: 4567,
  dbPath: ".effect/debug-events.db",
  connectionInfoPath: ".effect/llm-test-server.json",
  keepAlive: false
}

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Log level for filtering events
 * @since 1.0.0
 */
export type LogLevel = "debug" | "info" | "warn" | "error"

/**
 * Stored log event
 * @since 1.0.0
 */
export interface StoredLogEvent {
  readonly id: number
  readonly timestamp: string
  readonly level: LogLevel
  readonly eventType: string
  readonly traceId: string | null
  readonly spanId: string | null
  readonly parentSpanId: string | null
  readonly durationMs: number | null
  readonly payload: string
}

/**
 * Query options for filtering logs
 * @since 1.0.0
 */
export const QueryOptionsSchema = Schema.Struct({
  level: Schema.optional(Schema.Literal("debug", "info", "warn", "error")),
  eventType: Schema.optional(Schema.String),
  traceId: Schema.optional(Schema.String),
  after: Schema.optional(Schema.String),
  before: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number)
})

export type QueryOptions = typeof QueryOptionsSchema.Type

// ============================================================================
// Level Derivation
// ============================================================================

const deriveLevel = (eventType: EventType): LogLevel => {
  if (eventType.includes("error") || eventType.includes("fail")) return "error"
  if (eventType.includes("skip") || eventType.includes("timeout")) return "warn"
  if (
    eventType.startsWith("router.navigate") ||
    eventType.startsWith("trace.span") ||
    eventType.includes("complete") ||
    eventType.includes("create")
  ) return "info"
  return "debug"
}

// ============================================================================
// SQL Schema
// ============================================================================

const SQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  duration_ms REAL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_level ON events(level);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
`

// ============================================================================
// TestServer Service
// ============================================================================

/**
 * TestServer service interface
 * @since 1.0.0
 */
export interface TestServerService {
  /** Store a debug event */
  readonly store: (event: DebugEvent) => Effect.Effect<void>
  /** Query events */
  readonly query: (options: QueryOptions) => Effect.Effect<ReadonlyArray<StoredLogEvent>>
  /** Get counts by level */
  readonly stats: () => Effect.Effect<Record<LogLevel, number>>
  /** Server port */
  readonly port: number
  /** Server URL */
  readonly url: string
}

/**
 * TestServer service tag
 * @since 1.0.0
 */
export class TestServer extends Context.Tag("effect-ui/TestServer")<
  TestServer,
  TestServerService
>() {}

// ============================================================================
// llms.txt Content
// ============================================================================

const llmsTxt = (port: number): string => `# effect-ui Test Server API

## Overview
Real-time debug event query API for LLM observability.
Server running at http://127.0.0.1:${port}

## Endpoints

### GET /
Returns this documentation.

### GET /logs
Query stored debug events.

**Query Parameters:**
- level: "debug" | "info" | "warn" | "error"
- eventType: string (prefix match, e.g., "router" matches "router.navigate")
- traceId: string (exact match)
- after: ISO timestamp
- before: ISO timestamp
- limit: number (default: 1000)

**Example:**
\`\`\`
GET /logs?level=error&limit=10
\`\`\`

**Response:**
\`\`\`json
{
  "events": [
    {
      "id": 1,
      "timestamp": "2026-01-20T10:00:00Z",
      "level": "error",
      "eventType": "router.error",
      "traceId": "trace_42",
      "payload": "{...}"
    }
  ],
  "count": 1
}
\`\`\`

### GET /stats
Get event counts by level.

**Response:**
\`\`\`json
{
  "debug": 100,
  "info": 50,
  "warn": 10,
  "error": 2
}
\`\`\`

### GET /health
Health check endpoint.

**Response:**
\`\`\`json
{
  "status": "ok",
  "port": ${port},
  "keepAlive": true
}
\`\`\`

### POST /shutdown
Stop the server. Call this when done querying.

**Response:**
\`\`\`json
{
  "status": "shutdown"
}
\`\`\`

## Event Types
- signal.* - Signal operations
- router.* - Navigation, matching, guards
- render.* - Component lifecycle
- trace.* - Span tracking

## Usage from LLM
1. Check /health to verify server is running
2. Query /logs?level=error to find errors
3. Use traceId to correlate related events
4. Call POST /shutdown when done
`

// ============================================================================
// Internal API (used by Debug.serverLayer)
// ============================================================================

/**
 * Internal: Start the test server without registering the debug plugin.
 * Plugin registration is handled by Debug.serverLayer.
 * @internal
 */
export const startInternal = (
  config: TestServerConfig = {}
): Effect.Effect<TestServerService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const cfg: Required<TestServerConfig> = { ...defaultConfig, ...config }

    // Dynamic import for Bun-specific module
    const { Database } = yield* Effect.promise(() => import("bun:sqlite"))

    // Create SQLite database
    const db = new Database(cfg.dbPath, { create: true })
    db.run(SQL_SCHEMA)

    // Create service implementation
    const server: TestServerService = {
      port: cfg.port,
      url: `http://127.0.0.1:${cfg.port}`,

      store: (event: DebugEvent) =>
        Effect.sync(() => {
          db.run(
            `INSERT INTO events (timestamp, level, event_type, trace_id, span_id, parent_span_id, duration_ms, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              event.timestamp,
              deriveLevel(event.event),
              event.event,
              event.traceId ?? null,
              event.spanId ?? null,
              event.parentSpanId ?? null,
              event.duration_ms ?? null,
              JSON.stringify(event)
            ]
          )
        }),

      query: (options: QueryOptions) =>
        Effect.sync(() => {
          const conditions: string[] = []
          const params: Array<string | number | null> = []

          if (options.level !== undefined) {
            conditions.push("level = ?")
            params.push(options.level)
          }
          if (options.eventType !== undefined) {
            conditions.push("(event_type = ? OR event_type LIKE ?)")
            params.push(options.eventType, options.eventType + ".%")
          }
          if (options.traceId !== undefined) {
            conditions.push("trace_id = ?")
            params.push(options.traceId)
          }
          if (options.after !== undefined) {
            conditions.push("timestamp > ?")
            params.push(options.after)
          }
          if (options.before !== undefined) {
            conditions.push("timestamp < ?")
            params.push(options.before)
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
          const limit = options.limit ?? 1000

          const rows = db.query(
            `SELECT id, timestamp, level, event_type, trace_id, span_id, parent_span_id, duration_ms, payload
             FROM events ${where} ORDER BY timestamp DESC LIMIT ?`
          ).all(...params, limit) as Array<{
            id: number
            timestamp: string
            level: string
            event_type: string
            trace_id: string | null
            span_id: string | null
            parent_span_id: string | null
            duration_ms: number | null
            payload: string
          }>

          return rows.map((row): StoredLogEvent => ({
            id: row.id,
            timestamp: row.timestamp,
            level: row.level as LogLevel,
            eventType: row.event_type,
            traceId: row.trace_id,
            spanId: row.span_id,
            parentSpanId: row.parent_span_id,
            durationMs: row.duration_ms,
            payload: row.payload
          }))
        }),

      stats: () =>
        Effect.sync(() => {
          const rows = db.query(
            `SELECT level, COUNT(*) as count FROM events GROUP BY level`
          ).all() as Array<{ level: string; count: number }>

          const result: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 }
          for (const row of rows) {
            if (row.level in result) {
              result[row.level as LogLevel] = row.count
            }
          }
          return result
        })
    }

    // Shutdown state
    let shutdownCalled = false
    const shutdown = () => {
      if (shutdownCalled) return
      shutdownCalled = true
      httpServer.stop()
      db.close()
      // eslint-disable-next-line no-console
      console.log(`[effect-ui] TestServer stopped`)
    }

    // Start HTTP server using Bun.serve
    const httpServer = Bun.serve({
      port: cfg.port,
      fetch(req) {
        const url = new URL(req.url)
        const path = url.pathname

        // GET / - Documentation
        if (path === "/" || path === "") {
          return new Response(llmsTxt(cfg.port), {
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          })
        }

        // GET /health
        if (path === "/health") {
          return Response.json({ status: "ok", port: cfg.port, keepAlive: cfg.keepAlive })
        }

        // GET /logs
        if (path === "/logs") {
          const options: QueryOptions = {
            level: url.searchParams.get("level") as LogLevel | undefined,
            eventType: url.searchParams.get("eventType") ?? undefined,
            traceId: url.searchParams.get("traceId") ?? undefined,
            after: url.searchParams.get("after") ?? undefined,
            before: url.searchParams.get("before") ?? undefined,
            limit: url.searchParams.has("limit")
              ? parseInt(url.searchParams.get("limit")!, 10)
              : undefined
          }

          const result = Effect.runSync(server.query(options))
          return Response.json({ events: result, count: result.length })
        }

        // GET /stats
        if (path === "/stats") {
          const result = Effect.runSync(server.stats())
          return Response.json(result)
        }

        // POST /shutdown - Stop the server (for LLM to call when done)
        if (path === "/shutdown" && req.method === "POST") {
          shutdown()
          return Response.json({ status: "shutdown" })
        }

        return new Response("Not Found", { status: 404 })
      }
    })

    // Write connection info
    yield* Effect.tryPromise(async () => {
      const fs = await import("node:fs/promises")
      const path = await import("node:path")

      const dir = path.dirname(cfg.connectionInfoPath)
      await fs.mkdir(dir, { recursive: true })

      await fs.writeFile(
        cfg.connectionInfoPath,
        JSON.stringify(
          {
            type: "http",
            url: server.url,
            port: server.port,
            keepAlive: cfg.keepAlive,
            endpoints: {
              docs: "/",
              logs: "/logs",
              stats: "/stats",
              health: "/health",
              shutdown: "/shutdown"
            }
          },
          null,
          2
        )
      )
    }).pipe(Effect.catchAll(() => Effect.void))

    // eslint-disable-next-line no-console
    console.log(`[effect-ui] TestServer running at ${server.url}`)
    if (cfg.keepAlive) {
      // eslint-disable-next-line no-console
      console.log(`[effect-ui] Server will stay alive until POST /shutdown is called`)
    }

    // Register finalizer for cleanup (skipped if keepAlive)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (!cfg.keepAlive) {
          shutdown()
        }
      })
    )

    return server
  })


