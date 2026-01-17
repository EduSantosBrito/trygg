/**
 * Counter Example
 *
 * Demonstrates:
 * - Component.gen for creating components
 * - Signal.make for reactive state
 * - Signal passed directly to JSX for fine-grained updates
 * - Event handlers that return Effects
 * - DevMode for debug observability
 */
import { Context, Effect, Layer } from "effect"
import { mount, Signal, DevMode, Component } from "effect-ui"

// =============================================================================
// Theme Service
// =============================================================================

interface ThemeConfig {
  readonly primary: string
  readonly background: string
  readonly text: string
}

class Theme extends Context.Tag("Theme")<Theme, ThemeConfig>() {}

const defaultTheme = Layer.succeed(Theme, {
  primary: "#0066cc",
  background: "#f5f5f5",
  text: "#333"
})

// =============================================================================
// Components using Component.gen
// =============================================================================

// Display component with typed props and theme requirement
// TypeScript infers: { value: Signal<number>, theme: Layer<Theme> }
const CountDisplay = Component.gen<{ value: Signal.Signal<number> }>()(Props => function* () {
  const { value } = yield* Props
  const theme = yield* Theme
  
  return (
    <span 
      className="count" 
      style={{ color: theme.primary, background: theme.background }}
    >
      {value}
    </span>
  )
})

// Button component with typed props and theme requirement
// TypeScript infers: { label: string, onClick: () => Effect<void>, theme: Layer<Theme> }
const CounterButton = Component.gen<{ 
  label: string
  onClick: () => Effect.Effect<void>
}>()(Props => function* () {
  const { label, onClick } = yield* Props
  const theme = yield* Theme
  
  return (
    <button 
      onClick={onClick}
      style={{ color: theme.text }}
    >
      {label}
    </button>
  )
})

// Main Counter using Component.gen (no props, but demonstrates the pattern)
const Counter = Component.gen(function* () {
  // Signal.make returns a Signal object
  // Pass it directly to JSX - updates are fine-grained!
  const count = yield* Signal.make(0)

  // Event handlers return Effects that update the signal
  const increment = () => Signal.update(count, (n: number) => n + 1)
  const decrement = () => Signal.update(count, (n: number) => n - 1)
  const reset = () => Signal.set(count, 0)

  return (
    <div className="example">
      <div className="counter">
        <CounterButton label="-" onClick={decrement} theme={defaultTheme} />
        <CountDisplay value={count} theme={defaultTheme} />
        <CounterButton label="+" onClick={increment} theme={defaultTheme} />
      </div>
      <div style={{ marginTop: "1rem" }}>
        <CounterButton label="Reset" onClick={reset} theme={defaultTheme} />
      </div>
      
      <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f9f9f9", borderRadius: "8px" }}>
        <h3 style={{ marginTop: 0 }}>Component.gen Pattern</h3>
        <pre style={{ background: "#fff", padding: "0.5rem", borderRadius: "4px", overflow: "auto", fontSize: "0.85rem" }}>{`// Component with props and theme requirement
const CountDisplay = Component.gen<{ 
  value: Signal<number> 
}>()(Props => function* () {
  const { value } = yield* Props
  const theme = yield* Theme  // Service requirement
  return <span style={{ color: theme.primary }}>{value}</span>
})

// TypeScript infers props: { value: Signal<number>, theme: Layer<Theme> }
<CountDisplay value={count} theme={themeLayer} />`}</pre>
      </div>
    </div>
  )
})

// Mount the app with DevMode for debug observability
const container = document.getElementById("root")
if (container) {
  mount(container, <>
    <Counter />
    <DevMode />
  </>)
}
