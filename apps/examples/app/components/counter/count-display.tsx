import { Signal, Component, type ComponentProps } from "effect-ui";
import { CounterTheme } from "../../services/counter";

export const CountDisplay = Component.gen(function* (
  Props: ComponentProps<{ value: Signal.Signal<number> }>,
) {
  const { value } = yield* Props;
  const theme = yield* CounterTheme;

  return (
    <span
      className="inline-flex items-center justify-center min-w-20 h-20 text-4xl font-bold rounded-xl tabular-nums"
      style={{ color: theme.primary, background: theme.background }}
    >
      {value}
    </span>
  );
});
