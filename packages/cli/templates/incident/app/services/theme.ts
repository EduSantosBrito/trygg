import { Context, Effect, Layer } from "effect";
import { Signal } from "trygg";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type ThemeMode = "dark" | "light";

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

/**
 * Manages the active theme mode.
 *
 * Supports three DI patterns:
 * - **Layer swapping**: `AppThemeDark` vs `AppThemeLight` — same Tag, different config
 * - **Reactive state in a service**: `mode` is a `Signal` owned by the layer
 * - **Signal-as-JSX-prop**: pass `mode` to `<html data-theme={mode}>` for fine-grained DOM updates
 *
 * Color tokens live in CSS custom properties (styles.css) gated on `[data-theme]`.
 * The renderer subscribes to `mode` on the `<html>` element and updates `data-theme` reactively.
 */
export interface AppThemeService {
  /** Reactive theme mode — pass to JSX attributes for fine-grained updates */
  readonly mode: Signal.Signal<ThemeMode>;
  /** Toggles between dark/light */
  readonly toggle: Effect.Effect<void>;
}

export class AppTheme extends Context.Tag("AppTheme")<AppTheme, AppThemeService>() {}

// ---------------------------------------------------------------------------
// Layers — same Tag, different initial configuration
// ---------------------------------------------------------------------------

const make = (initial: ThemeMode): Layer.Layer<AppTheme> => {
  const mode = Signal.makeSync<ThemeMode>(initial);

  return Layer.succeed(AppTheme, {
    mode,
    toggle: Signal.update(mode, (m: ThemeMode): ThemeMode => (m === "dark" ? "light" : "dark")),
  });
};

/** Dark default. Swap with `AppThemeLight` to change the initial theme. */
export const AppThemeDark = make("dark");

/** Light default. Swap with `AppThemeDark` to change the initial theme. */
export const AppThemeLight = make("light");
