import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { Signal } from "trygg";

export type ThemeMode = "light" | "dark";

export interface ThemeTokens {
  readonly name: string;
  readonly background: string;
  readonly text: string;
  readonly primary: string;
  readonly border: string;
}

const lightTheme: ThemeTokens = {
  name: "Light",
  background: "#ffffff",
  text: "#333333",
  primary: "#0066cc",
  border: "#e0e0e0",
};

const darkTheme: ThemeTokens = {
  name: "Dark",
  background: "#1a1a2e",
  text: "#eaeaea",
  primary: "#4da6ff",
  border: "#333355",
};

const themeForMode = (mode: ThemeMode): ThemeTokens => (mode === "light" ? lightTheme : darkTheme);

export class ThemeStore extends Context.Service<
  ThemeStore,
  {
    readonly mode: Signal.Signal<ThemeMode>;
    readonly tokens: Signal.Signal<ThemeTokens>;
    readonly themeName: Signal.Signal<string>;
    readonly switchLabel: Signal.Signal<string>;
    readonly toggle: () => Effect.Effect<void>;
  }
>()("examples/ThemeStore") {}

export const ThemeStoreLive = Layer.effect(
  ThemeStore,
  Effect.gen(function* () {
    const mode = yield* Signal.make<ThemeMode>("light");
    const tokens = yield* Signal.make<ThemeTokens>(themeForMode("light"));
    const themeName = yield* Signal.make("Light Theme");
    const switchLabel = yield* Signal.make("Switch to Dark Theme");

    return {
      mode,
      tokens,
      themeName,
      switchLabel,
      toggle: () =>
        Effect.gen(function* () {
          const current = yield* Signal.peek(mode);
          const next: ThemeMode = current === "light" ? "dark" : "light";
          const nextTokens = themeForMode(next);
          yield* Signal.set(mode, next);
          yield* Signal.set(tokens, nextTokens);
          yield* Signal.set(themeName, `${nextTokens.name} Theme`);
          yield* Signal.set(switchLabel, `Switch to ${next === "dark" ? "Light" : "Dark"} Theme`);
        }),
    };
  }).pipe(Effect.annotateLogs({ service: "ThemeStore" })),
);
