/**
 * effect-ui Examples Application
 *
 * A single routed app showcasing all effect-ui features.
 * Uses file-based routing with the vite plugin.
 */
import { mount, DevMode, Component } from "effect-ui"
import * as Router from "effect-ui/router"
import { routes } from "virtual:effect-ui-routes"

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
          <Router.NavLink to="/counter" activeClassName="active">Counter</Router.NavLink>
          <Router.NavLink to="/todo" activeClassName="active">Todo</Router.NavLink>
          <Router.NavLink to="/theme" activeClassName="active">Theme</Router.NavLink>
          <Router.NavLink to="/form" activeClassName="active">Form</Router.NavLink>
          <Router.NavLink to="/error-boundary" activeClassName="active">Errors</Router.NavLink>
          <Router.NavLink to="/dashboard" activeClassName="active">Dashboard</Router.NavLink>
          <Router.NavLink to="/users" activeClassName="active">Users</Router.NavLink>
          <Router.NavLink to="/settings" activeClassName="active">Settings</Router.NavLink>
        </nav>
      </header>

      <main className="app-content">
        <Router.Outlet routes={routes} />
      </main>
    </div>
  )
})

// Mount the app - Router.browserLayer is included by default!
const container = document.getElementById("root")
if (container) {
  mount(
    container,
    <>
      <App />
      <DevMode />
    </>
  )
}
