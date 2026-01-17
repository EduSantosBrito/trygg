/**
 * Security Settings Page
 * 
 * Security settings accessible at /settings/security
 */
import { Effect } from "effect"
import { Signal } from "effect-ui"

const SecuritySettings = Effect.gen(function* () {
  const twoFactorEnabled = yield* Signal.make(false)
  const twoFactorValue = yield* Signal.get(twoFactorEnabled)
  
  return (
    <div className="settings-page">
      <h1>Security Settings</h1>
      <p>Manage your account security.</p>
      
      <div className="settings-section">
        <h2>Password</h2>
        <p>Last changed: 3 months ago</p>
        <button
          type="button"
          onClick={() => Effect.log("Change password dialog")}
        >
          Change Password
        </button>
      </div>
      
      <div className="settings-section">
        <h2>Two-Factor Authentication</h2>
        <p>Add an extra layer of security to your account.</p>
        <div className="toggle-row">
          <span>Status: {twoFactorValue ? "Enabled" : "Disabled"}</span>
          <button
            type="button"
            onClick={() => Signal.update(twoFactorEnabled, v => !v)}
          >
            {twoFactorValue ? "Disable" : "Enable"} 2FA
          </button>
        </div>
      </div>
      
      <div className="settings-section">
        <h2>Active Sessions</h2>
        <p>You are currently logged in on 2 devices.</p>
        <button
          type="button"
          onClick={() => Effect.log("View sessions")}
        >
          View All Sessions
        </button>
      </div>
    </div>
  )
})

export default SecuritySettings
