/**
 * effect-ui Counter Example
 *
 * This example demonstrates:
 * - Signal.make for reactive state
 * - Signal passed directly to JSX for fine-grained updates
 * - Event handlers that return Effects
 */
import { Effect } from "effect"
import { mount, Signal } from "effect-ui"

// Counter component using Signal for state
const Counter = Effect.gen(function* () {
  // Signal.make returns a Signal object
  // Pass it directly to JSX - updates are fine-grained!
  const count = yield* Signal.make(0)

  // Event handlers return Effects that update the signal
  const increment = () => Signal.update(count, (n: number) => n + 1)
  const decrement = () => Signal.update(count, (n: number) => n - 1)

  return (
    <div>
      <h1>effect-ui Counter</h1>
      <div className="counter">
        <button onClick={decrement}>-</button>
        <span className="count">{count}</span>
        <button onClick={increment}>+</button>
      </div>
      <p>
        Edit <code>src/main.tsx</code> to get started.
      </p>
    </div>
  )
})

// Mount the app
const container = document.getElementById("root")
if (container) {
  mount(container, Counter)
}
