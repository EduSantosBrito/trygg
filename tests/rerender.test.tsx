/**
 * Re-render Tests
 * 
 * Tests for component-level re-rendering when Signal.get() is used.
 * Unlike fine-grained updates (passing Signal to JSX), using Signal.get()
 * should subscribe the component and trigger full re-renders.
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Signal from "../src/Signal.js"
import { render, click, waitFor } from "../src/testing.js"
import * as Debug from "../src/debug.js"

describe("Component re-render", () => {
  it.scoped("component re-renders when Signal.get value changes", () =>
    Effect.gen(function* () {
      // Enable debug logging to verify the flow
      Debug.enable()
      
      // Track render count via closure
      let renderCount = 0

      const ToggleComponent = Effect.gen(function* () {
        renderCount++
        console.log(`ToggleComponent render #${renderCount}`)
        
        const isOn = yield* Signal.make(false)
        
        // Using Signal.get should subscribe the component to changes
        const isOnValue = yield* Signal.get(isOn)
        console.log(`isOnValue = ${isOnValue}, renderCount = ${renderCount}`)

        return (
          <div data-testid="container">
            <span data-testid="status">{isOnValue ? "ON" : "OFF"}</span>
            <button 
              data-testid="toggle"
              onClick={() => Signal.update(isOn, v => !v)}
            >
              Toggle
            </button>
          </div>
        )
      })

      const { getByTestId } = yield* render(ToggleComponent)

      // Initial render
      expect(getByTestId("status").textContent).toBe("OFF")
      expect(renderCount).toBe(1)

      // Click toggle - should trigger re-render
      yield* click(getByTestId("toggle"))

      // Wait for re-render
      yield* waitFor(() => {
        expect(getByTestId("status").textContent).toBe("ON")
        return true
      })

      // Should have re-rendered
      expect(renderCount).toBe(2)
      
      Debug.disable()
    })
  )
  
  it.scoped("conditional rendering with Signal.get", () =>
    Effect.gen(function* () {
      const ConditionalComponent = Effect.gen(function* () {
        const showDetail = yield* Signal.make(false)
        
        // Using Signal.get to decide what to render
        const shouldShowDetail = yield* Signal.get(showDetail)

        return (
          <div data-testid="container">
            {shouldShowDetail ? (
              <div data-testid="detail">Detailed content here</div>
            ) : (
              <div data-testid="summary">Click to expand</div>
            )}
            <button 
              data-testid="expand"
              onClick={() => Signal.update(showDetail, v => !v)}
            >
              {shouldShowDetail ? "Collapse" : "Expand"}
            </button>
          </div>
        )
      })

      const { getByTestId, queryByTestId } = yield* render(ConditionalComponent)

      // Initial state - summary shown
      expect(queryByTestId("summary")).not.toBeNull()
      expect(queryByTestId("detail")).toBeNull()
      expect(getByTestId("expand").textContent).toBe("Expand")

      // Click to expand
      yield* click(getByTestId("expand"))

      // Wait for re-render with new content
      yield* waitFor(() => {
        expect(queryByTestId("detail")).not.toBeNull()
        return true
      })

      // Detail should be shown, summary hidden
      expect(queryByTestId("summary")).toBeNull()
      expect(getByTestId("expand").textContent).toBe("Collapse")
    })
  )
})
