/**
 * User Detail Route (Dynamic)
 * Path: /users/:id
 *
 * Demonstrates:
 * - Type-safe params extraction with Router.params()
 * - Route params inferred from file name [id].tsx
 */
import { Component } from "effect-ui";
import * as Router from "effect-ui/router";

// Mock user data
const users: Record<string, { name: string; email: string; role: string; joined: string }> = {
  "1": {
    name: "Alice Johnson",
    email: "alice@example.com",
    role: "Admin",
    joined: "2023-01-15",
  },
  "2": {
    name: "Bob Smith",
    email: "bob@example.com",
    role: "Developer",
    joined: "2023-03-22",
  },
  "3": {
    name: "Charlie Brown",
    email: "charlie@example.com",
    role: "Designer",
    joined: "2023-06-10",
  },
  "4": {
    name: "Diana Prince",
    email: "diana@example.com",
    role: "Manager",
    joined: "2023-02-01",
  },
};

const Users = Component.gen(function* () {
  const { id } = yield* Router.params("/users/:id");

  const user = users[id];

  if (!user) {
    return (
      <div className="user-not-found">
        <h2>User Not Found</h2>
        <p>No user with ID "{id}" exists.</p>
        <Router.Link to="/users">Back to Users</Router.Link>
      </div>
    );
  }

  return (
    <div className="user-detail">
      <nav className="breadcrumb">
        <Router.Link to="/users">Users</Router.Link>
        <span> / </span>
        <span>{user.name}</span>
      </nav>

      <div className="user-card">
        <h2>{user.name}</h2>
        <dl>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>{user.role}</dd>
          <dt>Joined</dt>
          <dd>{user.joined}</dd>
        </dl>
      </div>

      <div className="type-safe-demo">
        <h3>Type-Safe Params</h3>
        <pre>{`// The file [id].tsx creates a route /users/:id
// Router.params() extracts the id type-safely from the path:

const { id } = yield* Router.params("/users/:id")
// id = "${id}"

// TypeScript infers { readonly id: string } from the path pattern
// Link to="/users/:id" must include params prop`}</pre>
      </div>
    </div>
  );
});

export default Users;
