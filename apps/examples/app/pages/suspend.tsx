import { Cause, Layer } from "effect";
import * as ServiceMap from "effect/ServiceMap";
import { Signal, Component, type ComponentProps } from "trygg";
import { UserProfileAsync } from "../components/suspend/user-profile-async";
import { StatsAsync } from "../components/suspend/stats-async";
import { PostsAsync } from "../components/suspend/posts-async";
import { ErrorCard } from "../components/suspend/error-card";
import { UserSkeleton } from "../components/suspend/user-skeleton";
import { StatsSkeleton } from "../components/suspend/stats-skeleton";
import { PostsSkeleton } from "../components/suspend/posts-skeleton";

class SuspendUi extends ServiceMap.Service<
  SuspendUi,
  {
    readonly pendingHint: string;
    readonly failurePrefix: string;
  }
>()("examples/SuspendUi") {}

const SuspendUiLive = Layer.succeed(SuspendUi, {
  pendingHint: "Pending UI resolved from service requirement",
  failurePrefix: "Boundary",
});

const UserPending = Component.gen(function* (
  Props: ComponentProps<{ stale: import("trygg").Element | null }>,
) {
  yield* Props;
  const ui = yield* SuspendUi;
  return (
    <div>
      <p className="m-0 mb-2 text-xs text-gray-400">{ui.pendingHint}</p>
      <UserSkeleton />
    </div>
  );
});

const StatsPending = Component.gen(function* (
  Props: ComponentProps<{ stale: import("trygg").Element | null }>,
) {
  yield* Props;
  const ui = yield* SuspendUi;
  return (
    <div>
      <p className="m-0 mb-2 text-xs text-gray-400">{ui.pendingHint}</p>
      <StatsSkeleton />
    </div>
  );
});

const PostsPending = Component.gen(function* (
  Props: ComponentProps<{ stale: import("trygg").Element | null }>,
) {
  yield* Props;
  const ui = yield* SuspendUi;
  return (
    <div>
      <p className="m-0 mb-2 text-xs text-gray-400">{ui.pendingHint}</p>
      <PostsSkeleton />
    </div>
  );
});

const UserFailure = Component.gen(function* (
  Props: ComponentProps<{ cause: Cause.Cause<unknown>; stale: import("trygg").Element | null }>,
) {
  const { cause } = yield* Props;
  const ui = yield* SuspendUi;
  return <ErrorCard label={`${ui.failurePrefix} User`} cause={cause} />;
});

const StatsFailure = Component.gen(function* (
  Props: ComponentProps<{ cause: Cause.Cause<unknown>; stale: import("trygg").Element | null }>,
) {
  const { cause } = yield* Props;
  const ui = yield* SuspendUi;
  return <ErrorCard label={`${ui.failurePrefix} Stats`} cause={cause} />;
});

const PostsFailure = Component.gen(function* (
  Props: ComponentProps<{ cause: Cause.Cause<unknown>; stale: import("trygg").Element | null }>,
) {
  const { cause } = yield* Props;
  const ui = yield* SuspendUi;
  return <ErrorCard label={`${ui.failurePrefix} Posts`} cause={cause} />;
});

const SuspendPage = Component.gen(function* () {
  const userId = yield* Signal.make(1);

  const SuspendedUserProfile = yield* Signal.suspend(UserProfileAsync).pipe(
    Signal.on("Pending", UserPending),
    Signal.on("Failure", UserFailure),
    Signal.exhaustive,
  );

  const SuspendedStats = yield* Signal.suspend(StatsAsync).pipe(
    Signal.on("Pending", StatsPending),
    Signal.on("Failure", StatsFailure),
    Signal.exhaustive,
  );

  const SuspendedPosts = yield* Signal.suspend(PostsAsync).pipe(
    Signal.on("Pending", PostsPending),
    Signal.on("Failure", PostsFailure),
    Signal.exhaustive,
  );

  const nextUser = () => Signal.update(userId, (id) => (id % 3) + 1);

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="m-0 mb-1 text-2xl">Suspend</h2>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        Async component state with Signal.suspend and dep-based caching
      </p>
      <p className="text-gray-400 m-0 mb-6 text-xs">
        Pending/Failure handlers require SuspendUi service (provided at page boundary)
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
          <SuspendedUserProfile userId={userId} />
        </div>

        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="m-0 mb-4 text-base text-gray-500">User Stats (800ms)</h3>
          <SuspendedStats userId={userId} />
        </div>

        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 col-span-full">
          <h3 className="m-0 mb-4 text-base text-gray-500">User Posts (1200ms)</h3>
          <SuspendedPosts userId={userId} />
        </div>
      </div>
    </div>
  );
}).provide(SuspendUiLive);

export default SuspendPage;
