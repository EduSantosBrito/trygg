/**
 * Debug Order Test
 * 
 * Tests that debug logging captures the initial render when enabled
 * BEFORE rendering (not relying on DevMode component ordering).
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Signal from "../src/Signal.js"
import { render } from "../src/testing.js"
import * as Debug from "../src/debug.js"

// Capture debug events
interface CapturedEvent {
  event: string
  accessed_signals: number | undefined
  has_phase: boolean | undefined
}
const capturedEvents: Array<CapturedEvent> = []

describe("Debug capture order", () => {
  it.scoped("captures signal.get on initial render when debug enabled first", () =>
    Effect.gen(function* () {
      // Clear captured events
      capturedEvents.length = 0
      
      // Enable debug BEFORE rendering
      Debug.enable()
      
      // Override console.log to capture events
      const originalLog = console.log
      console.log = (...args: unknown[]) => {
        // Extract debug event from console.log call
        if (typeof args[0] === 'string' && args[0].includes('[effectui]')) {
          const eventObj = args[3] as { event?: string; accessed_signals?: number; has_phase?: boolean } | undefined
          if (eventObj && typeof eventObj === 'object' && 'event' in eventObj) {
            capturedEvents.push({
              event: eventObj.event ?? 'unknown',
              accessed_signals: eventObj.accessed_signals,
              has_phase: eventObj.has_phase
            })
          }
        }
        originalLog(...args)
      }

      const ThemeApp = Effect.gen(function* () {
        const isDark = yield* Signal.make(false)
        const isDarkValue = yield* Signal.get(isDark)  // Should be captured!
        
        return (
          <div data-testid="container">
            <span data-testid="status">{isDarkValue ? "Dark" : "Light"}</span>
            <button 
              data-testid="toggle"
              onClick={() => Signal.update(isDark, v => !v)}
            >
              Toggle
            </button>
          </div>
        )
      })

      yield* render(ThemeApp)

      // Restore console.log
      console.log = originalLog
      
      // Check captured events
      const signalGetPhaseEvent = capturedEvents.find(e => e.event === 'signal.get.phase')
      const initialRenderEvent = capturedEvents.find(e => e.event === 'render.component.initial')
      
      console.log("Captured events:", capturedEvents.map(e => e.event))
      console.log("signal.get.phase:", signalGetPhaseEvent)
      console.log("render.component.initial:", initialRenderEvent)
      
      // signal.get.phase should show has_phase: true
      expect(signalGetPhaseEvent).toBeDefined()
      expect(signalGetPhaseEvent?.has_phase).toBe(true)
      
      // render.component.initial should show accessed_signals: 1
      expect(initialRenderEvent).toBeDefined()
      expect(initialRenderEvent?.accessed_signals).toBe(1)
      
      Debug.disable()
    })
  )
})
