import { Effect, Option } from "effect";
import { Resource, Signal, Component, cx, type ComponentProps } from "trygg";
import { userPostsResource } from "../../resources/users";
import { Skeleton } from "../skeleton";
import { ErrorView } from "../error-view";

export const UserPosts = Component.gen(function* (
  Props: ComponentProps<{ userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;

  // Reactive fetch: re-fetches when userId signal changes, cancelling in-flight
  const state = yield* Resource.fetch(userPostsResource, { id: userId });

  return yield* Resource.match(state, {
    Pending: () => <Skeleton lines={6} />,

    Success: (posts, stale) => {
      const postsSignal = Signal.makeSync(posts);

      return (
        <div className={cx(stale && "opacity-60")}>
          <ul className="list-none p-0 m-0">
            {Signal.each(
              postsSignal,
              (post) =>
                Effect.succeed(
                  <li className="p-3 bg-white rounded mb-2 border border-gray-200 last:mb-0">
                    <strong className="block mb-1 text-gray-700">{post.title}</strong>
                    <p className="m-0 text-gray-500 text-sm">{post.body}</p>
                  </li>,
                ),
              { key: (post) => post.id },
            )}
            {posts.length === 0 && (
              <li className="p-3 bg-white rounded mb-2 border border-gray-200">No posts found</li>
            )}
          </ul>
          <div>
            <button
              className="text-sm px-3 py-1.5 border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={Signal.get(userId).pipe(
                Effect.flatMap((id) => Resource.invalidate(userPostsResource({ id }))),
              )}
              disabled={stale}
            >
              {stale ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      );
    },

    Failure: (error, stalePosts) =>
      Option.match(stalePosts, {
        onNone: () => (
          <ErrorView
            error={error}
            onRetry={Signal.get(userId).pipe(
              Effect.flatMap((id) => Resource.refresh(userPostsResource({ id }))),
            )}
          />
        ),
        onSome: (posts) => {
          const postsSignal = Signal.makeSync(posts);
          return (
            <div>
              <div className="bg-red-50 text-red-800 py-3 px-4 rounded-md flex justify-between items-center text-sm">
                Failed to refresh
              </div>
              <ul className="list-none p-0 m-0 opacity-60">
                {Signal.each(
                  postsSignal,
                  (post) =>
                    Effect.succeed(
                      <li className="p-3 bg-white rounded mb-2 border border-gray-200 last:mb-0">
                        <strong className="block mb-1 text-gray-700">{post.title}</strong>
                        <p className="m-0 text-gray-500 text-sm">{post.body}</p>
                      </li>,
                    ),
                  { key: (post) => post.id },
                )}
              </ul>
            </div>
          );
        },
      }),
  });
});
