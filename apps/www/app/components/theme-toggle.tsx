import { Effect, Scope } from "effect";
import { Component, Signal } from "trygg";

import { getTheme, THEME_CHANGE_EVENT, toggleTheme, type Theme } from "../lib/theme";

export const ThemeToggle = Component.gen(function* () {
  const theme = yield* Signal.make<Theme>(getTheme());

  if (typeof window !== "undefined") {
    const syncTheme = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : getTheme();
      Effect.runFork(Signal.set(theme, detail));
    };

    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);

    const componentScope = yield* Signal.CurrentComponentScope;
    if (componentScope === null) {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => window.removeEventListener(THEME_CHANGE_EVENT, syncTheme)),
      );
    } else {
      yield* Scope.addFinalizer(
        componentScope,
        Effect.sync(() => window.removeEventListener(THEME_CHANGE_EVENT, syncTheme)),
      );
    }
  }

  const label = yield* Signal.derive(theme, (value) =>
    value === "dark" ? "Switch to light theme" : "Switch to dark theme",
  );

  const handleToggle = Effect.fnUntraced(function* () {
    const next = toggleTheme();
    yield* Signal.set(theme, next);
  });

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={handleToggle}
      aria-label={label}
      aria-live="polite"
    >
      <span className="theme-toggle__icon theme-toggle__icon--sun" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 2.5v2M10 15.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M5.4 14.6l1.4-1.4M13.2 6.8l1.4-1.4" />
        </svg>
      </span>
      <span className="theme-toggle__icon theme-toggle__icon--moon" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <path d="M14.7 12.4a5.8 5.8 0 0 1-7.1-7.1 6.2 6.2 0 1 0 7.1 7.1Z" />
        </svg>
      </span>
    </button>
  );
});
