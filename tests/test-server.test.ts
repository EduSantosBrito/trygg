/**
 * Tests for TestServer via Debug.serverLayer
 * 
 * These tests require Bun runtime and are skipped in vitest/happy-dom.
 * Run with: bun test tests/test-server.test.ts
 */
import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import * as Debug from "../src/debug.js"
import { TestServer } from "../src/test-server.js"

describe("TestServer via Debug.serverLayer", () => {
  it("starts and stops server", async () => {
    let wasRunning = false

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer
          wasRunning = true
          expect(server.port).toBe(14567)
          expect(server.url).toBe("http://127.0.0.1:14567")
        }).pipe(Effect.provide(Debug.serverLayer({ port: 14567, dbPath: ":memory:" })))
      )
    )

    // Server should have been running inside the scope
    expect(wasRunning).toBe(true)
  })

  it("stores and queries events", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer

          // Store events
          yield* server.store({
            event: "signal.set",
            timestamp: new Date().toISOString(),
            signal_id: "sig_1",
            prev_value: 0,
            value: 1,
            listener_count: 1
          })

          yield* server.store({
            event: "router.error",
            timestamp: new Date().toISOString(),
            route_pattern: "/test",
            error: "Test error"
          })

          // Query all
          const all = yield* server.query({})
          expect(all.length).toBe(2)

          // Query by level
          const errors = yield* server.query({ level: "error" })
          expect(errors.length).toBe(1)
          expect(errors[0]?.eventType).toBe("router.error")
        }).pipe(Effect.provide(Debug.serverLayer({ port: 14568, dbPath: ":memory:" })))
      )
    )
  })

  it("serves llms.txt at root", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer

          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/`)
          )
          const text = yield* Effect.promise(() => response.text())

          expect(text).toContain("# effect-ui Test Server API")
          expect(text).toContain("GET /logs")
          expect(text).toContain("GET /stats")
        }).pipe(Effect.provide(Debug.serverLayer({ port: 14569, dbPath: ":memory:" })))
      )
    )
  })

  it("returns health check", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer

          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/health`)
          )
          const data = yield* Effect.promise(() =>
            response.json() as Promise<{ status: string; port: number }>
          )

          expect(data.status).toBe("ok")
          expect(data.port).toBe(14570)
        }).pipe(Effect.provide(Debug.serverLayer({ port: 14570, dbPath: ":memory:" })))
      )
    )
  })

  it("queries via HTTP endpoint", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer

          // Store an error event
          yield* server.store({
            event: "router.error",
            timestamp: new Date().toISOString(),
            route_pattern: "/test",
            error: "Test error"
          })

          // Query via HTTP
          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/logs?level=error`)
          )
          const data = yield* Effect.promise(() =>
            response.json() as Promise<{ events: Array<{ level: string }>; count: number }>
          )

          expect(data.count).toBe(1)
          expect(data.events[0]?.level).toBe("error")
        }).pipe(Effect.provide(Debug.serverLayer({ port: 14571, dbPath: ":memory:" })))
      )
    )
  })

  it("returns stats", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer

          // Store some events
          yield* server.store({
            event: "signal.set",
            timestamp: new Date().toISOString(),
            signal_id: "sig_1",
            prev_value: 0,
            value: 1,
            listener_count: 1
          })

          yield* server.store({
            event: "router.error",
            timestamp: new Date().toISOString(),
            route_pattern: "/test",
            error: "Test error"
          })

          // Get stats
          const stats = yield* server.stats()
          expect(stats.debug).toBe(1)
          expect(stats.error).toBe(1)

          // Also via HTTP
          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/stats`)
          )
          const httpStats = yield* Effect.promise(() =>
            response.json() as Promise<Record<string, number>>
          )
          expect(httpStats.debug).toBe(1)
          expect(httpStats.error).toBe(1)
        }).pipe(Effect.provide(Debug.serverLayer({ port: 14572, dbPath: ":memory:" })))
      )
    )
  })

  it("writes connection info file", async () => {
    const infoPath = ".effect/test-server-test.json"

    // Cleanup first
    try {
      const fs = await import("node:fs/promises")
      await fs.unlink(infoPath)
    } catch {
      // Ignore
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer

          const content = yield* Effect.tryPromise(async () => {
            const fs = await import("node:fs/promises")
            return fs.readFile(infoPath, "utf-8")
          })
          const info = JSON.parse(content) as { type: string; port: number; url: string }

          expect(info.type).toBe("http")
          expect(info.port).toBe(14573)
          expect(info.url).toBe(server.url)
        }).pipe(Effect.provide(Debug.serverLayer({ 
          port: 14573, 
          dbPath: ":memory:",
          connectionInfoPath: infoPath 
        })))
      )
    )

    // Cleanup
    try {
      const fs = await import("node:fs/promises")
      await fs.unlink(infoPath)
    } catch {
      // Ignore
    }
  })

  it("queries by event type prefix", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer

          yield* server.store({
            event: "router.navigate",
            timestamp: new Date().toISOString(),
            from_path: "/",
            to_path: "/users"
          })

          yield* server.store({
            event: "router.error",
            timestamp: new Date().toISOString(),
            route_pattern: "/admin",
            error: "Unauthorized"
          })

          yield* server.store({
            event: "signal.set",
            timestamp: new Date().toISOString(),
            signal_id: "sig_1",
            prev_value: 0,
            value: 1,
            listener_count: 1
          })

          // Query router events
          const routerEvents = yield* server.query({ eventType: "router" })
          expect(routerEvents.length).toBe(2)

          // Query signal events
          const signalEvents = yield* server.query({ eventType: "signal" })
          expect(signalEvents.length).toBe(1)
        }).pipe(Effect.provide(Debug.serverLayer({ port: 14574, dbPath: ":memory:" })))
      )
    )
  })

  it("queries by trace ID", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer

          yield* server.store({
            event: "router.navigate",
            timestamp: new Date().toISOString(),
            traceId: "trace_42",
            from_path: "/",
            to_path: "/users"
          })

          yield* server.store({
            event: "signal.set",
            timestamp: new Date().toISOString(),
            traceId: "trace_42",
            signal_id: "sig_1",
            prev_value: 0,
            value: 1,
            listener_count: 1
          })

          yield* server.store({
            event: "router.navigate",
            timestamp: new Date().toISOString(),
            traceId: "trace_99",
            from_path: "/users",
            to_path: "/admin"
          })

          const trace42 = yield* server.query({ traceId: "trace_42" })
          expect(trace42.length).toBe(2)

          const trace99 = yield* server.query({ traceId: "trace_99" })
          expect(trace99.length).toBe(1)
        }).pipe(Effect.provide(Debug.serverLayer({ port: 14575, dbPath: ":memory:" })))
      )
    )
  })

  it("captures Debug.log events when serverLayer is provided", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* TestServer

          // Enable debug and emit an event
          Debug.enable()
          yield* Debug.log({
            event: "signal.set",
            signal_id: "sig_test",
            prev_value: 0,
            value: 42,
            listener_count: 1
          })

          // Query the stored event
          const events = yield* server.query({ eventType: "signal" })
          expect(events.length).toBe(1)
          expect(events[0]?.eventType).toBe("signal.set")
        }).pipe(Effect.provide(Debug.serverLayer({ port: 14576, dbPath: ":memory:" })))
      )
    )
  })
})
