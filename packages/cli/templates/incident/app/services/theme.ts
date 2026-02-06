import { Context, Effect, Layer, Scope } from "effect";
import { Signal } from "trygg";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type ThemeMode = "dark" | "light";
export type ThemePreference = ThemeMode | "system";

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
  /** User preference — explicit theme or system */
  readonly preference: Signal.Signal<ThemePreference>;
  /** Set user preference and persist */
  readonly setPreference: (preference: ThemePreference) => Effect.Effect<void>;
  /** Toggles between dark/light */
  readonly toggle: Effect.Effect<void>;
}

export class AppTheme extends Context.Tag("AppTheme")<AppTheme, AppThemeService>() {}

// ---------------------------------------------------------------------------
// Layers — same Tag, different initial configuration
// ---------------------------------------------------------------------------

const STORAGE_KEY = "theme";

const parsePreference = (value: string | null): ThemePreference => {
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }
  return "system";
};

const readStoredPreference = (): ThemePreference => {
  if (typeof localStorage === "undefined") {
    return "system";
  }

  try {
    return parsePreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
};

const persistPreference = (preference: ThemePreference): Effect.Effect<void> =>
  Effect.sync(() => {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      return;
    }
  });

const resolveSystemMode = (fallback: ThemeMode): ThemeMode => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return fallback;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const resolveMode = (preference: ThemePreference, fallback: ThemeMode): ThemeMode =>
  preference === "system" ? resolveSystemMode(fallback) : preference;

const subscribeToSystemTheme = (
  preference: Signal.Signal<ThemePreference>,
  mode: Signal.Signal<ThemeMode>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return undefined;
      }

      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        const currentPreference = Signal.peekSync(preference);
        if (currentPreference !== "system") {
          return;
        }

        const nextMode: ThemeMode = mediaQuery.matches ? "dark" : "light";
        Effect.runSync(Signal.set(mode, nextMode));
      };

      mediaQuery.addEventListener("change", onChange);
      return { mediaQuery, onChange };
    }),
    (state) =>
      Effect.sync(() => {
        if (state === undefined) {
          return;
        }
        state.mediaQuery.removeEventListener("change", state.onChange);
      }),
  ).pipe(Effect.asVoid);

const make = (fallback: ThemeMode): Layer.Layer<AppTheme> =>
  Layer.scoped(
    AppTheme,
    Effect.gen(function* () {
      const initialPreference = readStoredPreference();
      const preference = Signal.makeSync<ThemePreference>(initialPreference);
      const mode = Signal.makeSync<ThemeMode>(resolveMode(initialPreference, fallback));

      const setPreference = (next: ThemePreference): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Signal.set(preference, next);
          yield* Signal.set(mode, resolveMode(next, fallback));
          yield* persistPreference(next);
        });

      yield* subscribeToSystemTheme(preference, mode);

      return {
        mode,
        preference,
        setPreference,
        toggle: Effect.gen(function* () {
          const next: ThemeMode = (yield* Signal.get(mode)) === "dark" ? "light" : "dark";
          yield* setPreference(next);
        }),
      };
    }),
  );

/** Dark fallback for non-browser environments. */
export const AppThemeDark = make("dark");

/** Light fallback for non-browser environments. */
export const AppThemeLight = make("light");
