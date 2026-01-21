/**
 * effect-ui Examples Application
 *
 * A single routed app showcasing all effect-ui features.
 * Uses file-based routing with the vite plugin.
 */
import { mount, DevMode, Component } from "effect-ui";
import * as Router from "effect-ui/router";
import { routes } from "virtual:effect-ui-routes";

// =============================================================================
// Main App with Router
// =============================================================================

const App = Component.gen(function* () {
  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <Router.Link to="/">effect-ui</Router.Link>
        </h1>
        <nav>
          <Router.Link to="/counter">Counter</Router.Link>
          <Router.Link to="/suspend">Suspend</Router.Link>
          <Router.Link to="/todo">Todo</Router.Link>
          <Router.Link to="/theme">Theme</Router.Link>
          <Router.Link to="/form">Form</Router.Link>
          <Router.Link to="/error-boundary">Errors</Router.Link>
          <Router.Link to="/dashboard">Dashboard</Router.Link>
          <Router.Link to="/users">Users</Router.Link>
          <Router.Link to="/settings">Settings</Router.Link>
        </nav>
      </header>

      <main className="app-content">
        <Router.Outlet routes={routes} />
      </main>
    </div>
  );
});

// Mount the app - Router.browserLayer is included by default!
// NOTE: DevMode must be BEFORE App to capture initial render logs
const container = document.getElementById("root");
if (container) {
  mount(
    container,
    <>
      <DevMode />
      <App />
    </>,
  );
}
