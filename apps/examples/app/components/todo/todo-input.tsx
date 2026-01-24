import { Effect } from "effect";
import { Signal, Component, type ComponentProps } from "trygg";
import { TodoTheme } from "../../services/todo";

export const TodoInput = Component.gen(function* (
  Props: ComponentProps<{
    value: Signal.Signal<string>;
    onSubmit: () => Effect.Effect<void>;
    onInput: (e: Event) => Effect.Effect<void>;
  }>,
) {
  const { value, onSubmit, onInput } = yield* Props;
  const theme = yield* TodoTheme;

  const handleSubmit = (e: Event) =>
    Effect.sync(() => e.preventDefault()).pipe(Effect.flatMap(() => onSubmit()));

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 py-2 px-2 text-base border border-gray-300 rounded w-full focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
          type="text"
          value={value}
          onInput={onInput}
          placeholder="What needs to be done?"
        />
        <button
          className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
          type="submit"
          style={{ background: theme.primaryColor, color: "white" }}
        >
          Add
        </button>
      </div>
    </form>
  );
});
