/**
 * Theme (Dependency Injection) Example
 *
 * Demonstrates:
 * - Context.Tag for defining services
 * - Effect.provide for dependency injection
 * - Layer for service implementation
 * - Swapping layers at runtime
 * - DevMode for debug observability
 */
import { Context, Effect, Layer } from "effect"
import { mount, Signal, DevMode } from "effect-ui"

// Define a Theme service using Context.Tag
interface ThemeConfig {
  readonly name: string
  readonly background: string
  readonly text: string
  readonly primary: string
  readonly border: string
}

class Theme extends Context.Tag("Theme")<Theme, ThemeConfig>() {}

// Light theme layer
const LightTheme = Layer.succeed(Theme, {
  name: "Light",
  background: "#ffffff",
  text: "#333333",
  primary: "#0066cc",
  border: "#e0e0e0"
})

// Dark theme layer
const DarkTheme = Layer.succeed(Theme, {
  name: "Dark",
  background: "#1a1a2e",
  text: "#eaeaea",
  primary: "#4da6ff",
  border: "#333355"
})

// A component that uses the Theme service
// Note: R = Theme (has a requirement)
const ThemedCard = Effect.gen(function* () {
  // Access the theme via yield*
  const theme = yield* Theme

  return (
    <div
      className="themed"
      style={{
        background: theme.background,
        color: theme.text,
        border: `2px solid ${theme.border}`,
        padding: "1.5rem",
        borderRadius: "8px"
      }}
    >
      <h2 style={{ color: theme.primary, marginTop: 0 }}>
        {theme.name} Theme
      </h2>
      <p>This card uses the injected theme service.</p>
      <p>
        Click "Switch to Dark/Light Theme" above to see the theme change.
      </p>
    </div>
  )
})

// Main app that switches between themes
const ThemeApp = Effect.gen(function* () {
  const isDark = yield* Signal.make(false)

  // Get current value for rendering
  const isDarkValue = yield* Signal.get(isDark)

  // Provide different layers based on state
  const currentTheme = isDarkValue ? DarkTheme : LightTheme

  const toggleTheme = () => Signal.update(isDark, (v) => !v)

  // Render the themed card with the current theme layer
  const card = yield* Effect.provide(ThemedCard, currentTheme)

  return (
    <div className="example">
      <div className="theme-switcher">
        <button onClick={toggleTheme}>
          Switch to {isDarkValue ? "Light" : "Dark"} Theme
        </button>
      </div>
      {card}
      
      <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f5f5f5", borderRadius: "8px" }}>
        <h3 style={{ marginTop: 0 }}>How it works</h3>
        <pre style={{ background: "#fff", padding: "0.5rem", borderRadius: "4px", overflow: "auto", fontSize: "0.85rem" }}>{`// Define a service
class Theme extends Context.Tag("Theme")<
  Theme,
  ThemeConfig
>() {}

// Component that requires Theme
const ThemedCard = Effect.gen(function* () {
  const theme = yield* Theme  // R = Theme
  return <div style={{ color: theme.text }}>...</div>
})

// Provide the service
const card = yield* Effect.provide(
  ThemedCard,
  isDark ? DarkTheme : LightTheme
)`}</pre>
      </div>
    </div>
  )
})

// Mount the app with DevMode for debug observability
const container = document.getElementById("root")
if (container) {
  mount(container, <>
    {ThemeApp}
    <DevMode />
  </>)
}
