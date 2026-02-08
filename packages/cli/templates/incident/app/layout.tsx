import "../styles.css";
import { Effect, Scope } from "effect";
import { Component, DevMode, Signal } from "trygg";
import * as Router from "trygg/router";
import { ApiClientLive } from "./api";
import { AppTheme, AppThemeDark } from "./services/theme";
import { CommandPalette } from "./components/command-palette";

export default Component.gen(function* () {
  const { mode } = yield* AppTheme;
  const scope = yield* Scope.Scope;

  // Command palette state
  const cmdkOpen = yield* Signal.make(false);
  const openCmdk = () => Signal.set(cmdkOpen, true);
  const closeCmdk = () => Signal.set(cmdkOpen, false);

  // Global keyboard shortcut for ⌘K / Ctrl+K
  yield* Effect.sync(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        Effect.runFork(
          Signal.get(cmdkOpen).pipe(
            Effect.flatMap((isOpen) =>
              isOpen ? Signal.set(cmdkOpen, false) : Signal.set(cmdkOpen, true),
            ),
          ),
        );
      }
    };
    document.addEventListener("keydown", handler);
    // Cleanup on scope close
    Effect.runFork(
      Scope.addFinalizer(scope, Effect.sync(() => document.removeEventListener("keydown", handler))),
    );
  });

  // Reactive active-state signals for nav links
  const homeActive = yield* Router.isActive("/", { exact: true });
  const incidentsActive = yield* Router.isActive("/incidents");
  const settingsActive = yield* Router.isActive("/settings", { exact: true });

  // Derive data-active strings
  const toDataActive = (active: boolean) => (active ? "true" : "false");
  const homeDataActive = yield* Signal.derive(homeActive, toDataActive);
  const incidentsDataActive = yield* Signal.derive(incidentsActive, toDataActive);
  const settingsDataActive = yield* Signal.derive(settingsActive, toDataActive);

  return (
    <html lang="en" data-theme={mode}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <title>Incident Commander</title>
        <meta name="description" content="Incident management built with trygg" />
      </head>
      <body>
        <DevMode />
        <div className="app-shell">
          {/* Dark nav rail */}
          <aside className="nav-rail">
            <div className="nav-rail__header">
              <div className="nav-rail__logo">
                <span className="nav-rail__logo-icon" aria-hidden="true" />
              </div>
              <span className="nav-rail__brand">trygg</span>
            </div>

            <button
              type="button"
              className="nav-rail__search"
              aria-label="Search or jump to…"
              onClick={openCmdk}
            >
              <span className="nav-rail__search-icon" aria-hidden="true" />
              <span className="nav-rail__search-text">Search</span>
              <kbd className="nav-rail__search-kbd">K</kbd>
            </button>

            <nav className="nav-rail__nav" aria-label="Main">
              <Router.Link
                to="/"
                className="nav-rail__link"
                data-active={homeDataActive}
              >
                <span className="nav-rail__link-icon nav-rail__link-icon--home" aria-hidden="true" />
                Home
              </Router.Link>
              <Router.Link
                to="/incidents"
                className="nav-rail__link"
                data-active={incidentsDataActive}
              >
                <span className="nav-rail__link-icon nav-rail__link-icon--alert" aria-hidden="true" />
                Incidents
              </Router.Link>
              <Router.Link
                to="/settings"
                className="nav-rail__link"
                data-active={settingsDataActive}
              >
                <span className="nav-rail__link-icon nav-rail__link-icon--settings" aria-hidden="true" />
                Settings
              </Router.Link>
            </nav>

            <div className="nav-rail__footer">
              <div className="nav-rail__user">
                <div className="nav-rail__avatar">
                  <span className="nav-rail__avatar-icon" aria-hidden="true" />
                </div>
                <div className="nav-rail__user-info">
                  <div className="nav-rail__user-name">Demo User</div>
                  <div className="nav-rail__user-role">Engineer</div>
                </div>
              </div>
            </div>
          </aside>

          {/* Main content area */}
          <div className="content-area">
            <Router.Outlet />
          </div>
        </div>

        {/* Command Palette */}
        <CommandPalette open={cmdkOpen} onClose={closeCmdk} />
      </body>
    </html>
  );
}).provide([AppThemeDark, ApiClientLive]);
