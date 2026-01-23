import { Effect, Layer } from "effect";
import { Signal, Component } from "effect-ui";
import { CounterTheme } from "../services/counter";
import { CountDisplay } from "../components/counter/count-display";
import { CounterButton } from "../components/counter/counter-button";

const defaultTheme = Layer.succeed(CounterTheme, {
  primary: "#2563eb",
  background: "#eff6ff",
  text: "#1e40af",
});

const CounterPage = Component.gen(function* () {
  const count = yield* Signal.make(0);

  const increment = () => Signal.update(count, (n: number) => n + 1);
  const decrement = () => Signal.update(count, (n: number) => n - 1);
  const reset = () => Signal.set(count, 0);

  return Effect.gen(function* () {
    return (
      <div>
        <h2 className="m-0 mb-1 text-xl font-semibold">Counter</h2>
        <p className="text-gray-500 m-0 mb-8 text-sm">
          Basic state with Signal, event handlers as Effects
        </p>

        <div className="flex items-center justify-center gap-6 py-10">
          <CounterButton label="-" onClick={decrement} variant="icon" />
          <CountDisplay value={count} />
          <CounterButton label="+" onClick={increment} variant="icon" />
        </div>

        <div className="flex justify-center">
          <CounterButton label="Reset" onClick={reset} variant="text" />
        </div>
      </div>
    );
  }).pipe(Component.provide(defaultTheme));
});

export default CounterPage;
