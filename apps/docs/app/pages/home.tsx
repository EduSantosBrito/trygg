import { Component, Signal } from "trygg";

export default Component.gen(function* () {
  const count = yield* Signal.make(0);
  const increment = () => Signal.update(count, (n) => n + 1);

  return (
    <div className="pb-8">
      <div className="mb-8">
        <h1 className="text-2xl m-0 mb-2">Welcome to trygg</h1>
        <p className="text-gray-500 m-0 text-lg">
          Effect-native UI framework with fine-grained reactivity
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6">
        <h2 className="m-0 mb-4 text-xl">Quick Start</h2>
        <p className="text-gray-600 mb-4">
          This is a basic counter example using Signal for reactive state.
        </p>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded cursor-pointer transition-colors hover:bg-blue-700"
          onClick={increment}
        >
          Count: {count}
        </button>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h2 className="m-0 mb-4 text-xl">Features</h2>
        <ul className="space-y-2 m-0 pl-5">
          <li className="text-gray-700">
            <strong>Fine-grained reactivity</strong> - Signals update only what changes
          </li>
          <li className="text-gray-700">
            <strong>Type-safe routing</strong> - Router with params validation
          </li>
          <li className="text-gray-700">
            <strong>API integration</strong> - Type-safe HTTP client with Resource caching
          </li>
          <li className="text-gray-700">
            <strong>Effect-native</strong> - Built on Effect for composable, type-safe side effects
          </li>
        </ul>
      </div>
    </div>
  );
});
