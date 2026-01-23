import { Effect } from "effect";
import { Signal, Component } from "effect-ui";

const SecuritySettings = Component.gen(function* () {
  const twoFactorEnabled = yield* Signal.make(false);
  const twoFactorValue = yield* Signal.get(twoFactorEnabled);

  return (
    <div>
      <h1 className="m-0 mb-2 text-2xl">Security Settings</h1>
      <p className="text-gray-500 m-0 mb-6">Manage your account security.</p>

      <div className="mb-8 pb-6 border-b border-gray-200">
        <h2 className="m-0 mb-2 text-lg">Password</h2>
        <p className="text-gray-500 m-0 mb-4 text-sm">Last changed: 3 months ago</p>
        <button
          className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
          type="button"
          onClick={() => Effect.log("Change password dialog")}
        >
          Change Password
        </button>
      </div>

      <div className="mb-8 pb-6 border-b border-gray-200">
        <h2 className="m-0 mb-2 text-lg">Two-Factor Authentication</h2>
        <p className="text-gray-500 m-0 mb-4 text-sm">
          Add an extra layer of security to your account.
        </p>
        <div className="flex items-center justify-between gap-4">
          <span>Status: {twoFactorValue ? "Enabled" : "Disabled"}</span>
          <button
            className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
            type="button"
            onClick={() => Signal.update(twoFactorEnabled, (v) => !v)}
          >
            {twoFactorValue ? "Disable" : "Enable"} 2FA
          </button>
        </div>
      </div>

      <div className="last:border-b-0 last:mb-0 last:pb-0">
        <h2 className="m-0 mb-2 text-lg">Active Sessions</h2>
        <p className="text-gray-500 m-0 mb-4 text-sm">You are currently logged in on 2 devices.</p>
        <button
          className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
          type="button"
          onClick={() => Effect.log("View sessions")}
        >
          View All Sessions
        </button>
      </div>
    </div>
  );
});

export default SecuritySettings;
