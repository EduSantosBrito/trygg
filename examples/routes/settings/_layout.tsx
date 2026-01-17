/**
 * Settings Layout
 * 
 * Demonstrates the _layout.tsx pattern for shared navigation.
 * This layout wraps all /settings/* routes with a sidebar.
 */
import { Effect } from "effect"
import * as Router from "effect-ui/router"

const SettingsLayout = Effect.gen(function* () {
  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <h2>Settings</h2>
        <nav>
          <Router.NavLink to="/settings" activeClassName="active" exact>
            Overview
          </Router.NavLink>
          <Router.NavLink to="/settings/profile" activeClassName="active">
            Profile
          </Router.NavLink>
          <Router.NavLink to="/settings/security" activeClassName="active">
            Security
          </Router.NavLink>
        </nav>
      </aside>
      <div className="settings-content">
        <Router.Outlet />
      </div>
    </div>
  )
})

export default SettingsLayout
