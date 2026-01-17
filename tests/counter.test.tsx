/**
 * Counter Example & Tests
 *
 * Demonstrates the effect-ui programming model:
 * - Components are Effects with R = never
 * - State management with Signal (fine-grained reactivity)
 * - Event handlers return Effects
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Signal from "../src/Signal.js"
import { render, click, waitFor } from "../src/testing.js"

/**
 * Counter component
 *
 * Uses Signal.make to create a reactive signal.
 * The signal is passed directly to JSX for fine-grained updates.
 * Returns an Effect<Element, never, never> - no external requirements.
 */
const Counter = Effect.gen(function* () {
  const count = yield* Signal.make(0)

  // Event handlers return Effects that update the signal
  const increment = () => Signal.update(count, (n: number) => n + 1)
  const decrement = () => Signal.update(count, (n: number) => n - 1)
  const reset = () => Signal.set(count, 0)

  return (
    <div className="counter" data-testid="counter">
      <span data-testid="count">{count}</span>
      <button onClick={decrement} data-testid="decrement">
        -
      </button>
      <button onClick={reset} data-testid="reset">
        Reset
      </button>
      <button onClick={increment} data-testid="increment">
        +
      </button>
    </div>
  )
})

/**
 * Counter with initial value passed as parameter
 */
const CounterWithInitial = Effect.fn("CounterWithInitial")(function* (
  initialValue: number
) {
  const count = yield* Signal.make(initialValue)

  const increment = () => Signal.update(count, (n: number) => n + 1)
  const decrement = () => Signal.update(count, (n: number) => n - 1)
  const reset = () => Signal.set(count, 0)

  return (
    <div className="counter" data-testid="counter">
      <span data-testid="count">{count}</span>
      <button onClick={decrement} data-testid="decrement">
        -
      </button>
      <button onClick={reset} data-testid="reset">
        Reset
      </button>
      <button onClick={increment} data-testid="increment">
        +
      </button>
    </div>
  )
})

describe("Counter", () => {
  it.scoped("renders initial count", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(Counter)

      const countElement = getByTestId("count")
      expect(countElement.textContent).toBe("0")
    })
  )

  it.scoped("renders with custom initial value", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(CounterWithInitial(42))

      const countElement = getByTestId("count")
      expect(countElement.textContent).toBe("42")
    })
  )

  it.scoped("has increment button", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(Counter)

      const incrementButton = getByTestId("increment")
      expect(incrementButton.textContent).toBe("+")
    })
  )

  it.scoped("has decrement button", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(Counter)

      const decrementButton = getByTestId("decrement")
      expect(decrementButton.textContent).toBe("-")
    })
  )

  it.scoped("has reset button", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(Counter)

      const resetButton = getByTestId("reset")
      expect(resetButton.textContent).toBe("Reset")
    })
  )

  // Reactivity tests - verify DOM updates when signals change

  it.scoped("increments count when + is clicked", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(Counter)

      expect(getByTestId("count").textContent).toBe("0")

      yield* click(getByTestId("increment"))

      // Wait for fine-grained update (Signal subscription)
      yield* waitFor(() => {
        expect(getByTestId("count").textContent).toBe("1")
        return true
      })
    })
  )

  it.scoped("decrements count when - is clicked", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(CounterWithInitial(5))

      expect(getByTestId("count").textContent).toBe("5")

      yield* click(getByTestId("decrement"))

      yield* waitFor(() => {
        expect(getByTestId("count").textContent).toBe("4")
        return true
      })
    })
  )

  it.scoped("resets count when Reset is clicked", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(CounterWithInitial(42))

      expect(getByTestId("count").textContent).toBe("42")

      yield* click(getByTestId("reset"))

      yield* waitFor(() => {
        expect(getByTestId("count").textContent).toBe("0")
        return true
      })
    })
  )

  it.scoped("handles multiple clicks", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(Counter)

      // Click increment 3 times
      yield* click(getByTestId("increment"))
      yield* waitFor(() => {
        expect(getByTestId("count").textContent).toBe("1")
        return true
      })

      yield* click(getByTestId("increment"))
      yield* waitFor(() => {
        expect(getByTestId("count").textContent).toBe("2")
        return true
      })

      yield* click(getByTestId("increment"))
      yield* waitFor(() => {
        expect(getByTestId("count").textContent).toBe("3")
        return true
      })
    })
  )
})

describe("Component composition", () => {
  it.scoped("composes components with yield*", () =>
    Effect.gen(function* () {
      // Define a Header component
      const Header = Effect.succeed(
        <header data-testid="header">
          <h1>My App</h1>
        </header>
      )

      // Define a Footer component
      const Footer = Effect.succeed(
        <footer data-testid="footer">
          <p>Copyright 2024</p>
        </footer>
      )

      // Compose with yield*
      const App = Effect.gen(function* () {
        const header = yield* Header
        const footer = yield* Footer

        return (
          <div data-testid="app">
            {header}
            <main data-testid="main">Content</main>
            {footer}
          </div>
        )
      })

      const { getByTestId } = yield* render(App)

      expect(getByTestId("app")).toBeDefined()
      expect(getByTestId("header")).toBeDefined()
      expect(getByTestId("main")).toBeDefined()
      expect(getByTestId("footer")).toBeDefined()
    })
  )
})

describe("Event handlers", () => {
  it.scoped("event handlers are Effects", () =>
    Effect.gen(function* () {
      let clicked = false

      const Button = Effect.succeed(
        <button
          data-testid="btn"
          onClick={() =>
            Effect.sync(() => {
              clicked = true
            })
          }
        >
          Click me
        </button>
      )

      const { getByTestId } = yield* render(Button)

      const button = getByTestId("btn")
      yield* click(button)

      expect(clicked).toBe(true)
    })
  )
})
