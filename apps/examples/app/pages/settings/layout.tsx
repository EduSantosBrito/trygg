import { Component } from "effect-ui";
import * as Router from "effect-ui/router";

const SettingsLayout = Component.gen(function* () {
  return (
    <div className="flex gap-8 min-h-[400px]">
      <aside className="w-[200px] shrink-0">
        <h2 className="text-base m-0 mb-4 text-gray-500 uppercase tracking-wide">Settings</h2>
        <nav className="flex flex-col gap-1">
          <Router.Link
            to="/settings"
            className="block px-3 py-2 text-gray-500 no-underline rounded transition-colors hover:bg-gray-100 hover:text-gray-700 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-600"
          >
            Overview
          </Router.Link>
          <Router.Link
            to="/settings/profile"
            className="block px-3 py-2 text-gray-500 no-underline rounded transition-colors hover:bg-gray-100 hover:text-gray-700 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-600"
          >
            Profile
          </Router.Link>
          <Router.Link
            to="/settings/security"
            className="block px-3 py-2 text-gray-500 no-underline rounded transition-colors hover:bg-gray-100 hover:text-gray-700 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-600"
          >
            Security
          </Router.Link>
        </nav>
      </aside>
      <div className="flex-1 bg-white p-6 rounded-lg border border-gray-200">
        <Router.Outlet />
      </div>
    </div>
  );
});

export default SettingsLayout;
