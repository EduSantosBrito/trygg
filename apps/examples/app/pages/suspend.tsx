import { Signal, Component } from "effect-ui";
import { UserProfileAsync } from "../components/suspend/user-profile-async";
import { StatsAsync } from "../components/suspend/stats-async";
import { PostsAsync } from "../components/suspend/posts-async";
import { ErrorCard } from "../components/suspend/error-card";
import { UserSkeleton } from "../components/suspend/user-skeleton";
import { StatsSkeleton } from "../components/suspend/stats-skeleton";
import { PostsSkeleton } from "../components/suspend/posts-skeleton";

const SuspendPage = Component.gen(function* () {
  const userId = yield* Signal.make(1);

  const SuspendedUserProfile = yield* Signal.suspend(UserProfileAsync, {
    Pending: (stale) => stale ?? <UserSkeleton />,
    Failure: (cause) => <ErrorCard label="User" cause={cause} />,
    Success: <UserProfileAsync userId={userId} />,
  });

  const SuspendedStats = yield* Signal.suspend(StatsAsync, {
    Pending: (stale) => stale ?? <StatsSkeleton />,
    Failure: (cause) => <ErrorCard label="Stats" cause={cause} />,
    Success: <StatsAsync userId={userId} />,
  });

  const SuspendedPosts = yield* Signal.suspend(PostsAsync, {
    Pending: (stale) => stale ?? <PostsSkeleton />,
    Failure: (cause) => <ErrorCard label="Posts" cause={cause} />,
    Success: <PostsAsync userId={userId} />,
  });

  const nextUser = () => Signal.update(userId, (id) => (id % 3) + 1);

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="m-0 mb-1 text-2xl">Suspend</h2>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        Async component state with Signal.suspend and dep-based caching
      </p>

      <div className="flex gap-2 mb-6">
        <button
          className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
          onClick={nextUser}
        >
          Switch User (ID: {userId})
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="m-0 mb-4 text-base text-gray-500">User Profile (800ms)</h3>
          <SuspendedUserProfile />
        </div>

        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="m-0 mb-4 text-base text-gray-500">User Stats (800ms)</h3>
          <SuspendedStats />
        </div>

        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 col-span-full">
          <h3 className="m-0 mb-4 text-base text-gray-500">User Posts (1200ms)</h3>
          <SuspendedPosts />
        </div>
      </div>
    </div>
  );
});

export default SuspendPage;
