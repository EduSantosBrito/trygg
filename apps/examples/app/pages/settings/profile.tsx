import { Effect } from "effect";
import { Signal, Component } from "trygg";

const ProfileSettings = Component.gen(function* () {
  const name = yield* Signal.make("Jane Doe");
  const email = yield* Signal.make("jane@example.com");

  return (
    <div>
      <h1 className="m-0 mb-2 text-2xl">Profile Settings</h1>
      <p className="text-gray-500 m-0 mb-6">Update your personal information.</p>

      <form className="max-w-[400px]">
        <div className="mb-4">
          <label className="block mb-1 font-medium">Display Name</label>
          <input
            className="py-2 px-2 text-base border border-gray-300 rounded w-full focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            type="text"
            value={name}
            onInput={(e) => {
              const target = e.target;
              if (target instanceof HTMLInputElement) {
                return Signal.set(name, target.value);
              }
              return Effect.void;
            }}
          />
        </div>

        <div className="mb-4">
          <label className="block mb-1 font-medium">Email Address</label>
          <input
            className="py-2 px-2 text-base border border-gray-300 rounded w-full focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            type="email"
            value={email}
            onInput={(e) => {
              const target = e.target;
              if (target instanceof HTMLInputElement) {
                return Signal.set(email, target.value);
              }
              return Effect.void;
            }}
          />
        </div>

        <div className="mt-6">
          <button
            className="px-4 py-2 text-base border border-blue-600 rounded bg-blue-600 text-white cursor-pointer transition-colors hover:bg-blue-700"
            type="button"
            onClick={() => Effect.log("Profile saved!")}
          >
            Save Profile
          </button>
        </div>
      </form>
    </div>
  );
});

export default ProfileSettings;
