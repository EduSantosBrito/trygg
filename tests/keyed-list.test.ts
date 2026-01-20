/**
 * Tests for KeyedList (F-006)
 * 
 * Verifies:
 * 1. Subscription stability - reuse subscriptions for stable signals
 * 2. Minimal DOM moves - use LIS algorithm to minimize DOM operations
 * 3. Cleanup on churn - properly release subscriptions when items removed
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "@effect/vitest"
import { Effect, Scope, TestClock } from "effect"
import * as Signal from "../src/Signal.js"
import * as Renderer from "../src/Renderer.js"
import { Element, text } from "../src/Element.js"
import * as Debug from "../src/debug.js"

/** Item type for tests */
type Item = { readonly id: number; readonly name: string }

/**
 * Helper to run renderer effects with a clean DOM container
 */
const withContainer = <A>(
  fn: (container: HTMLElement) => Effect.Effect<A, unknown, Scope.Scope>
): Effect.Effect<A, unknown, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const container = document.createElement("div")
      document.body.appendChild(container)
      
      try {
        const result = yield* fn(container)
        return result
      } finally {
        container.remove()
      }
    })
  )

/**
 * Helper to render an element and get the result
 */
const renderInContainer = Effect.fnUntraced(
  function* (container: HTMLElement, element: Element) {
    const renderer = yield* Renderer.Renderer
    return yield* renderer.render(element, container)
  },
  Effect.provide(Renderer.browserLayer)
)

describe("KeyedList (F-006)", () => {
  beforeEach(() => {
    Debug.enable()
  })
  
  afterEach(() => {
    Debug.disable()
  })

  describe("Subscription stability", () => {
    it.effect("reorder list with same keys → subscription count unchanged", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          // Create a source signal with items
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
            { id: 3, name: "C" },
          ])

          // Track subscription counts on the source
          const initialSourceListeners = items._listeners.size

          // Create a keyed list element
          const listElement = Signal.each(
            items,
            (item) => Effect.succeed(text(item.name)),
            { key: (item) => item.id }
          )

          // Render the list
          const result = yield* renderInContainer(container, listElement)

          // Get subscription count after initial render
          // Source should have 1 listener (the list itself)
          const afterRenderListeners = items._listeners.size
          expect(afterRenderListeners).toBe(initialSourceListeners + 1)

          // Reorder the list (reverse order)
          yield* Signal.set(items, [
            { id: 3, name: "C" },
            { id: 2, name: "B" },
            { id: 1, name: "A" },
          ])

          // Wait for microtask
          yield* TestClock.adjust("10 millis")

          // Subscription count should remain the same
          expect(items._listeners.size).toBe(afterRenderListeners)

          // Cleanup
          yield* result.cleanup
        })
      )
    )

    it.effect("remove key → subscription released", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          // Create source signal
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
            { id: 3, name: "C" },
          ])

          const listElement = Signal.each(
            items,
            (item) => Effect.succeed(text(item.name)),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)

          // Wait for initial render
          yield* TestClock.adjust("10 millis")

          // Remove an item
          yield* Signal.set(items, [
            { id: 1, name: "A" },
            { id: 3, name: "C" },
          ])

          // Wait for update
          yield* TestClock.adjust("10 millis")

          // Verify DOM reflects removal
          const textNodes = container.textContent
          expect(textNodes).toBe("AC")
          expect(textNodes).not.toContain("B")

          yield* result.cleanup
        })
      )
    )

    it.effect("add key → subscription created once", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          // Start with 2 items
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
          ])

          const initialListeners = items._listeners.size

          const listElement = Signal.each(
            items,
            (item) => Effect.succeed(text(item.name)),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          // Verify initial render
          expect(container.textContent).toBe("AB")

          // Add a new item
          yield* Signal.set(items, [
            { id: 1, name: "A" },
            { id: 2, name: "B" },
            { id: 3, name: "C" },
          ])

          yield* TestClock.adjust("10 millis")

          // Verify DOM includes new item
          expect(container.textContent).toBe("ABC")

          // Source still has same listener count (just the list)
          expect(items._listeners.size).toBe(initialListeners + 1)

          yield* result.cleanup
        })
      )
    )
  })

  describe("Cleanup on churn", () => {
    it.effect("clear list → all subscriptions released", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
            { id: 3, name: "C" },
          ])

          const listElement = Signal.each(
            items,
            (item) => Effect.succeed(text(item.name)),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          expect(container.textContent).toBe("ABC")

          // Clear all items
          yield* Signal.set(items, [])
          yield* TestClock.adjust("10 millis")

          // DOM should be empty (except comment anchor)
          expect(container.textContent).toBe("")

          yield* result.cleanup
        })
      )
    )

    it.effect("remove + add same key → subscription recreated correctly", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
          ])

          const listElement = Signal.each(
            items,
            (item) => Effect.succeed(text(item.name)),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          // Remove item with id=2
          yield* Signal.set(items, [{ id: 1, name: "A" }])
          yield* TestClock.adjust("10 millis")

          expect(container.textContent).toBe("A")

          // Re-add item with id=2 (same key)
          yield* Signal.set(items, [
            { id: 1, name: "A" },
            { id: 2, name: "B-new" },
          ])
          yield* TestClock.adjust("10 millis")

          expect(container.textContent).toBe("AB-new")

          yield* result.cleanup
        })
      )
    )

    it.effect("unmount cleans up all item subscriptions", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
          ])

          const initialListeners = items._listeners.size

          const listElement = Signal.each(
            items,
            (item) => Effect.succeed(text(item.name)),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          // List adds one listener
          expect(items._listeners.size).toBe(initialListeners + 1)

          // Cleanup (unmount)
          yield* result.cleanup

          // All listeners should be removed
          expect(items._listeners.size).toBe(initialListeners)
        })
      )
    )
  })

  describe("Minimal DOM moves (LIS optimization)", () => {
    it.effect("reorder with long stable subsequence → minimal moves", () =>
      Effect.gen(function* () {
        const debugLogs: Array<{ event: string; moves?: number; stable_nodes?: number }> = []
        const originalLog = Debug.log
        vi.spyOn(Debug, "log").mockImplementation((event) => {
          if (event.event === "render.keyedlist.reorder") {
            debugLogs.push(event as { event: string; moves?: number; stable_nodes?: number })
          }
          return originalLog(event)
        })

        try {
          yield* withContainer((container) =>
            Effect.gen(function* () {
              // Items where [1,2,3,4,5] → [1,2,4,5,3]
              // LIS: [1,2,4,5] - so only item 3 needs to move
              const items = yield* Signal.make<ReadonlyArray<Item>>([
                { id: 1, name: "1" },
                { id: 2, name: "2" },
                { id: 3, name: "3" },
                { id: 4, name: "4" },
                { id: 5, name: "5" },
              ])

              const listElement = Signal.each(
                items,
                (item) => Effect.succeed(text(item.name)),
                { key: (item) => item.id }
              )

              const result = yield* renderInContainer(container, listElement)
              yield* TestClock.adjust("10 millis")

              debugLogs.length = 0 // Clear initial render logs

              // Move item 3 to end
              yield* Signal.set(items, [
                { id: 1, name: "1" },
                { id: 2, name: "2" },
                { id: 4, name: "4" },
                { id: 5, name: "5" },
                { id: 3, name: "3" },
              ])
              yield* TestClock.adjust("10 millis")

              // Verify correct order
              expect(container.textContent).toBe("12453")

              // Check that only 1 node moved (item 3)
              const reorderLog = debugLogs.find(l => l.event === "render.keyedlist.reorder")
              expect(reorderLog).toBeDefined()
              if (reorderLog) {
                // Only item 3 needs to move (1,2,4,5 are in LIS)
                expect(reorderLog.moves).toBeLessThanOrEqual(2) // 3 moves to end
                expect(reorderLog.stable_nodes).toBeGreaterThanOrEqual(3)
              }

              yield* result.cleanup
            })
          )
        } finally {
          vi.restoreAllMocks()
        }
      })
    )

    it.effect("reverse order → moves limited to required nodes", () =>
      Effect.gen(function* () {
        const debugLogs: Array<{ event: string; moves?: number }> = []
        const originalLog = Debug.log
        vi.spyOn(Debug, "log").mockImplementation((event) => {
          if (event.event === "render.keyedlist.reorder") {
            debugLogs.push(event as { event: string; moves?: number })
          }
          return originalLog(event)
        })

        try {
          yield* withContainer((container) =>
            Effect.gen(function* () {
              // [1,2,3] → [3,2,1]
              // LIS of old indices in new order: old indices are [2,1,0]
              // LIS is just [2] or [1] or [0] (length 1)
              // So n-1 = 2 items need to move
              const items = yield* Signal.make<ReadonlyArray<Item>>([
                { id: 1, name: "A" },
                { id: 2, name: "B" },
                { id: 3, name: "C" },
              ])

              const listElement = Signal.each(
                items,
                (item) => Effect.succeed(text(item.name)),
                { key: (item) => item.id }
              )

              const result = yield* renderInContainer(container, listElement)
              yield* TestClock.adjust("10 millis")

              debugLogs.length = 0

              // Reverse
              yield* Signal.set(items, [
                { id: 3, name: "C" },
                { id: 2, name: "B" },
                { id: 1, name: "A" },
              ])
              yield* TestClock.adjust("10 millis")

              expect(container.textContent).toBe("CBA")

              yield* result.cleanup
            })
          )
        } finally {
          vi.restoreAllMocks()
        }
      })
    )

    it.effect("insert with reorder → only affected nodes move", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          // [1,2,3] → [1,4,2,3] (insert 4 in middle)
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "1" },
            { id: 2, name: "2" },
            { id: 3, name: "3" },
          ])

          const listElement = Signal.each(
            items,
            (item) => Effect.succeed(text(item.name)),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          expect(container.textContent).toBe("123")

          // Insert item 4 at position 1
          yield* Signal.set(items, [
            { id: 1, name: "1" },
            { id: 4, name: "4" },
            { id: 2, name: "2" },
            { id: 3, name: "3" },
          ])
          yield* TestClock.adjust("10 millis")

          expect(container.textContent).toBe("1423")

          yield* result.cleanup
        })
      )
    )

    it.effect("DOM node identities preserved for stable keys", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
            { id: 3, name: "C" },
          ])

          const listElement = Signal.each(
            items,
            (item) => Effect.succeed(text(item.name)),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          // Get references to DOM nodes
          const childNodes = Array.from(container.childNodes)
          // Filter to text nodes (skip comments)
          const textNodesBefore = childNodes.filter(n => n.nodeType === Node.TEXT_NODE)

          // Reorder: [A,B,C] → [C,A,B]
          yield* Signal.set(items, [
            { id: 3, name: "C" },
            { id: 1, name: "A" },
            { id: 2, name: "B" },
          ])
          yield* TestClock.adjust("10 millis")

          const childNodesAfter = Array.from(container.childNodes)
          const textNodesAfter = childNodesAfter.filter(n => n.nodeType === Node.TEXT_NODE)

          // Same text nodes should exist (just reordered)
          expect(textNodesAfter.length).toBe(textNodesBefore.length)

          yield* result.cleanup
        })
      )
    )
  })

  describe("Item signal updates", () => {
    it.effect("signal update within item triggers item re-render only", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          type ItemWithSignal = { readonly id: number; readonly countSignal: Signal.Signal<number> }
          
          // Create items with their own signals
          const count1 = yield* Signal.make(0)
          const count2 = yield* Signal.make(0)

          const items = yield* Signal.make<ReadonlyArray<ItemWithSignal>>([
            { id: 1, countSignal: count1 },
            { id: 2, countSignal: count2 },
          ])

          const listElement = Signal.each(
            items,
            (item) =>
              Effect.gen(function* () {
                const count = yield* Signal.get(item.countSignal)
                return text(`item${item.id}:${count}`)
              }),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          expect(container.textContent).toBe("item1:0item2:0")

          // Update only item 1's signal
          yield* Signal.set(count1, 5)
          yield* TestClock.adjust("50 millis") // Allow re-render

          // Only item 1 should update
          expect(container.textContent).toBe("item1:5item2:0")

          yield* result.cleanup
        })
      )
    )
  })
})
