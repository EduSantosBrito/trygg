import { Effect, Layer, Scope } from "effect";
import * as Context from "effect/Context";
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
export class AppTheme extends Context.Service<
  AppTheme,
  {
    /** Reactive theme mode — pass to JSX attributes for fine-grained updates */
    readonly mode: Signal.Signal<ThemeMode>;
    /** User preference — explicit theme or system */
    readonly preference: Signal.Signal<ThemePreference>;
    /** Set user preference and persist */
    readonly setPreference: (preference: ThemePreference) => Effect.Effect<void>;
    /** Toggles between dark/light */
    readonly toggle: Effect.Effect<void>;
  }
>()("trygg/AppTheme") {}

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

const readCookie = (key: string): string | null => {
  if (typeof document === "undefined") {
    return null;
  }
  const prefix = `${key}=`;
  const entry = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix));
  return entry === undefined ? null : decodeURIComponent(entry.slice(prefix.length));
};

const writeCookie = (key: string, value: string): void => {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${key}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
};

const readStoredPreference: Effect.Effect<ThemePreference> = Effect.sync(() =>
  parsePreference(readCookie(STORAGE_KEY)),
);

const persistPreference = (preference: ThemePreference): Effect.Effect<void> =>
  Effect.sync(() => writeCookie(STORAGE_KEY, preference));

const resolveSystemMode = (fallback: ThemeMode): Effect.Effect<ThemeMode> =>
  Effect.sync(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return fallback;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

const resolveMode = (preference: ThemePreference, fallback: ThemeMode): Effect.Effect<ThemeMode> =>
  preference === "system" ? resolveSystemMode(fallback) : Effect.succeed(preference);

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
        Effect.runFork(
          Effect.gen(function* () {
            const currentPreference = yield* Signal.peek(preference);
            if (currentPreference !== "system") {
              return;
            }

            const nextMode: ThemeMode = mediaQuery.matches ? "dark" : "light";
            yield* Signal.set(mode, nextMode);
          }),
        );
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

const make = (fallback: ThemeMode): Layer.Layer<AppTheme, Signal.SignalScopeError> =>
  Layer.effect(
    AppTheme,
    Effect.gen(function* () {
      const initialPreference = yield* readStoredPreference;
      const preference = yield* Signal.make<ThemePreference>(initialPreference);
      const initialMode = yield* resolveMode(initialPreference, fallback);
      const mode = yield* Signal.make<ThemeMode>(initialMode);

      const setPreference = Effect.fn("AppTheme.setPreference")(function* (next: ThemePreference) {
        yield* Signal.set(preference, next);
        const nextMode = yield* resolveMode(next, fallback);
        yield* Signal.set(mode, nextMode);
        yield* persistPreference(next);
      });

      yield* subscribeToSystemTheme(preference, mode);

      const toggle = Effect.gen(function* () {
        const next: ThemeMode = (yield* Signal.peek(mode)) === "dark" ? "light" : "dark";
        yield* setPreference(next);
      }).pipe(Effect.withSpan("AppTheme.toggle"));

      return {
        mode,
        preference,
        setPreference,
        toggle,
      };
    }).pipe(Effect.annotateLogs({ service: "AppTheme" })),
  );

/** Dark fallback for non-browser environments. */
export const AppThemeDark = make("dark");

/** Light fallback for non-browser environments. */
export const AppThemeLight = make("light");
