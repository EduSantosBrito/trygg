import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { Signal } from "trygg";

export type DashboardThemeMode = "light" | "dark";

export interface DashboardThemeTokens {
  readonly name: string;
  readonly primary: string;
  readonly secondary: string;
  readonly background: string;
  readonly cardBackground: string;
  readonly text: string;
  readonly textMuted: string;
}

const lightTheme: DashboardThemeTokens = {
  name: "Light",
  primary: "#0066cc",
  secondary: "#6c757d",
  background: "#f8f9fa",
  cardBackground: "#ffffff",
  text: "#212529",
  textMuted: "#6c757d",
};

const darkTheme: DashboardThemeTokens = {
  name: "Dark",
  primary: "#4da6ff",
  secondary: "#adb5bd",
  background: "#1a1a2e",
  cardBackground: "#16213e",
  text: "#e9ecef",
  textMuted: "#adb5bd",
};

const themeForMode = (mode: DashboardThemeMode): DashboardThemeTokens =>
  mode === "dark" ? darkTheme : lightTheme;

const switchLabelForMode = (mode: DashboardThemeMode): string =>
  `Switch to ${mode === "dark" ? "Light" : "Dark"}`;

export class DashboardTheme extends Context.Service<
  DashboardTheme,
  {
    readonly mode: Signal.Signal<DashboardThemeMode>;
    readonly tokens: Signal.Signal<DashboardThemeTokens>;
    readonly switchLabel: Signal.Signal<string>;
    readonly toggle: () => Effect.Effect<void>;
  }
>()("examples/dashboard/DashboardTheme") {}

export const DashboardThemeLive = Layer.effect(
  DashboardTheme,
  Effect.gen(function* () {
    const mode = yield* Signal.make<DashboardThemeMode>("light");
    const tokens = yield* Signal.make<DashboardThemeTokens>(themeForMode("light"));
    const switchLabel = yield* Signal.make(switchLabelForMode("light"));

    return {
      mode,
      tokens,
      switchLabel,
      toggle: () =>
        Effect.gen(function* () {
          const current = yield* Signal.peek(mode);
          const next: DashboardThemeMode = current === "dark" ? "light" : "dark";
          yield* Signal.set(mode, next);
          yield* Signal.set(tokens, themeForMode(next));
          yield* Signal.set(switchLabel, switchLabelForMode(next));
        }),
    };
  }).pipe(Effect.annotateLogs({ service: "DashboardTheme" })),
);

export class Analytics extends Context.Service<
  Analytics,
  {
    readonly track: (event: string, data?: Record<string, unknown>) => Effect.Effect<void>;
  }
>()("examples/dashboard/Analytics") {}

export class Logger extends Context.Service<
  Logger,
  {
    readonly info: (message: string) => Effect.Effect<void>;
    readonly warn: (message: string) => Effect.Effect<void>;
  }
>()("examples/dashboard/Logger") {}
