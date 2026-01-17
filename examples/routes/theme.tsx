/**
 * Theme (Dependency Injection) Example
 *
 * Demonstrates:
 * - Context.Tag for defining services
 * - Effect.provide for dependency injection
 * - Layer for service implementation
 * - Swapping layers at runtime
 * - Component.gen API for typed props with auto layer inference
 */
import { Context, Effect, Layer } from "effect"
import { Signal, Component } from "effect-ui"

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

// =============================================================================
// Approach 1: Component.gen (no props)
// =============================================================================

// A component that uses the Theme service
// Note: R = Theme (has a requirement), becomes `theme` prop
const ThemedCard = Component.gen(function* () {
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
      <h3 style={{ color: theme.primary, marginTop: 0 }}>
        {theme.name} Theme
      </h3>
      <p>This card uses the injected theme service.</p>
      <p>
        Click "Switch to Dark/Light Theme" above to see the theme change.
      </p>
    </div>
  )
})

// =============================================================================
// Approach 2: Component.gen with props (auto layer inference)
// =============================================================================

// Component with typed props - Theme requirement becomes a `theme` prop
// TypeScript infers: { title: string, theme: Layer<Theme> }
// Note: Use curried syntax Component.gen<P>()(fn) to get full type inference
const ThemedTitle = Component.gen<{ title: string }>()(Props => function* () {
  const { title } = yield* Props
  const theme = yield* Theme
  return (
    <h3 style={{
      color: theme.primary,
      background: theme.background,
      padding: "0.5rem 1rem",
      borderRadius: "4px",
      display: "inline-block"
    }}>
      {title}
    </h3>
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

  return (
    <div className="example">
      <h2>Theme (Dependency Injection)</h2>
      <p className="description">Dependency injection with Effect.provide, swappable layers</p>
      
      <div className="theme-switcher">
        <button onClick={toggleTheme}>
          Switch to {isDarkValue ? "Light" : "Dark"} Theme
        </button>
      </div>


      <ThemedCard theme={currentTheme} />
      <div style={{ marginTop: "1rem" }}>
        <ThemedTitle title="Using Component API" theme={currentTheme} />
      </div>

      <div className="code-example">
        <h3>Two Approaches</h3>

        <h4>1. Component.gen (no props)</h4>
        <pre>{`// Component requires Theme - layer passed as prop
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div style={{ color: theme.text }}>...</div>
})

// TypeScript infers: { theme: Layer<Theme> }
<ThemedCard theme={themeLayer} />`}</pre>

        <h4 style={{ marginTop: "1rem" }}>2. Component.gen with props</h4>
        <pre>{`// Component with typed props - Theme becomes a prop
// Note: Use curried syntax for full type inference
const ThemedTitle = Component.gen<{ title: string }>()(Props => function* () {
  const { title } = yield* Props
  const theme = yield* Theme
  return <h3 style={{ color: theme.primary }}>{title}</h3>
})

// TypeScript infers: { title: string, theme: Layer<Theme> }
<ThemedTitle title="Hello" theme={themeLayer} />`}</pre>
      </div>
    </div>
  )
})

export default ThemeApp
