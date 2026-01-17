/**
 * Browser Structure Test
 * 
 * Tests the exact structure used in browser: mount(container, <>{App}<DevMode /></>)
 */
import { describe, expect, it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import * as Signal from "../src/Signal.js"
import { render, click, waitFor } from "../src/testing.js"
import * as Debug from "../src/debug.js"
import { DevMode } from "../src/DevMode.js"

// Theme service
interface ThemeConfig {
  readonly name: string
}

class Theme extends Context.Tag("Theme")<Theme, ThemeConfig>() {}

const LightTheme = Layer.succeed(Theme, { name: "Light" })
const DarkTheme = Layer.succeed(Theme, { name: "Dark" })

describe("Browser structure", () => {
  it.scoped("re-renders when Signal.get value changes in Fragment with DevMode", () =>
    Effect.gen(function* () {
      // Enable debug before render (simulates localStorage/URL param)
      Debug.enable()
      
      let renderCount = 0
      
      const ThemedCard = Effect.gen(function* () {
        const theme = yield* Theme
        return <div data-testid="card">{theme.name} Theme</div>
      })

      const ThemeApp = Effect.gen(function* () {
        renderCount++
        console.log(`ThemeApp render #${renderCount}`)
        
        const isDark = yield* Signal.make(false)
        const isDarkValue = yield* Signal.get(isDark)
        console.log(`isDarkValue = ${isDarkValue}`)
        
        const currentTheme = isDarkValue ? DarkTheme : LightTheme
        const card = yield* Effect.provide(ThemedCard, currentTheme)

        return (
          <div data-testid="container">
            <button 
              data-testid="toggle"
              onClick={() => Signal.update(isDark, v => !v)}
            >
              Switch to {isDarkValue ? "Light" : "Dark"}
            </button>
            {card}
          </div>
        )
      })

      // This exactly matches the browser structure:
      // mount(container, <>{ThemeApp}<DevMode /></>)
      const FragmentWithDevMode = (
        <>
          {ThemeApp}
          <DevMode />
        </>
      )

      const { getByTestId, container } = yield* render(FragmentWithDevMode)

      // Initial state
      expect(getByTestId("card").textContent).toBe("Light Theme")
      expect(getByTestId("toggle").textContent).toBe("Switch to Dark")
      expect(renderCount).toBe(1)

      // Click to toggle
      yield* click(getByTestId("toggle"))

      // Wait for re-render
      yield* waitFor(() => {
        const cardEl = container.querySelector('[data-testid="card"]')
        console.log("Looking for card, found:", cardEl?.textContent)
        expect(cardEl?.textContent).toBe("Dark Theme")
        return true
      })

      expect(getByTestId("toggle").textContent).toBe("Switch to Light")
      expect(renderCount).toBe(2)
      
      Debug.disable()
    })
  )
})
