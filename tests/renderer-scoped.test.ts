/**
 * Tests for F-012: Renderer scoped DOM graph
 *
 * Verifies:
 * 1. Scoped lifecycle - nodes released on scope close
 * 2. Signal patching - attributes and text update in place
 * 3. data- and aria- signal attribute updates
 * 4. Keyed list stability with node identity preserved
 * 5. Mount does not destroy existing container content
 */
import { describe, expect, it, beforeEach, afterEach } from "@effect/vitest"
import { Effect, Option, Scope, TestClock } from "effect"
import * as Signal from "../src/Signal.js"
import * as Renderer from "../src/Renderer.js"
import { Element, text, intrinsic, componentElement } from "../src/Element.js"
import * as Debug from "../src/debug.js"

/** Item type for tests */
type Item = { readonly id: number; readonly name: string }

/**
 * Helper to run renderer effects with a clean DOM container
 */
const withContainer = <A, E>(
  fn: (container: HTMLElement) => Effect.Effect<A, E, Scope.Scope>
): Effect.Effect<A, E, never> =>
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

describe("Renderer scoped DOM graph (F-012)", () => {
  beforeEach(() => {
    Debug.enable()
  })

  afterEach(() => {
    Debug.disable()
  })

  describe("Scoped lifecycle", () => {
    it.effect("unmount closes scope - all renderer nodes removed", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          // Render a tree with multiple nodes
          const tree = intrinsic(
            "div",
            { className: "root" },
            [
              intrinsic("span", { className: "child-1" }, [text("Child 1")], null),
              intrinsic("span", { className: "child-2" }, [text("Child 2")], null)
            ],
            null
          )

          const result = yield* renderInContainer(container, tree)

          // Verify nodes are rendered
          expect(container.querySelector(".root")).not.toBeNull()
          expect(container.querySelector(".child-1")).not.toBeNull()
          expect(container.querySelector(".child-2")).not.toBeNull()

          // Cleanup (unmount)
          yield* result.cleanup

          // All renderer nodes should be removed
          expect(container.querySelector(".root")).toBeNull()
          expect(container.querySelector(".child-1")).toBeNull()
          expect(container.querySelector(".child-2")).toBeNull()
        })
      )
    )

    it.effect("remount creates new nodes, old nodes not reused", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const tree = intrinsic("div", { id: "test-node" }, [text("Content")], null)

          // First mount
          const result1 = yield* renderInContainer(container, tree)
          const node1 = container.querySelector("#test-node")
          expect(node1).not.toBeNull()

          // Cleanup first mount
          yield* result1.cleanup
          expect(container.querySelector("#test-node")).toBeNull()

          // Second mount
          const result2 = yield* renderInContainer(container, tree)
          const node2 = container.querySelector("#test-node")
          expect(node2).not.toBeNull()

          // New node should be a different instance
          expect(node2).not.toBe(node1)

          yield* result2.cleanup
        })
      )
    )

    it.effect("scope close via mount automatically cleans up", () =>
      Effect.gen(function* () {
        const container = document.createElement("div")
        document.body.appendChild(container)

        try {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const renderer = yield* Renderer.Renderer
              const tree = intrinsic(
                "div",
                { className: "scoped-node" },
                [text("Scoped")],
                null
              )
              // mount registers a finalizer on the scope
              yield* renderer.mount(container, tree)

              // Node should exist
              expect(container.querySelector(".scoped-node")).not.toBeNull()
            }).pipe(Effect.provide(Renderer.browserLayer))
          )

          // After the scoped effect completes, nodes should be cleaned up
          // because Effect.scoped closes the scope and mount registered cleanup
          expect(container.querySelector(".scoped-node")).toBeNull()
        } finally {
          container.remove()
        }
      })
    )
  })

  describe("Signal patching", () => {
    it.effect("update text signal - text node updates, node identity stable", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const content = yield* Signal.make<unknown>("Initial")

          // Create a SignalText element
          const tree = Element.SignalText({ signal: content })
          const result = yield* renderInContainer(container, tree)

          // Get reference to text node
          const textNodes = Array.from(container.childNodes).filter(
            (n) => n.nodeType === Node.TEXT_NODE
          )
          expect(textNodes.length).toBe(1)
          const textNode = textNodes[0]
          expect(textNode?.textContent).toBe("Initial")

          // Update signal
          yield* Signal.set(content, "Updated")
          yield* TestClock.adjust("10 millis")

          // Same text node should exist with new content
          const textNodesAfter = Array.from(container.childNodes).filter(
            (n) => n.nodeType === Node.TEXT_NODE
          )
          expect(textNodesAfter.length).toBe(1)
          expect(textNodesAfter[0]).toBe(textNode) // Same node identity
          expect(textNodesAfter[0]?.textContent).toBe("Updated")

          yield* result.cleanup
        })
      )
    )

    it.effect("update attribute signal - attribute updates, node identity stable", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const className = yield* Signal.make("class-a")

          // Create element with signal className
          const tree = intrinsic(
            "div",
            { className, id: "signal-attr" },
            [text("Test")],
            null
          )
          const result = yield* renderInContainer(container, tree)

          const node = container.querySelector("#signal-attr")
          expect(node).not.toBeNull()
          expect(node?.className).toBe("class-a")

          // Update signal
          yield* Signal.set(className, "class-b")
          yield* TestClock.adjust("10 millis")

          // Same node should have updated className
          const nodeAfter = container.querySelector("#signal-attr")
          expect(nodeAfter).toBe(node) // Same node identity
          expect(nodeAfter?.className).toBe("class-b")

          yield* result.cleanup
        })
      )
    )

    it.effect("multiple updates - no extra nodes created", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const value = yield* Signal.make(0)

          const tree = componentElement(
            () =>
              Effect.gen(function* () {
                const v = yield* Signal.get(value)
                return intrinsic(
                  "span",
                  { id: "counter" },
                  [text(`Count: ${v}`)],
                  null
                )
              }),
            null
          )

          const result = yield* renderInContainer(container, tree)
          yield* TestClock.adjust("10 millis")

          // Initial render
          expect(container.querySelectorAll("#counter").length).toBe(1)
          expect(container.querySelector("#counter")?.textContent).toBe("Count: 0")

          // Multiple updates
          for (let i = 1; i <= 5; i++) {
            yield* Signal.set(value, i)
            yield* TestClock.adjust("20 millis")
          }

          // Still only one counter element
          expect(container.querySelectorAll("#counter").length).toBe(1)
          expect(container.querySelector("#counter")?.textContent).toBe("Count: 5")

          yield* result.cleanup
        })
      )
    )
  })

  describe("data-* signal attribute updates", () => {
    it.effect("initial render sets data-* from signal", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const status = yield* Signal.make("loading")

          const tree = intrinsic(
            "div",
            {
              "data-status": status,
              id: "data-test"
            },
            [text("Content")],
            null
          )

          const result = yield* renderInContainer(container, tree)

          const node = container.querySelector("#data-test")
          expect(node?.getAttribute("data-status")).toBe("loading")

          yield* result.cleanup
        })
      )
    )

    it.effect("signal update changes data-* in DOM", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const status = yield* Signal.make("loading")

          const tree = intrinsic(
            "div",
            {
              "data-status": status,
              id: "data-test"
            },
            [text("Content")],
            null
          )

          const result = yield* renderInContainer(container, tree)

          // Update signal
          yield* Signal.set(status, "complete")
          yield* TestClock.adjust("10 millis")

          const node = container.querySelector("#data-test")
          expect(node?.getAttribute("data-status")).toBe("complete")

          yield* result.cleanup
        })
      )
    )

    it.effect("updating signal changes attribute value", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const status = yield* Signal.make("active")

          const tree = intrinsic(
            "div",
            {
              "data-active": status,
              id: "data-clear-test"
            },
            [text("Content")],
            null
          )

          const result = yield* renderInContainer(container, tree)

          const node = container.querySelector("#data-clear-test")
          expect(node?.getAttribute("data-active")).toBe("active")

          // Update to different value
          yield* Signal.set(status, "inactive")
          yield* TestClock.adjust("10 millis")

          // Attribute should update
          expect(node?.getAttribute("data-active")).toBe("inactive")

          yield* result.cleanup
        })
      )
    )
  })

  describe("aria-* signal attribute updates", () => {
    it.effect("initial render sets aria-* from signal", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const expanded = yield* Signal.make("false")

          const tree = intrinsic(
            "button",
            {
              "aria-expanded": expanded,
              id: "aria-test"
            },
            [text("Toggle")],
            null
          )

          const result = yield* renderInContainer(container, tree)

          const node = container.querySelector("#aria-test")
          expect(node?.getAttribute("aria-expanded")).toBe("false")

          yield* result.cleanup
        })
      )
    )

    it.effect("signal update changes aria-* in DOM", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const expanded = yield* Signal.make("false")

          const tree = intrinsic(
            "button",
            {
              "aria-expanded": expanded,
              id: "aria-test"
            },
            [text("Toggle")],
            null
          )

          const result = yield* renderInContainer(container, tree)

          // Update signal
          yield* Signal.set(expanded, "true")
          yield* TestClock.adjust("10 millis")

          const node = container.querySelector("#aria-test")
          expect(node?.getAttribute("aria-expanded")).toBe("true")

          yield* result.cleanup
        })
      )
    )

    it.effect("updating signal changes aria attribute value", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const label = yield* Signal.make("My Label")

          const tree = intrinsic(
            "div",
            {
              "aria-label": label,
              id: "aria-clear-test"
            },
            [text("Content")],
            null
          )

          const result = yield* renderInContainer(container, tree)

          const node = container.querySelector("#aria-clear-test")
          expect(node?.getAttribute("aria-label")).toBe("My Label")

          // Update to different value
          yield* Signal.set(label, "New Label")
          yield* TestClock.adjust("10 millis")

          expect(node?.getAttribute("aria-label")).toBe("New Label")

          yield* result.cleanup
        })
      )
    )
  })

  describe("Keyed list stability", () => {
    it.effect("reorder with stable keys - node identities preserved", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
            { id: 3, name: "C" }
          ])

          const listElement = Signal.each(
            items,
            (item) =>
              Effect.succeed(
                intrinsic(
                  "span",
                  { "data-id": String(item.id) },
                  [text(item.name)],
                  null
                )
              ),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          // Get node references before reorder
          const nodeA = container.querySelector('[data-id="1"]')
          const nodeB = container.querySelector('[data-id="2"]')
          const nodeC = container.querySelector('[data-id="3"]')

          expect(nodeA).not.toBeNull()
          expect(nodeB).not.toBeNull()
          expect(nodeC).not.toBeNull()

          // Reorder: [A,B,C] -> [C,A,B]
          yield* Signal.set(items, [
            { id: 3, name: "C" },
            { id: 1, name: "A" },
            { id: 2, name: "B" }
          ])
          yield* TestClock.adjust("10 millis")

          // Same node instances should exist (just reordered)
          const nodeAAfter = container.querySelector('[data-id="1"]')
          const nodeBAfter = container.querySelector('[data-id="2"]')
          const nodeCAfter = container.querySelector('[data-id="3"]')

          expect(nodeAAfter).toBe(nodeA)
          expect(nodeBAfter).toBe(nodeB)
          expect(nodeCAfter).toBe(nodeC)

          yield* result.cleanup
        })
      )
    )

    it.effect("insert new key - only new node created", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" }
          ])

          const listElement = Signal.each(
            items,
            (item) =>
              Effect.succeed(
                intrinsic(
                  "span",
                  { "data-id": String(item.id) },
                  [text(item.name)],
                  null
                )
              ),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          const nodeA = container.querySelector('[data-id="1"]')
          const nodeB = container.querySelector('[data-id="2"]')

          // Insert new item
          yield* Signal.set(items, [
            { id: 1, name: "A" },
            { id: 3, name: "C" }, // New
            { id: 2, name: "B" }
          ])
          yield* TestClock.adjust("10 millis")

          // Original nodes preserved
          expect(container.querySelector('[data-id="1"]')).toBe(nodeA)
          expect(container.querySelector('[data-id="2"]')).toBe(nodeB)

          // New node exists
          expect(container.querySelector('[data-id="3"]')).not.toBeNull()
          expect(container.querySelector('[data-id="3"]')?.textContent).toBe("C")

          yield* result.cleanup
        })
      )
    )

    it.effect("remove key - only removed node deleted", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const items = yield* Signal.make<ReadonlyArray<Item>>([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
            { id: 3, name: "C" }
          ])

          const listElement = Signal.each(
            items,
            (item) =>
              Effect.succeed(
                intrinsic(
                  "span",
                  { "data-id": String(item.id) },
                  [text(item.name)],
                  null
                )
              ),
            { key: (item) => item.id }
          )

          const result = yield* renderInContainer(container, listElement)
          yield* TestClock.adjust("10 millis")

          const nodeA = container.querySelector('[data-id="1"]')
          const nodeC = container.querySelector('[data-id="3"]')

          // Remove middle item
          yield* Signal.set(items, [
            { id: 1, name: "A" },
            { id: 3, name: "C" }
          ])
          yield* TestClock.adjust("10 millis")

          // Original nodes for remaining items preserved
          expect(container.querySelector('[data-id="1"]')).toBe(nodeA)
          expect(container.querySelector('[data-id="3"]')).toBe(nodeC)

          // Removed node gone
          expect(container.querySelector('[data-id="2"]')).toBeNull()

          yield* result.cleanup
        })
      )
    )
  })

  describe("Mount does not destroy existing content", () => {
    it.effect("existing container children preserved during mount", () =>
      Effect.gen(function* () {
        const container = document.createElement("div")
        document.body.appendChild(container)

        // Add existing content
        const existingElement = document.createElement("div")
        existingElement.id = "pre-existing"
        existingElement.textContent = "Pre-existing content"
        container.appendChild(existingElement)

        // Add an event listener to verify it is not destroyed
        let eventFired = false
        existingElement.addEventListener("click", () => {
          eventFired = true
        })

        try {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const tree = intrinsic(
                "div",
                { id: "rendered-content" },
                [text("Rendered")],
                null
              )
              const result = yield* renderInContainer(container, tree)

              // Pre-existing content should still exist
              const preExisting = container.querySelector("#pre-existing")
              expect(preExisting).not.toBeNull()
              expect(preExisting?.textContent).toBe("Pre-existing content")

              // New content should also exist
              expect(container.querySelector("#rendered-content")).not.toBeNull()

              // Event listener should still work
              existingElement.click()
              expect(eventFired).toBe(true)

              yield* result.cleanup
            })
          )
        } finally {
          container.remove()
        }
      })
    )

    it.effect("mount anchor comment created for rendered content", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const container = document.createElement("div")
          document.body.appendChild(container)

          try {
            const renderer = yield* Renderer.Renderer
            const tree = intrinsic(
              "div",
              { id: "mounted" },
              [text("Content")],
              null
            )

            yield* renderer.mount(container, tree)

            // Mount anchor comment should exist
            const comments = Array.from(container.childNodes).filter(
              (n) => n.nodeType === Node.COMMENT_NODE
            )
            const mountAnchor = comments.find(
              (c) => c.textContent === "effect-ui-mount"
            )
            expect(mountAnchor).not.toBeUndefined()

            // Rendered content should exist
            const renderedDiv = container.querySelector("#mounted")
            expect(renderedDiv).not.toBeNull()
          } finally {
            container.remove()
          }
        })
      ).pipe(Effect.provide(Renderer.browserLayer))
    )
  })

  describe("Event handlers", () => {
    it.effect("function handler - receives event and runs Effect", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const clicked = yield* Signal.make(false)
          let capturedEvent: Option.Option<Event> = Option.none()

          const tree = intrinsic(
            "button",
            {
              id: "fn-handler",
              onClick: (event: Event) => {
                capturedEvent = Option.some(event)
                return Signal.set(clicked, true)
              }
            },
            [text("Click me")],
            null
          )

          const result = yield* renderInContainer(container, tree)

          const button = container.querySelector("#fn-handler")
          expect(button).not.toBeNull()

          // Simulate click
          if (button instanceof HTMLButtonElement) {
            button.click()
          }
          yield* TestClock.adjust("10 millis")

          // Event should have been captured
          expect(Option.isSome(capturedEvent)).toBe(true)
          if (Option.isSome(capturedEvent)) {
            expect(capturedEvent.value.type).toBe("click")
          }

          // Signal should have been updated
          const value = yield* Signal.get(clicked)
          expect(value).toBe(true)

          yield* result.cleanup
        })
      )
    )

    it.effect("plain Effect handler - runs without event parameter", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const clicked = yield* Signal.make(false)

          // Plain Effect - no function wrapper, no event parameter
          const clickEffect = Signal.set(clicked, true)

          const tree = intrinsic(
            "button",
            {
              id: "effect-handler",
              onClick: clickEffect
            },
            [text("Click me")],
            null
          )

          const result = yield* renderInContainer(container, tree)

          const button = container.querySelector("#effect-handler") as HTMLButtonElement
          expect(button).not.toBeNull()

          // Simulate click
          button.click()
          yield* TestClock.adjust("10 millis")

          // Signal should have been updated
          const value = yield* Signal.get(clicked)
          expect(value).toBe(true)

          yield* result.cleanup
        })
      )
    )

    it.effect("plain Effect handler - multiple clicks run Effect each time", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const count = yield* Signal.make(0)

          // Plain Effect that increments count
          const incrementEffect = Effect.gen(function* () {
            const current = yield* Signal.get(count)
            yield* Signal.set(count, current + 1)
          })

          const tree = intrinsic(
            "button",
            {
              id: "multi-click",
              onClick: incrementEffect
            },
            [text("Increment")],
            null
          )

          const result = yield* renderInContainer(container, tree)

          const button = container.querySelector("#multi-click") as HTMLButtonElement

          // Click 3 times
          button.click()
          yield* TestClock.adjust("10 millis")
          button.click()
          yield* TestClock.adjust("10 millis")
          button.click()
          yield* TestClock.adjust("10 millis")

          const value = yield* Signal.get(count)
          expect(value).toBe(3)

          yield* result.cleanup
        })
      )
    )

    it.effect("mixed handlers - function and Effect on different elements", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const log = yield* Signal.make<Array<string>>([])

          const tree = intrinsic(
            "div",
            {},
            [
              // Function handler
              intrinsic(
                "button",
                {
                  id: "btn-fn",
                  onClick: (_event: Event) =>
                    Effect.gen(function* () {
                      const current = yield* Signal.get(log)
                      yield* Signal.set(log, [...current, "fn-clicked"])
                    })
                },
                [text("Function")],
                null
              ),
              // Effect handler
              intrinsic(
                "button",
                {
                  id: "btn-effect",
                  onClick: Effect.gen(function* () {
                    const current = yield* Signal.get(log)
                    yield* Signal.set(log, [...current, "effect-clicked"])
                  })
                },
                [text("Effect")],
                null
              )
            ],
            null
          )

          const result = yield* renderInContainer(container, tree)

          const btnFn = container.querySelector("#btn-fn") as HTMLButtonElement
          const btnEffect = container.querySelector("#btn-effect") as HTMLButtonElement

          // Click both buttons
          btnFn.click()
          yield* TestClock.adjust("10 millis")
          btnEffect.click()
          yield* TestClock.adjust("10 millis")
          btnFn.click()
          yield* TestClock.adjust("10 millis")

          const value = yield* Signal.get(log)
          expect(value).toEqual(["fn-clicked", "effect-clicked", "fn-clicked"])

          yield* result.cleanup
        })
      )
    )
  })
})
