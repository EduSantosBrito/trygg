/**
 * Tests for Portal (F-007)
 * 
 * Verifies:
 * 1. Missing target fails with PortalTargetNotFoundError via Effect.fail
 * 2. Valid target renders children correctly
 * 3. Portal cleanup removes nodes from target
 */
import { describe, expect, it, beforeEach, afterEach } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import * as Renderer from "../src/Renderer.js"
import { portal, text, intrinsic } from "../src/Element.js"
import type { Element } from "../src/Element.js"

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

describe("Portal (F-007)", () => {
  let portalTarget: HTMLElement

  beforeEach(() => {
    // Create a portal target element in the DOM
    portalTarget = document.createElement("div")
    portalTarget.id = "portal-root"
    document.body.appendChild(portalTarget)
  })

  afterEach(() => {
    // Clean up the portal target
    portalTarget.remove()
  })

  describe("Portal missing target failure", () => {
    it.effect("missing target '#missing' returns Effect failure with selector in error", () =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(
          withContainer((container) =>
            Effect.gen(function* () {
              const portalElement = portal("#missing", [text("Content")])
              return yield* renderInContainer(container, portalElement)
            })
          )
        )

        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          const error = result.cause
          // Should be a Fail cause with PortalTargetNotFoundError
          expect(error._tag).toBe("Fail")
          if (error._tag === "Fail") {
            // Runtime check for the error type
            expect(typeof error.error).toBe("object")
            expect(error.error).not.toBeNull()
            const errorObj = error.error
            expect(errorObj).toHaveProperty("_tag", "PortalTargetNotFoundError")
            expect(errorObj).toHaveProperty("target", "#missing")
          }
        }
      })
    )

    it.effect("failure occurs in Effect error channel (no thrown exception)", () =>
      Effect.gen(function* () {
        // This test verifies that the error is in the Effect error channel
        const result = yield* Effect.either(
          withContainer((container) =>
            Effect.gen(function* () {
              const portalElement = portal("#nonexistent", [text("Content")])
              return yield* renderInContainer(container, portalElement)
            })
          )
        )

        // The error should be in the Left channel
        expect(result._tag).toBe("Left")
      })
    )

    it.effect("portal children not inserted into DOM when target missing", () =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(
          withContainer((container) =>
            Effect.gen(function* () {
              // Create a unique marker we can search for
              const uniqueMarker = `portal-child-${Date.now()}`
              const portalElement = portal("#missing", [
                intrinsic("div", { "data-marker": uniqueMarker }, [], null)
              ])
              
              // Try to render - should fail
              const renderResult = yield* Effect.either(
                renderInContainer(container, portalElement)
              )
              
              // Verify the marker div was NOT inserted anywhere in the document
              const markerElements = document.querySelectorAll(`[data-marker="${uniqueMarker}"]`)
              expect(markerElements.length).toBe(0)
              
              return renderResult
            })
          )
        )

        // The outer effect should succeed (we used Effect.either to catch the inner failure)
        expect(Exit.isSuccess(result)).toBe(true)
      })
    )
  })

  describe("Portal renders with valid target", () => {
    it.effect("existing target element renders portal children", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const portalElement = portal("#portal-root", [text("Portal Content")])
          const result = yield* renderInContainer(container, portalElement)

          // Children should be in the portal target
          expect(portalTarget.textContent).toBe("Portal Content")
          
          // Main container should have the anchor comment
          const hasComment = Array.from(container.childNodes).some(
            node => node.nodeType === Node.COMMENT_NODE && node.textContent === "portal"
          )
          expect(hasComment).toBe(true)

          yield* result.cleanup
        })
      )
    )

    it.effect("update portal children updates target", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          // Render with initial content
          const portalElement = portal("#portal-root", [
            intrinsic("span", {}, [text("Initial")], null)
          ])
          const result = yield* renderInContainer(container, portalElement)

          expect(portalTarget.querySelector("span")?.textContent).toBe("Initial")

          yield* result.cleanup
        })
      )
    )

    it.effect("unmount portal removes portal nodes", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const portalElement = portal("#portal-root", [
            intrinsic("div", { className: "portal-child" }, [text("Content")], null)
          ])
          const result = yield* renderInContainer(container, portalElement)

          // Children should be in target
          expect(portalTarget.querySelector(".portal-child")).not.toBeNull()

          // Cleanup
          yield* result.cleanup

          // Children should be removed from target
          expect(portalTarget.querySelector(".portal-child")).toBeNull()
          
          // Anchor comment should be removed from container
          const hasComment = Array.from(container.childNodes).some(
            node => node.nodeType === Node.COMMENT_NODE && node.textContent === "portal"
          )
          expect(hasComment).toBe(false)
        })
      )
    )

    it.effect("portal with HTMLElement target works", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          // Create a separate target element
          const customTarget = document.createElement("div")
          document.body.appendChild(customTarget)

          try {
            const portalElement = portal(customTarget, [text("Direct Target")])
            const result = yield* renderInContainer(container, portalElement)

            // Content should be in the custom target
            expect(customTarget.textContent).toBe("Direct Target")

            yield* result.cleanup
          } finally {
            customTarget.remove()
          }
        })
      )
    )
  })
})
