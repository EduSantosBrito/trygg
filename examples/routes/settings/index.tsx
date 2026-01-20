/**
 * Settings Overview Page
 *
 * Main settings page accessible at /settings
 */
import { Effect } from "effect";
import * as Router from "effect-ui/router";

const SettingsOverview = Effect.gen(function* () {
  return (
    <div className="settings-page">
      <h1>Settings Overview</h1>
      <p>Manage your account settings and preferences.</p>

      <div className="settings-cards">
        <div className="settings-card">
          <h3>Profile</h3>
          <p>Update your personal information and avatar.</p>
          <Router.Link to="/settings/profile">Go to Profile</Router.Link>
        </div>

        <div className="settings-card">
          <h3>Security</h3>
          <p>Manage your password and two-factor authentication.</p>
          <Router.Link to="/settings/security">Go to Security</Router.Link>
        </div>
      </div>
    </div>
  );
});

export default SettingsOverview;
