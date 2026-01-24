import { Component } from "trygg";
import * as Router from "trygg/router";

const users = [
  { id: "1", name: "Alice Johnson", email: "alice@example.com" },
  { id: "2", name: "Bob Smith", email: "bob@example.com" },
  { id: "3", name: "Charlie Brown", email: "charlie@example.com" },
  { id: "4", name: "Diana Prince", email: "diana@example.com" },
];

const UsersListPage = Component.gen(function* () {
  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="m-0 mb-1 text-2xl">Users</h2>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        Click on a user to view their profile (demonstrates type-safe routing).
      </p>

      <ul className="list-none p-0 mt-4">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0"
          >
            <Router.Link to="/users/:id" params={{ id: user.id }}>
              <span className="font-medium text-blue-600 hover:text-blue-800">{user.name}</span>
            </Router.Link>
            <span className="text-gray-500 text-sm">{user.email}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

export default UsersListPage;
