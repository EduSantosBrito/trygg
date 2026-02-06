import "../styles.css";
import { Component, Signal } from "trygg";
import * as Router from "trygg/router";
import { ApiClientLive } from "./api";
import { AppTheme, AppThemeDark } from "./services/theme";

export default Component.gen(function* () {
  const { mode, toggle } = yield* AppTheme;

  const toggleLabel = yield* Signal.derive(mode, (m) =>
    m === "dark" ? "Switch to light theme" : "Switch to dark theme",
  );

  // Reactive active-state signals — fine-grained DOM updates, no layout re-render
  const incidentsActive = yield* Router.isActive("/incidents");
  const settingsActive = yield* Router.isActive("/settings", { exact: true });

  // Derive string attributes from boolean signals for data-active / aria-current
  const toDataActive = (active: boolean) => (active ? "true" : "");
  const toAriaCurrent = (active: boolean) => (active ? "page" : "false");
  const incidentsDataActive = yield* Signal.derive(incidentsActive, toDataActive);
  const incidentsAriaCurrent = yield* Signal.derive(incidentsActive, toAriaCurrent);
  const settingsDataActive = yield* Signal.derive(settingsActive, toDataActive);
  const settingsAriaCurrent = yield* Signal.derive(settingsActive, toAriaCurrent);

  return (
    <html lang="en" data-theme={mode}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <title>trygg app</title>
        <meta name="description" content="Built with trygg - Effect-native UI framework" />
      </head>
      <body className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
        <header className="border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="max-w-4xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between">
            <div className="flex items-center gap-4 sm:gap-8">
              <Router.Link
                to="/"
                className="text-lg font-semibold no-underline flex items-center gap-1.5"
              >
                <span className="text-[var(--signal)]">*</span>
                <span className="text-[var(--text-1)]">trygg</span>
              </Router.Link>

              <nav className="flex items-center gap-1" aria-label="Main">
                <Router.Link
                  to="/incidents"
                  className="nav-link"
                  data-active={incidentsDataActive}
                  aria-current={incidentsAriaCurrent}
                >
                  Incidents
                </Router.Link>
                <Router.Link
                  to="/settings"
                  className="nav-link"
                  data-active={settingsDataActive}
                  aria-current={settingsAriaCurrent}
                >
                  Settings
                </Router.Link>
              </nav>
            </div>

            <button className="theme-toggle" onClick={toggle} aria-label={toggleLabel}>
              <span className="theme-icon theme-icon-moon" />
              <span className="theme-icon theme-icon-sun" />
            </button>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-8 py-8">
          <Router.Outlet />
        </main>
      </body>
    </html>
  );
}).provide([AppThemeDark, ApiClientLive]);
