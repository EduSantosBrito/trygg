/**
 * Counter Example
 *
 * Demonstrates:
 * - Signal.make for reactive state
 * - Signal passed directly to JSX for fine-grained updates
 * - Event handlers that return Effects
 * - DevMode for debug observability
 */
import { Effect } from "effect"
import { mount, Signal, DevMode } from "effect-ui"

// Counter component using Signal for state
const Counter = Effect.gen(function* () {
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
        <button onClick={decrement}>-</button>
        <span className="count">{count}</span>
        <button onClick={increment}>+</button>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <button onClick={reset}>Reset</button>
      </div>
    </div>
  )
})

// Mount the app with DevMode for debug observability
const container = document.getElementById("root")
if (container) {
  mount(container, <>
    {Counter}
    <DevMode />
  </>)
}
