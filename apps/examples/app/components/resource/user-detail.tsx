import { Effect, Option } from "effect";
import { Resource, Signal, Component, type ComponentProps } from "effect-ui";
import { userResource } from "../../resources/users";
import { UserCard } from "../user-card";
import { Skeleton } from "../skeleton";
import { ErrorView } from "../error-view";

export const UserDetail = Component.gen(function* (
  Props: ComponentProps<{ userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;

  // Reactive fetch: re-fetches when userId signal changes, cancelling in-flight
  const state = yield* Resource.fetch(userResource, { id: userId });

  return yield* Resource.match(state, {
    Pending: () => <Skeleton lines={3} />,

    Success: (user, stale) => (
      <div>
        <UserCard user={user} stale={stale} />
        <div>
          <button
            className="text-sm px-3 py-1.5 border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={Signal.get(userId).pipe(
              Effect.flatMap((id) => Resource.invalidate(userResource({ id }))),
            )}
            disabled={stale}
          >
            {stale ? "Refreshing..." : "Refresh (Stale)"}
          </button>
          <button
            className="text-sm px-3 py-1.5 border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
            onClick={Signal.get(userId).pipe(
              Effect.flatMap((id) => Resource.refresh(userResource({ id }))),
            )}
          >
            Reload (Pending)
          </button>
        </div>
      </div>
    ),

    Failure: (error, staleUser) =>
      Option.match(staleUser, {
        onNone: () => (
          <ErrorView
            error={error}
            onRetry={Signal.get(userId).pipe(
              Effect.flatMap((id) => Resource.refresh(userResource({ id }))),
            )}
          />
        ),
        onSome: (user) => (
          <div>
            <div className="bg-red-50 text-red-800 py-3 px-4 rounded-md flex justify-between items-center text-sm">
              Failed to refresh: {error.message}
              <button
                className="bg-red-800 text-white border-none py-1.5 px-2.5 rounded cursor-pointer text-sm"
                onClick={Signal.get(userId).pipe(
                  Effect.flatMap((id) => Resource.refresh(userResource({ id }))),
                )}
              >
                Retry
              </button>
            </div>
            <UserCard user={user} stale={true} />
          </div>
        ),
      }),
  });
});
