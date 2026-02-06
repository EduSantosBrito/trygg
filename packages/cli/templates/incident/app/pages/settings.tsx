import { Component, Signal } from "trygg";
import { AppTheme } from "../services/theme";

// ---------------------------------------------------------------------------
// Token definitions for preview
// ---------------------------------------------------------------------------

const PREVIEW_TOKENS = [
  { name: "--bg", label: "Background" },
  { name: "--surface", label: "Surface" },
  { name: "--text-1", label: "Text" },
  { name: "--accent", label: "Accent" },
  { name: "--signal", label: "Signal" },
] as const;

// ---------------------------------------------------------------------------
// ThemePreview — demonstrates DI by yielding AppTheme
// ---------------------------------------------------------------------------

const ThemePreview = Component.gen(function* () {
  const { mode } = yield* AppTheme;

  return (
    <div className="mt-6 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-2)] mb-4">
        Token Preview — {mode}
      </h3>
      <div className="grid gap-3">
        {PREVIEW_TOKENS.map(({ name, label }) => (
          <div key={name} className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded border border-[var(--border)] shrink-0"
              style={{ backgroundColor: `var(${name})` }}
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-1)]">{label}</p>
              <p className="text-xs font-mono text-[var(--text-2)]">{name}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

export default Component.gen(function* () {
  const { mode, preference, setPreference } = yield* AppTheme;

  const isSystem = yield* Signal.derive(preference, (p) => p === "system");
  const isDark = yield* Signal.derive(preference, (p) => p === "dark");
  const isLight = yield* Signal.derive(preference, (p) => p === "light");

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>

      <div className="space-y-6">
        <div className="p-4 border border-[var(--border)] rounded-lg bg-[var(--surface)]">
          <h2 className="text-lg font-medium mb-4">Appearance</h2>

          <fieldset className="border-0 p-0 m-0">
            <legend className="text-sm font-medium text-[var(--text-1)] mb-3">
              Theme
            </legend>
            <div className="flex gap-4">
              <label className="radio-option">
                <input
                  type="radio"
                  name="theme"
                  value="system"
                  checked={isSystem}
                  onChange={() => setPreference("system")}
                  className="radio-input"
                />
                <span className="radio-label">System</span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="theme"
                  value="dark"
                  checked={isDark}
                  onChange={() => setPreference("dark")}
                  className="radio-input"
                />
                <span className="radio-label">Dark</span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="theme"
                  value="light"
                  checked={isLight}
                  onChange={() => setPreference("light")}
                  className="radio-input"
                />
                <span className="radio-label">Light</span>
              </label>
            </div>

            <p className="text-sm text-[var(--text-2)] mt-3">
              Current resolved mode: <strong className="text-[var(--text-1)]">{mode}</strong>
            </p>
          </fieldset>

          <ThemePreview />
        </div>
      </div>
    </section>
  );
});
