import { Component } from "trygg";
import * as Router from "trygg/router";

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

const UserDetailPage = Component.gen(function* () {
  const { id } = yield* Router.params("/users/:id");

  const user = users[id];

  if (!user) {
    return (
      <div className="bg-white p-6 rounded-lg border border-gray-200 text-center">
        <h2 className="m-0 mb-1 text-2xl">User Not Found</h2>
        <p className="text-gray-500">No user with ID "{id}" exists.</p>
        <Router.Link
          to="/users"
          className="inline-block mb-4 text-gray-500 no-underline hover:text-blue-600"
        >
          Back to Users
        </Router.Link>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <nav className="text-sm text-gray-500 mb-4">
        <Router.Link to="/users" className="text-blue-600 no-underline hover:underline">
          Users
        </Router.Link>
        <span> / </span>
        <span>{user.name}</span>
      </nav>

      <div className="bg-gray-50 p-6 rounded-lg mb-6">
        <h2 className="m-0 mb-4 text-2xl">{user.name}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 m-0">
          <dt className="font-medium text-gray-600">Email</dt>
          <dd className="m-0">{user.email}</dd>
          <dt className="font-medium text-gray-600">Role</dt>
          <dd className="m-0">{user.role}</dd>
          <dt className="font-medium text-gray-600">Joined</dt>
          <dd className="m-0">{user.joined}</dd>
        </dl>
      </div>
    </div>
  );
});

export default UserDetailPage;
