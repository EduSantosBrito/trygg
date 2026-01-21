/**
 * Protected Page with Route Guard
 *
 * This route demonstrates route guards - the guard checks if the user
 * is authenticated before allowing access. If not, it redirects to /login.
 *
 * The guard is an exported Effect that runs before the component renders.
 */
import { Effect, Option } from "effect";
import { Signal, Component } from "effect-ui";
import * as Router from "effect-ui/router";

// ============================================================================
// Auth State (simple global signal for demo)
// ============================================================================

/**
 * User type for authentication
 */
export interface AuthUser {
  readonly id: string;
  readonly name: string;
}

/**
 * Global auth signal - in a real app this would be a proper service
 * Using a FiberRef to share state across the app
 */
export const authSignal = Signal.unsafeMake<Option.Option<AuthUser>>(Option.none());

/**
 * Helper to set auth state (runs sync for simplicity)
 */
export const setAuth = (user: Option.Option<AuthUser>): Effect.Effect<void> =>
  Signal.set(authSignal, user);

/**
 * Helper to get current auth state
 */
export const getAuth = Signal.get(authSignal);

// ============================================================================
// Route Guard
// ============================================================================

/**
 * Route guard - checks if user is authenticated.
 *
 * Guards are Effects that run before the route component renders.
 * To block navigation, return a Router.redirect() result.
 * To allow navigation, return void (or just don't return a redirect).
 *
 * @example
 * ```tsx
 * // In your route file, export a guard:
 * export const guard = Effect.gen(function* () {
 *   const user = yield* getAuth
 *   if (Option.isNone(user)) {
 *     return Router.redirect("/login")
 *   }
 * })
 * ```
 */
export const guard = Effect.gen(function* () {
  const user = yield* Signal.get(authSignal);

  if (Option.isNone(user)) {
    // Not authenticated - redirect to login
    return Router.redirect("/login");
  }

  // Authenticated - allow access (return nothing)
});

// ============================================================================
// Protected Component
// ============================================================================

const ProtectedPage = Component.gen(function* () {
  // Get current user (we know they're authenticated because guard passed)
  const user = yield* Signal.get(authSignal);

  // This should always be Some because of the guard, but handle it properly
  if (Option.isNone(user)) {
    return <div>Loading...</div>;
  }

  const handleLogout = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* setAuth(Option.none());
      // Navigate to login after logout
      const router = yield* Router.getRouter;
      yield* router.navigate("/login");
    });

  return (
    <div className="protected-page">
      <div className="protected-header">
        <h1>Protected Content</h1>
        <span className="user-badge">
          Logged in as: <strong>{user.value.name}</strong>
        </span>
      </div>

      <div className="protected-content">
        <div className="success-banner">
          <h2>You're In!</h2>
          <p>You have successfully accessed the protected content.</p>
        </div>

        <div className="info-section">
          <h3>How Route Guards Work</h3>
          <p>This page is protected by a route guard that checks authentication status:</p>

          <pre>{`// Export a guard effect from your route file
export const guard = Effect.gen(function* () {
  const user = yield* getAuth
  
  if (Option.isNone(user)) {
    // Return redirect to block access
    return Router.redirect("/login")
  }
  
  // Return nothing to allow access
})`}</pre>

          <ul>
            <li>
              Guards run <strong>before</strong> the component renders
            </li>
            <li>
              Return <code>Router.redirect(path)</code> to block and redirect
            </li>
            <li>
              Return <code>void</code> (nothing) to allow access
            </li>
            <li>
              Guards are automatically loaded from the route file's <code>guard</code> export
            </li>
          </ul>
        </div>

        <div className="auth-actions">
          <button className="btn btn-secondary" onClick={handleLogout}>
            Logout
          </button>
          <Router.Link to="/" className="btn btn-outline">
            Back to Home
          </Router.Link>
        </div>
      </div>
    </div>
  );
});

export default ProtectedPage;
