import { Effect } from "effect";
import { Resource, Signal, Component, cx, type ComponentProps } from "trygg";
import { usersResource } from "../../resources/users";
import { Skeleton } from "../skeleton";
import { ErrorView } from "../error-view";

export const UsersList = Component.gen(function* (
  Props: ComponentProps<{ onSelect: (id: string) => Effect.Effect<void> }>,
) {
  const { onSelect } = yield* Props;
  const state = yield* Resource.fetch(usersResource);

  return yield* Resource.match(state, {
    Pending: () => <Skeleton lines={4} />,

    Success: (users, stale) => {
      const usersSignal = Signal.unsafeMake(users);

      return (
        <div
          className={cx("bg-white rounded-lg p-4 border border-gray-200", stale && "opacity-60")}
        >
          <div className="flex justify-between items-center mb-3 pb-3 border-b border-gray-100 text-sm text-gray-500">
            <span>
              {users.length} users {stale && "(refreshing...)"}
            </span>
            <button
              className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={Resource.invalidate(usersResource)}
              disabled={stale}
            >
              Refresh
            </button>
          </div>
          <ul className="list-none p-0 m-0">
            {Signal.each(
              usersSignal,
              (user) =>
                Effect.succeed(
                  <li
                    className="flex justify-between items-center px-3 py-2.5 my-1 rounded-md cursor-pointer transition-colors hover:bg-gray-50"
                    onClick={onSelect(user.id)}
                  >
                    <span className="font-medium text-gray-700">{user.name}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 py-0.5 px-2 rounded">
                      {user.role}
                    </span>
                  </li>,
                ),
              { key: (user) => user.id },
            )}
          </ul>
        </div>
      );
    },

    Failure: (error) => <ErrorView error={error} onRetry={Resource.refresh(usersResource)} />,
  });
});
