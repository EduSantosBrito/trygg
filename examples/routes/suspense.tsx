/**
 * Suspense Example
 *
 * Demonstrates:
 * - Suspense component for async boundaries
 * - Fallback UI while loading
 * - Simulated async data fetching
 * - Multiple independent Suspense boundaries
 * - Reloading with Signal
 */
import { Effect, Duration } from "effect"
import { Signal, Component, Suspense } from "effect-ui"

// =============================================================================
// Simulated async data fetching
// =============================================================================

interface User {
  readonly id: number
  readonly name: string
  readonly email: string
}

interface Post {
  readonly id: number
  readonly title: string
  readonly body: string
}

interface Stats {
  readonly followers: number
  readonly following: number
  readonly posts: number
}

const fetchUser = (id: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(800))
    return {
      id,
      name: `User ${id}`,
      email: `user${id}@example.com`
    } satisfies User
  })

const fetchStats = (userId: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(800)) // Same as fetchUser - should resolve together
    return {
      followers: userId * 100 + 42,
      following: userId * 50 + 17,
      posts: userId * 10 + 3
    } satisfies Stats
  })

const fetchPosts = (userId: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(1200))
    return [
      { id: 1, title: "First Post", body: `Content from user ${userId}` },
      { id: 2, title: "Second Post", body: "More interesting content" },
      { id: 3, title: "Third Post", body: "Even more to read" }
    ] satisfies ReadonlyArray<Post>
  })

// =============================================================================
// Async Components
// =============================================================================

const UserCard = (userId: number) =>
  Effect.gen(function* () {
    const user = yield* fetchUser(userId)
    return (
      <div className="user-card">
        <h3>{user.name}</h3>
        <p>{user.email}</p>
      </div>
    )
  })

const StatsCard = (userId: number) =>
  Effect.gen(function* () {
    const stats = yield* fetchStats(userId)
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
    )
  })

const PostList = (userId: number) =>
  Effect.gen(function* () {
    const posts = yield* fetchPosts(userId)
    return (
      <ul className="post-list">
        {posts.map((post) => (
          <li key={post.id}>
            <strong>{post.title}</strong>
            <p>{post.body}</p>
          </li>
        ))}
      </ul>
    )
  })

// =============================================================================
// Fallback Components
// =============================================================================

const UserSkeleton = (
  <div className="skeleton user-skeleton">
    <div className="skeleton-line" style={{ width: "60%" }} />
    <div className="skeleton-line" style={{ width: "80%" }} />
  </div>
)

const StatsSkeleton = (
  <div className="skeleton stats-skeleton">
    <div className="skeleton-line" style={{ width: "30%" }} />
    <div className="skeleton-line" style={{ width: "30%" }} />
    <div className="skeleton-line" style={{ width: "30%" }} />
  </div>
)

const PostsSkeleton = (
  <div className="skeleton posts-skeleton">
    <div className="skeleton-line" style={{ width: "40%" }} />
    <div className="skeleton-line" style={{ width: "90%" }} />
    <div className="skeleton-line" style={{ width: "40%" }} />
    <div className="skeleton-line" style={{ width: "85%" }} />
    <div className="skeleton-line" style={{ width: "40%" }} />
    <div className="skeleton-line" style={{ width: "75%" }} />
  </div>
)

// =============================================================================
// Main Component
// =============================================================================

const SuspenseDemo = Component.gen(function* () {
  const userId = yield* Signal.make(1)
  const key = yield* Signal.make(0)

  // Read values to trigger re-render on change
  const currentUserId = yield* Signal.get(userId)
  const currentKey = yield* Signal.get(key)

  const reload = () => Signal.update(key, (k) => k + 1)
  const nextUser = () =>
    Effect.gen(function* () {
      yield* Signal.update(userId, (id) => (id % 3) + 1)
      yield* reload()
    })

  return (
    <div className="example">
      <h2>Suspense</h2>
      <p className="description">
        Async boundaries with fallback UI while loading
      </p>

      <div className="suspense-controls">
        <button onClick={reload}>Reload Data</button>
        <button onClick={nextUser}>Switch User (ID: {currentUserId})</button>
      </div>

      <div className="suspense-demo" key={currentKey}>
        <div className="suspense-section">
          <h3>User Profile (800ms)</h3>
          <Suspense fallback={UserSkeleton}>
            {UserCard(currentUserId)}
          </Suspense>
        </div>

        <div className="suspense-section">
          <h3>User Stats (800ms)</h3>
          <Suspense fallback={StatsSkeleton}>
            {StatsCard(currentUserId)}
          </Suspense>
        </div>

        <div className="suspense-section suspense-full-width">
          <h3>User Posts (1200ms)</h3>
          <Suspense fallback={PostsSkeleton}>
            {PostList(currentUserId)}
          </Suspense>
        </div>
      </div>

      <div className="code-example">
        <h3>Suspense Pattern</h3>
        <pre>{`// Async component (returns Effect<Element>)
const UserCard = (userId: number) =>
  Effect.gen(function* () {
    const user = yield* fetchUser(userId)
    return <div>{user.name}</div>
  })

// Usage with Suspense
<Suspense fallback={<Skeleton />}>
  {UserCard(userId)}
</Suspense>

// Multiple independent boundaries load in parallel
<Suspense fallback={<UserSkeleton />}>
  {UserCard(userId)}
</Suspense>
<Suspense fallback={<PostsSkeleton />}>
  {PostList(userId)}
</Suspense>`}</pre>
      </div>
    </div>
  )
})

export default SuspenseDemo
