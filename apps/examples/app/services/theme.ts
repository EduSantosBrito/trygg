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

// Store signals are module-lifetime on purpose. Until provider Layer.effect
// lifetimes are cached across ordinary rerenders, stateful stores should use
// Signal.makeSync + Layer.succeed rather than rebuilding signals in Layer.effect.
const mode = Signal.makeSync<ThemeMode>("light");
const tokens = Signal.makeSync<ThemeTokens>(themeForMode("light"));
const themeName = Signal.makeSync("Light Theme");
const switchLabel = Signal.makeSync("Switch to Dark Theme");

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

export const ThemeStoreLive = Layer.succeed(ThemeStore, {
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
});
