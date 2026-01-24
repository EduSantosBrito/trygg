import { Effect, Option } from "effect";
import { Signal, Component } from "trygg";
import * as Router from "trygg/router";
import { authSignal, setAuth } from "../resources/auth";

const ProtectedPage = Component.gen(function* () {
  const user = yield* Signal.get(authSignal);

  if (Option.isNone(user)) {
    return <div>Loading...</div>;
  }

  const handleLogout = () =>
    Effect.gen(function* () {
      yield* setAuth(Option.none());
      const router = yield* Router.get;
      yield* router.navigate("/login");
    });

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-6">
        <h1 className="m-0 text-2xl">Protected Content</h1>
        <span className="text-sm bg-blue-100 text-blue-800 px-3 py-1 rounded-full">
          Logged in as: <strong>{user.value.name}</strong>
        </span>
      </div>

      <div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <h2 className="m-0 mb-1 text-xl text-green-800">You're In!</h2>
          <p className="m-0 text-green-700">
            You have successfully accessed the protected content.
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
            onClick={handleLogout}
          >
            Logout
          </button>
          <Router.Link
            to="/"
            className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100 no-underline text-gray-700"
          >
            Back to Home
          </Router.Link>
        </div>
      </div>
    </div>
  );
});

export default ProtectedPage;
