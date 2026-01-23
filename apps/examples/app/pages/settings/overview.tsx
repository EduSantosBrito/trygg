import { Component } from "effect-ui";
import * as Router from "effect-ui/router";

const SettingsOverview = Component.gen(function* () {
  return (
    <div>
      <h1 className="m-0 mb-2 text-2xl">Settings Overview</h1>
      <p className="text-gray-500 m-0 mb-6">Manage your account settings and preferences.</p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="m-0 mb-2 text-lg text-blue-600">Profile</h3>
          <p className="m-0 mb-3 text-gray-500 text-sm">
            Update your personal information and avatar.
          </p>
          <Router.Link
            to="/settings/profile"
            className="text-blue-600 no-underline text-sm hover:underline"
          >
            Go to Profile
          </Router.Link>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="m-0 mb-2 text-lg text-blue-600">Security</h3>
          <p className="m-0 mb-3 text-gray-500 text-sm">
            Manage your password and two-factor authentication.
          </p>
          <Router.Link
            to="/settings/security"
            className="text-blue-600 no-underline text-sm hover:underline"
          >
            Go to Security
          </Router.Link>
        </div>
      </div>
    </div>
  );
});

export default SettingsOverview;
