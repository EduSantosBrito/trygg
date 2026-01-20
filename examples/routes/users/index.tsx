/**
 * Users List Route
 * Path: /users
 *
 * Demonstrates:
 * - Type-safe navigation with Link params
 * - List rendering with Router.Link
 */
import { Effect } from "effect";
import * as Router from "effect-ui/router";

// Mock user data
const users = [
  { id: "1", name: "Alice Johnson", email: "alice@example.com" },
  { id: "2", name: "Bob Smith", email: "bob@example.com" },
  { id: "3", name: "Charlie Brown", email: "charlie@example.com" },
  { id: "4", name: "Diana Prince", email: "diana@example.com" },
];

export default Effect.gen(function* () {
  return (
    <div className="users-page">
      <h2>Users</h2>
      <p>
        Click on a user to view their profile (demonstrates type-safe routing).
      </p>

      <div className="type-safe-demo">
        <h3>Type-Safe Links</h3>
        <pre>{`// TypeScript knows the route requires an 'id' param:
<Router.Link to="/users/:id" params={{ id: user.id }}>
  {user.name}
</Router.Link>

// This would be a type error:
// <Router.Link to="/users/:id">Missing params!</Router.Link>
// <Router.Link to="/users/:id" params={{ wrong: "x" }}>Wrong param name!</Router.Link>`}</pre>
      </div>

      <ul className="user-list">
        {users.map((user) => (
          <li key={user.id} className="user-item">
            <Router.Link to="/users/:id" params={{ id: user.id }}>
              <span className="user-name">{user.name}</span>
            </Router.Link>
            <span className="user-email">{user.email}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});
