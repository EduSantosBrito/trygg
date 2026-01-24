import { Effect, Option } from "effect";
import { Signal, Component } from "trygg";
import * as Router from "trygg/router";
import { authSignal, type AuthUser, setAuth } from "../resources/auth";

const LoginPage = Component.gen(function* () {
  const username = yield* Signal.make("");
  const error = yield* Signal.make<Option.Option<string>>(Option.none());

  const user = yield* Signal.get(authSignal);

  const handleLogin = (e: Event) =>
    Effect.gen(function* () {
      e.preventDefault();
      const name = yield* Signal.get(username);

      if (name.trim().length === 0) {
        yield* Signal.set(error, Option.some("Please enter a username"));
        return;
      }

      const newUser: AuthUser = {
        id: crypto.randomUUID(),
        name: name.trim(),
      };
      yield* setAuth(Option.some(newUser));

      const router = yield* Router.get;
      yield* router.navigate("/protected");
    });

  if (Option.isSome(user)) {
    return (
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h1 className="m-0 mb-1 text-2xl">Already Logged In</h1>
        <p>
          You are logged in as <strong>{user.value.name}</strong>
        </p>
        <div className="flex gap-3 mt-4">
          <Router.Link
            to="/protected"
            className="px-4 py-2 text-base border border-blue-600 rounded bg-blue-600 text-white cursor-pointer transition-colors hover:bg-blue-700 no-underline"
          >
            Go to Protected Page
          </Router.Link>
          <button
            className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
            onClick={() => setAuth(Option.none())}
          >
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h1 className="m-0 mb-1 text-2xl">Login</h1>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        Enter a username to access the protected page.
      </p>

      <form className="mt-4" onSubmit={handleLogin}>
        <div className="mb-4">
          <label className="block mb-1 font-medium">Username</label>
          <input
            type="text"
            className="py-2 px-2 text-base border border-gray-300 rounded w-full focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            value={username}
            placeholder="Enter any username"
            onInput={(e) => {
              const target = e.target;
              if (target instanceof HTMLInputElement) {
                return Signal.set(username, target.value);
              }
              return Effect.void;
            }}
          />
          {Option.match(yield* Signal.get(error), {
            onNone: () => null,
            onSome: (msg) => <p className="text-red-600 text-sm mt-1">{msg}</p>,
          })}
        </div>

        <button
          type="submit"
          className="px-4 py-2 text-base border border-blue-600 rounded bg-blue-600 text-white cursor-pointer transition-colors hover:bg-blue-700"
        >
          Login
        </button>
      </form>

      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h3 className="mt-0 mb-2 text-lg">Middleware Demo</h3>
        <p>
          This example demonstrates route middleware with <code>Router.routeRedirect()</code>.
        </p>
        <ul>
          <li>
            The <Router.Link to="/protected">/protected</Router.Link> route has middleware
          </li>
          <li>If not logged in, you'll be redirected here</li>
          <li>Login to access the protected content</li>
        </ul>
      </div>
    </div>
  );
});

export default LoginPage;
