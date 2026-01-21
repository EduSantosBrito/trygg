/**
 * Login Page
 * 
 * Simple login page that demonstrates setting auth state.
 * Used together with the /protected route to demonstrate route guards.
 */
import { Effect, Option } from "effect"
import { Signal, Component } from "effect-ui"
import * as Router from "effect-ui/router"
import { authSignal, AuthUser, setAuth } from "./protected"

const LoginPage = Component.gen(function* () {
  const username = yield* Signal.make("")
  const error = yield* Signal.make<Option.Option<string>>(Option.none())
  
  // Check if already logged in
  const user = yield* Signal.get(authSignal)
  
  const handleLogin = (e: Event): Effect.Effect<void> =>
    Effect.gen(function* () {
      e.preventDefault()
      const name = yield* Signal.get(username)
      
      if (name.trim().length === 0) {
        yield* Signal.set(error, Option.some("Please enter a username"))
        return
      }
      
      // Simulate login - in real app this would call an API
      const newUser: AuthUser = { 
        id: crypto.randomUUID(), 
        name: name.trim() 
      }
      yield* setAuth(Option.some(newUser))
      
      // Navigate to protected page
      const router = yield* Router.getRouter
      yield* router.navigate("/protected")
    })
  
  // If already logged in, show logout option
  if (Option.isSome(user)) {
    return (
      <div className="auth-page">
        <h1>Already Logged In</h1>
        <p>You are logged in as <strong>{user.value.name}</strong></p>
        <div className="auth-actions">
          <Router.Link to="/protected" className="btn btn-primary">
            Go to Protected Page
          </Router.Link>
          <button 
            className="btn btn-secondary"
            onClick={() => setAuth(Option.none())}
          >
            Logout
          </button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="auth-page">
      <h1>Login</h1>
      <p>Enter a username to access the protected page.</p>
      
      <form className="auth-form" onSubmit={handleLogin}>
        <div className="form-group">
          <label>Username</label>
          <input
            type="text"
            value={username}
            placeholder="Enter any username"
            onInput={(e) => {
              const target = e.target
              if (target instanceof HTMLInputElement) {
                return Signal.set(username, target.value)
              }
              return Effect.void
            }}
          />
          {Option.match(yield* Signal.get(error), {
            onNone: () => null,
            onSome: (msg) => <p className="error-message">{msg}</p>
          })}
        </div>
        
        <button type="submit" className="btn btn-primary">
          Login
        </button>
      </form>
      
      <div className="auth-info">
        <h3>Route Guards Demo</h3>
        <p>This example demonstrates route guards with <code>Router.redirect()</code>.</p>
        <ul>
          <li>The <Router.Link to="/protected">/protected</Router.Link> route has a guard</li>
          <li>If not logged in, you'll be redirected here</li>
          <li>Login to access the protected content</li>
        </ul>
      </div>
    </div>
  )
})

export default LoginPage
