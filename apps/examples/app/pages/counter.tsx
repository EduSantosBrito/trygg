import { Layer } from "effect";
import { Signal, Component } from "trygg";
import { CounterTheme } from "../services/counter";
import { CountDisplay } from "../components/counter/count-display";
import { CounterButton } from "../components/counter/counter-button";

const defaultTheme = Layer.succeed(CounterTheme, {
  primary: "#2563eb",
  background: "#eff6ff",
  text: "#1e40af",
});

const ProvidedCounterButton = CounterButton.provide(defaultTheme);
const ProvidedCountDisplay = CountDisplay.provide(defaultTheme);

const CounterPage = Component.gen(function* () {
  const count = yield* Signal.make(0);

  const increment = () => Signal.update(count, (n: number) => n + 1);
  const decrement = () => Signal.update(count, (n: number) => n - 1);
  const reset = () => Signal.set(count, 0);

  return (
    <div>
      <h2 className="m-0 mb-1 text-xl font-semibold">Counter</h2>
      <p className="text-gray-500 m-0 mb-8 text-sm">
        Basic state with Signal, event handlers as Effects
      </p>

      <div className="flex items-center justify-center gap-6 py-10">
        <ProvidedCounterButton label="-" onClick={decrement} variant="icon" />
        <ProvidedCountDisplay value={count} />
        <ProvidedCounterButton label="+" onClick={increment} variant="icon" />
      </div>

      <div className="flex justify-center">
        <ProvidedCounterButton label="Reset" onClick={reset} variant="text" />
      </div>
    </div>
  );
});

export default CounterPage;
