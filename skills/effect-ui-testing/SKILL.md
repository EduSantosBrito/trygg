---
name: effect-ui-testing
description: Test effect-ui components with Effect Vitest integration. Use when writing tests, mocking services, testing signals, or verifying component behavior.
license: MIT
metadata:
  author: effect-ui
  version: "1.0"
---

# effect-ui Testing

Test effect-ui components with Effect Vitest.

## Setup

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config"
import effectUI from "effect-ui/vite-plugin"

export default defineConfig({
  plugins: [effectUI()],
  test: {
    environment: "happy-dom"
  }
})
```

## Basic Test Pattern

```ts
import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"
import { render, click, waitFor } from "effect-ui/testing"
import { Counter } from "./Counter"

describe("Counter", () => {
  it.scoped("increments on click", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(Counter)
      
      expect(getByTestId("count").textContent).toBe("0")
      
      yield* click(getByTestId("increment"))
      
      yield* waitFor(() => 
        expect(getByTestId("count").textContent).toBe("1")
      )
    })
  )
})
```

**Key**: Use `it.scoped` for automatic cleanup of Effect scopes.

## Test Utilities

### render

```ts
const result = yield* render(Component)
// or with layers
const result = yield* render(Component.pipe(Effect.provide(testLayer)))
```

Returns: `container`, `getByTestId`, `getByText`, `queryByTestId`, `queryByText`

### click

```ts
yield* click(element)
```

### waitFor

```ts
yield* waitFor(() => expect(element.textContent).toBe("updated"))
```

### type

```ts
yield* type(inputElement, "hello@example.com")
```

## Testing with Router

```ts
import * as Router from "effect-ui/router"

describe("UserPage", () => {
  it.scoped("displays user from params", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        UserPage.pipe(
          Effect.provide(Router.testLayer("/users/123"))
        )
      )
      
      yield* waitFor(() =>
        expect(getByTestId("user-id").textContent).toBe("123")
      )
    })
  )
})
```

## Testing Signals

```ts
import { Signal } from "effect-ui"

describe("Signal behavior", () => {
  it.scoped("updates reactively", () =>
    Effect.gen(function* () {
      const count = yield* Signal.make(0)
      const { getByTestId } = yield* render(
        Effect.gen(function* () {
          return <span data-testid="value">{count}</span>
        })
      )
      
      expect(getByTestId("value").textContent).toBe("0")
      
      yield* Signal.set(count, 5)
      
      yield* waitFor(() =>
        expect(getByTestId("value").textContent).toBe("5")
      )
    })
  )
})
```

## Testing with Services

```ts
import { Context, Layer, Effect } from "effect"

class Api extends Context.Tag("Api")<Api, {
  fetchUser: (id: string) => Effect.Effect<User>
}>() {}

const mockApiLayer = Layer.succeed(Api, {
  fetchUser: (id) => Effect.succeed({ id, name: "Test User" })
})

describe("UserProfile", () => {
  it.scoped("displays user from API", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        UserProfile.pipe(Effect.provide(mockApiLayer))
      )
      
      yield* waitFor(() =>
        expect(getByTestId("user-name").textContent).toBe("Test User")
      )
    })
  )
})
```

## Testing Error Boundaries

```ts
const FailingComponent = Effect.fail(new Error("Test error"))

describe("ErrorBoundary", () => {
  it.scoped("shows fallback on error", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(
        <ErrorBoundary fallback={(e) => <div data-testid="error">{String(e)}</div>}>
          {FailingComponent}
        </ErrorBoundary>
      )
      
      yield* waitFor(() =>
        expect(getByTestId("error").textContent).toContain("Test error")
      )
    })
  )
})
```

## Debug Events in Tests

```ts
import * as Debug from "effect-ui/debug"

describe("Debug integration", () => {
  it.scoped("captures debug events", () =>
    Effect.gen(function* () {
      const events: Debug.DebugEvent[] = []
      Debug.registerPlugin(Debug.createCollectorPlugin("test", events))
      
      const count = yield* Signal.make(0)
      yield* Signal.set(count, 1)
      
      const signalEvents = events.filter(e => e.event === "signal.set")
      expect(signalEvents.length).toBe(1)
      
      Debug.unregisterPlugin("test")
    })
  )
})
```

## Querying Test Logs (LLM Observability)

Test logs are automatically collected during test runs and can be queried programmatically.

### Query Logs After Test Run

After running `bun run test`, logs are persisted to `.effect/test-logs.json`:

```ts
import * as TestLogs from "effect-ui/test-logs"
import fs from "node:fs/promises"

// Load logs from file
const json = await fs.readFile(".effect/test-logs.json", "utf-8")
TestLogs.fromJSON(json)

// Query errors
const errors = TestLogs.query({ level: "error" })
console.log(`Found ${errors.totalCount} errors`)

// Query by test name
const testLogs = TestLogs.query({ testName: "Counter > increments on click" })

// Query by event type
const routerEvents = TestLogs.query({ eventType: "router" })

// Query by trace ID (correlate events)
const relatedEvents = TestLogs.query({ traceId: "trace_42" })
```

### Query Options

```ts
interface QueryOptions {
  level?: "debug" | "info" | "warn" | "error"
  eventType?: string   // Filter by prefix (e.g., "router" matches "router.navigate")
  testName?: string    // Exact match
  traceId?: string     // Correlation ID
  after?: string       // ISO timestamp
  before?: string      // ISO timestamp
  limit?: number       // Default: 1000
}
```

### LLM Workflow

1. Run tests: `bun run test`
2. Read `.effect/llms.txt` for API schema
3. Query `.effect/test-logs.json` for structured events
4. Filter by level "error" to find failures
5. Use traceId to correlate related events

### Programmatic Access in Tests

```ts
import * as TestLogs from "effect-ui/test-logs"

// Enable collection (automatic in vitest.setup.ts)
TestLogs.enable()

// After test actions, query in-memory
const events = TestLogs.query({ level: "error" })
```

## Common Mistakes

### Wrong: Not waiting for updates
```ts
yield* Signal.set(count, 5)
expect(getByTestId("value").textContent).toBe("5")  // May fail!
```

### Right: Use waitFor
```ts
yield* Signal.set(count, 5)
yield* waitFor(() => expect(getByTestId("value").textContent).toBe("5"))
```

### Wrong: Forgetting scope
```ts
it("test without scope", () => { ... })  // Resources may leak!
```

### Right: Use it.scoped
```ts
it.scoped("test with scope", () => Effect.gen(...))
```
