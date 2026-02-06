import { Component, Signal } from "trygg";
import { AppTheme } from "../services/theme";

export default Component.gen(function* () {
  const { mode, toggle } = yield* AppTheme;

  const modeLabel = yield* Signal.derive(mode, (m) =>
    m === "dark" ? "Dark" : "Light",
  );

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>

      <div className="space-y-6">
        <div className="p-4 border border-[var(--border)] rounded-lg bg-[var(--surface)]">
          <h2 className="text-lg font-medium mb-3">Appearance</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-sm text-[var(--text-2)]">Current: {modeLabel}</p>
            </div>
            <button
              onClick={toggle}
              className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90 transition-opacity"
            >
              Toggle theme
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});
