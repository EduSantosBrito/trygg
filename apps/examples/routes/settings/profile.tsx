/**
 * Profile Settings Page
 * 
 * User profile settings accessible at /settings/profile
 */
import { Effect } from "effect"
import { Signal, Component } from "effect-ui"

const ProfileSettings = Component.gen(function* () {
  const name = yield* Signal.make("Jane Doe")
  const email = yield* Signal.make("jane@example.com")
  
  return (
    <div className="settings-page">
      <h1>Profile Settings</h1>
      <p>Update your personal information.</p>
      
      <form className="settings-form">
        <div className="form-group">
          <label>Display Name</label>
          <input
            type="text"
            value={name}
            onInput={(e) => {
              const target = e.target
              if (target instanceof HTMLInputElement) {
                return Signal.set(name, target.value)
              }
              return Effect.void
            }}
          />
        </div>
        
        <div className="form-group">
          <label>Email Address</label>
          <input
            type="email"
            value={email}
            onInput={(e) => {
              const target = e.target
              if (target instanceof HTMLInputElement) {
                return Signal.set(email, target.value)
              }
              return Effect.void
            }}
          />
        </div>
        
        <div className="form-actions">
          <button
            type="button"
            onClick={() => Effect.log("Profile saved!")}
          >
            Save Profile
          </button>
        </div>
      </form>
    </div>
  )
})

export default ProfileSettings
