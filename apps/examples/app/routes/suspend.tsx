/**
 * Suspend Example
 *
 * Demonstrates:
 * - Signal.suspend for async component rendering
 * - Automatic Pending/Failure/Success state tracking
 * - Dep-based caching (new deps = Loading, cached deps = stale content)
 * - Clean declarative API vs manual switch statements
 */
import { Cause, Duration, Effect } from "effect";
import { Signal, Component, type ComponentProps } from "effect-ui";

// =============================================================================
// Simulated async data fetching
// =============================================================================

interface User {
  readonly id: number;
  readonly name: string;
  readonly email: string;
}

interface Post {
  readonly id: number;
  readonly title: string;
  readonly body: string;
}

interface Stats {
  readonly followers: number;
  readonly following: number;
  readonly posts: number;
}

const fetchUser = (id: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(800));
    return {
      id,
      name: `User ${id}`,
      email: `user${id}@example.com`,
    } satisfies User;
  });

const fetchStats = (userId: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(800));
    return {
      followers: userId * 100 + 42,
      following: userId * 50 + 17,
      posts: userId * 10 + 3,
    } satisfies Stats;
  });

const fetchPosts = (userId: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(1200));
    return [
      { id: 1, title: "First Post", body: `Content from user ${userId}` },
      { id: 2, title: "Second Post", body: "More interesting content" },
      { id: 3, title: "Third Post", body: "Even more to read" },
    ] satisfies ReadonlyArray<Post>;
  });

// =============================================================================
// View Components (pure, sync rendering)
// =============================================================================

const UserCard = Component.gen(function* (Props: ComponentProps<{ user: User }>) {
  const { user } = yield* Props;
  return (
    <div className="user-card">
      <h3>{user.name}</h3>
      <p>{user.email}</p>
    </div>
  );
});

const StatsCard = Component.gen(function* (Props: ComponentProps<{ stats: Stats }>) {
  const { stats } = yield* Props;
  return (
    <div className="stats-card">
      <div className="stat">
        <span className="stat-value">{stats.followers}</span>
        <span className="stat-label">Followers</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats.following}</span>
        <span className="stat-label">Following</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats.posts}</span>
        <span className="stat-label">Posts</span>
      </div>
    </div>
  );
});

const PostList = Component.gen(function* (Props: ComponentProps<{ posts: ReadonlyArray<Post> }>) {
  const { posts } = yield* Props;
  return (
    <ul className="post-list">
      {posts.map((post) => (
        <li key={post.id}>
          <strong>{post.title}</strong>
          <p>{post.body}</p>
        </li>
      ))}
    </ul>
  );
});

const ErrorCard = Component.gen(function* (
  Props: ComponentProps<{ label: string; cause: Cause.Cause<unknown> }>,
) {
  const { label, cause } = yield* Props;
  return (
    <div className="error-card">
      <strong>{label} failed</strong>
      <p>{String(Cause.squash(cause))}</p>
    </div>
  );
});

// =============================================================================
// Fallback Components
// =============================================================================

const UserSkeleton = Component.gen(function* () {
  return (
    <div className="skeleton user-skeleton">
      <div className="skeleton-line" style={{ width: "60%" }} />
      <div className="skeleton-line" style={{ width: "80%" }} />
    </div>
  );
});

const StatsSkeleton = Component.gen(function* () {
  return (
    <div className="skeleton stats-skeleton">
      <div className="skeleton-line" style={{ width: "30%" }} />
      <div className="skeleton-line" style={{ width: "30%" }} />
      <div className="skeleton-line" style={{ width: "30%" }} />
    </div>
  );
});

const PostsSkeleton = Component.gen(function* () {
  return (
    <div className="skeleton posts-skeleton">
      <div className="skeleton-line" style={{ width: "40%" }} />
      <div className="skeleton-line" style={{ width: "90%" }} />
      <div className="skeleton-line" style={{ width: "40%" }} />
      <div className="skeleton-line" style={{ width: "85%" }} />
      <div className="skeleton-line" style={{ width: "40%" }} />
      <div className="skeleton-line" style={{ width: "75%" }} />
    </div>
  );
});

// =============================================================================
// Async Components (do async work internally)
// =============================================================================

interface UserProfileProps {
  readonly userId: Signal.Signal<number>;
}

/**
 * Async user profile component.
 * Reads userId signal and fetches user data.
 */
const UserProfileAsync = Component.gen(function* (Props: ComponentProps<UserProfileProps>) {
  const { userId } = yield* Props;
  const id = yield* Signal.get(userId);
  const user = yield* fetchUser(id);
  return <UserCard user={user} />;
});

interface StatsProps {
  readonly userId: Signal.Signal<number>;
}

/**
 * Async stats component.
 * Reads userId signal and fetches stats data.
 */
const StatsAsync = Component.gen(function* (Props: ComponentProps<StatsProps>) {
  const { userId } = yield* Props;
  const id = yield* Signal.get(userId);
  const stats = yield* fetchStats(id);
  return <StatsCard stats={stats} />;
});

interface PostsProps {
  readonly userId: Signal.Signal<number>;
}

/**
 * Async posts component.
 * Reads userId signal and fetches posts data.
 */
const PostsAsync = Component.gen(function* (Props: ComponentProps<PostsProps>) {
  const { userId } = yield* Props;
  const id = yield* Signal.get(userId);
  const posts = yield* fetchPosts(id);
  return <PostList posts={posts} />;
});

// =============================================================================
// Main Component
// =============================================================================

const SuspendDemo = Component.gen(function* () {
  const userId = yield* Signal.make(1);

  // Signal.suspend: tracks async state of the Success component
  // - New dep values (never-fetched userId) -> shows Pending (skeleton)
  // - Cached dep values (previously-fetched userId) -> shows stale then updates
  // Returns a ComponentType that can be used as <SuspendedUserProfile />
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
    <div className="example">
      <h2>Suspend</h2>
      <p className="description">Async component state with Signal.suspend and dep-based caching</p>

      <div className="resource-controls">
        <button onClick={nextUser}>Switch User (ID: {userId})</button>
      </div>

      <div className="resource-demo">
        <div className="resource-section">
          <h3>User Profile (800ms)</h3>
          <SuspendedUserProfile />
        </div>

        <div className="resource-section">
          <h3>User Stats (800ms)</h3>
          <SuspendedStats />
        </div>

        <div className="resource-section resource-full-width">
          <h3>User Posts (1200ms)</h3>
          <SuspendedPosts />
        </div>
      </div>

      <div className="code-example">
        <h3>Signal.suspend Pattern</h3>
        <pre>{`// Define async component with typed props
const UserProfile = Component.gen(function* (Props: ComponentProps<{
  userId: Signal<number>
}>) {
  const { userId } = yield* Props
  const id = yield* Signal.get(userId)
  const user = yield* fetchUser(id)
  return <UserCard user={user} />
})

// Signal.suspend returns a ComponentType for JSX usage
// First param: ComponentType (for type inference + identity)
// Second param: handlers with Pending, Failure, Success
const SuspendedProfile = yield* Signal.suspend(UserProfile, {
  Pending: (stale) => stale ?? <Skeleton />,
  Failure: (cause) => <ErrorView cause={cause} />,
  Success: <UserProfile userId={userId} />
})

// Use as JSX component!
return <SuspendedProfile />`}</pre>
      </div>
    </div>
  );
});

export default SuspendDemo;
