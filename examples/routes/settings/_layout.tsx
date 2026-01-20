/**
 * Settings Layout
 *
 * Demonstrates the _layout.tsx pattern for shared navigation.
 * This layout wraps all /settings/* routes with a sidebar.
 */
import { Effect } from "effect";
import * as Router from "effect-ui/router";

const SettingsLayout = Effect.gen(function* () {
  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <h2>Settings</h2>
        <nav>
          <Router.Link to="/settings">Overview</Router.Link>
          <Router.Link to="/settings/profile">Profile</Router.Link>
          <Router.Link to="/settings/security">Security</Router.Link>
        </nav>
      </aside>
      <div className="settings-content">
        <Router.Outlet />
      </div>
    </div>
  );
});

export default SettingsLayout;
