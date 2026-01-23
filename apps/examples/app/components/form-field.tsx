import { Effect, Option } from "effect";
import { Signal, Component, type ComponentProps } from "effect-ui";
import { FormTheme } from "../services/form";

export const FormField = Component.gen(function* (
  Props: ComponentProps<{
    label: string;
    type: "text" | "email" | "password";
    value: Signal.Signal<string>;
    error: Option.Option<string>;
    placeholder: string;
    hint?: string;
    onInput: (e: Event) => Effect.Effect<void>;
  }>,
) {
  const { label, type, value, error, placeholder, hint, onInput } = yield* Props;
  const theme = yield* FormTheme;

  return (
    <div className="mb-4">
      <label className="block mb-1 font-medium" style={{ color: theme.labelColor }}>
        {label}
      </label>
      <input
        className="py-2 px-2 text-base border border-gray-300 rounded w-full focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
        type={type}
        value={value}
        onInput={onInput}
        placeholder={placeholder}
        style={{
          borderColor: Option.isSome(error) ? theme.errorColor : theme.inputBorder,
        }}
      />
      {Option.isSome(error) && (
        <div className="text-red-600 text-sm mt-1" style={{ color: theme.errorColor }}>
          {error.value}
        </div>
      )}
      {hint && <small className="text-gray-500">{hint}</small>}
    </div>
  );
});
