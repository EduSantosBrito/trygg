import { Component, Signal } from "trygg";
import { AppTheme } from "../services/theme";

const THEME_OPTIONS = [
  { value: "system", label: "System", description: "Follow your operating system preference" },
  { value: "dark", label: "Dark", description: "Always use dark theme" },
  { value: "light", label: "Light", description: "Always use light theme" },
] as const;

export default Component.gen(function* () {
  const { mode, preference, setPreference } = yield* AppTheme;

  // Derive checked state for each radio
  const isSystem = yield* Signal.derive(preference, (p) => p === "system");
  const isDark = yield* Signal.derive(preference, (p) => p === "dark");
  const isLight = yield* Signal.derive(preference, (p) => p === "light");

  const checkedMap = { system: isSystem, dark: isDark, light: isLight };

  return (
    <>
      <header className="content-header">
        <div className="content-header__left">
          <div className="content-header__title">
            <div className="content-header__icon">S</div>
            <h1 className="content-header__text">Settings</h1>
          </div>
        </div>
      </header>

      <main className="content-body">
        <div className="card" style={{ padding: "24px", maxWidth: "560px" }}>
          <h2 className="text-lg font-semibold mb-6" style={{ color: "var(--text-1)" }}>
            Appearance
          </h2>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: "12px" }}>
              Theme
            </legend>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {THEME_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="card card--interactive"
                  style={{
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option.value}
                    checked={checkedMap[option.value]}
                    onChange={() => setPreference(option.value)}
                    style={{ marginTop: "2px", accentColor: "var(--accent)" }}
                  />
                  <div>
                    <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
                      {option.label}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-3)", marginTop: "2px" }}>
                      {option.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <p className="text-sm mt-4" style={{ color: "var(--text-3)" }}>
              Current theme: <strong style={{ color: "var(--text-1)" }}>{mode}</strong>
            </p>
          </fieldset>
        </div>

        {/* Theme token preview */}
        <div className="card" style={{ padding: "24px", maxWidth: "560px", marginTop: "20px" }}>
          <h3
            className="text-xs font-semibold uppercase tracking-wider mb-4"
            style={{ color: "var(--text-3)", letterSpacing: "0.05em" }}
          >
            Token Preview
          </h3>
          <div style={{ display: "grid", gap: "12px" }}>
            {[
              { name: "--bg", label: "Background" },
              { name: "--surface", label: "Surface" },
              { name: "--text-1", label: "Text Primary" },
              { name: "--accent", label: "Accent" },
            ].map(({ name, label }) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    backgroundColor: `var(${name})`,
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                />
                <div>
                  <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
                    {label}
                  </div>
                  <code className="text-xs" style={{ color: "var(--text-3)" }}>
                    {name}
                  </code>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
});
