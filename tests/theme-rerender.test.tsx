/**
 * Theme Re-render Test
 * 
 * Tests the specific pattern used in the theme example:
 * - Signal.get to read a value
 * - Effect.provide to provide different layers based on the value
 */
import { describe, expect, it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import * as Signal from "../src/Signal.js"
import { render, click, waitFor } from "../src/testing.js"
import * as Debug from "../src/debug.js"

// Define a Theme service
interface ThemeConfig {
  readonly name: string
  readonly color: string
}

class Theme extends Context.Tag("Theme")<Theme, ThemeConfig>() {}

const LightTheme = Layer.succeed(Theme, { name: "Light", color: "#fff" })
const DarkTheme = Layer.succeed(Theme, { name: "Dark", color: "#000" })

describe("Theme re-render pattern", () => {
  it.scoped("re-renders when theme toggle changes", () =>
    Effect.gen(function* () {
      Debug.enable()
      
      let renderCount = 0

      // Nested component that uses Theme
      const ThemedCard = Effect.gen(function* () {
        const theme = yield* Theme
        console.log(`ThemedCard: using ${theme.name} theme`)
        return (
          <div data-testid="card" style={{ background: theme.color }}>
            {theme.name} Theme
          </div>
        )
      })

      // Main component that switches themes
      const ThemeApp = Effect.gen(function* () {
        renderCount++
        console.log(`ThemeApp render #${renderCount}`)
        
        const isDark = yield* Signal.make(false)
        const isDarkValue = yield* Signal.get(isDark)
        console.log(`isDarkValue = ${isDarkValue}`)
        
        const currentTheme = isDarkValue ? DarkTheme : LightTheme
        
        // This is the pattern from the theme example
        const card = yield* Effect.provide(ThemedCard, currentTheme)

        return (
          <div data-testid="container">
            <button 
              data-testid="toggle"
              onClick={() => Signal.update(isDark, v => !v)}
            >
              Switch to {isDarkValue ? "Light" : "Dark"} Theme
            </button>
            {card}
          </div>
        )
      })

      const { getByTestId } = yield* render(ThemeApp)

      // Initial state - Light theme
      expect(getByTestId("card").textContent).toBe("Light Theme")
      expect(getByTestId("toggle").textContent).toBe("Switch to Dark Theme")
      expect(renderCount).toBe(1)

      // Click toggle - should switch to dark theme
      yield* click(getByTestId("toggle"))

      // Wait for re-render
      yield* waitFor(() => {
        expect(getByTestId("card").textContent).toBe("Dark Theme")
        return true
      })

      expect(getByTestId("toggle").textContent).toBe("Switch to Light Theme")
      expect(renderCount).toBe(2)
      
      Debug.disable()
    })
  )
})
