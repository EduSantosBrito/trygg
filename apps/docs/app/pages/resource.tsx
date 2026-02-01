import { Component, Resource } from "trygg";
import { helloResource } from "../resources/hello";
import { Skeleton } from "../components/skeleton";
import { ErrorView } from "../components/error-view";

export default Component.gen(function* () {
  const state = yield* Resource.fetch(helloResource);

  return yield* Resource.match(state, {
    Pending: () => (
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h2 className="m-0 mb-1 text-2xl">Resource Demo</h2>
        <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
          Cached, type-safe API fetching with Resource
        </p>
        <Skeleton lines={4} />
      </div>
    ),

    Success: (data, stale) => (
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h2 className="m-0 mb-1 text-2xl">Resource Demo</h2>
        <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
          Cached, type-safe API fetching with Resource
        </p>

        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="m-0 text-base text-gray-500">API Response (GET /api/hello)</h3>
            <button
              className="px-4 py-2 text-sm border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={Resource.invalidate(helloResource)}
              disabled={stale}
            >
              {stale ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className={stale ? "opacity-60" : ""}>
            <pre className="m-0 p-4 bg-white rounded border border-gray-200 text-sm">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="m-0 mb-2 text-sm font-semibold text-blue-900">How it works</h4>
          <ul className="m-0 pl-5 space-y-1 text-sm text-blue-800">
            <li>Resource.fetch() automatically caches responses by key</li>
            <li>Multiple components can share the same resource without re-fetching</li>
            <li>Resource.invalidate() marks data as stale and triggers refresh</li>
            <li>Stale data is shown while fetching new data (no loading spinner)</li>
          </ul>
        </div>
      </div>
    ),

    Failure: (error) => (
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h2 className="m-0 mb-1 text-2xl">Resource Demo</h2>
        <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
          Cached, type-safe API fetching with Resource
        </p>
        <ErrorView error={error} onRetry={Resource.refresh(helloResource)} />
      </div>
    ),
  });
});
