/**
 * Resource Example
 *
 * Demonstrates:
 * - Type-safe API client with Effect HttpClient
 * - Resource.fetch for cached, deduplicated data fetching
 * - Resource.match for pattern matching with fine-grained reactivity
 * - Resource.invalidate for stale-while-revalidate
 * - Resource.refresh for hard reload
 * - Signal.each for efficient list rendering
 * - End-to-end type safety from API definition to UI
 */
import { Effect, Option } from "effect";
import { Resource, Signal, Component, type ComponentProps } from "effect-ui";

// Import type-safe resources that use Effect HttpClient
// Types are defined in the API schema and re-exported from resources
import { usersResource, userResource, userPostsResource, type User } from "../lib/resources/users";

// Alias for backwards compatibility in component usage
const postsResource = userPostsResource;

// =============================================================================
// View Components
// =============================================================================

const Skeleton = Component.gen(function* (Props: ComponentProps<{ lines?: number }>) {
  const { lines = 3 } = yield* Props;
  return (
    <div className="skeleton">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${70 + (i % 3) * 10}%` }} />
      ))}
    </div>
  );
});

const UserCard = Component.gen(function* (Props: ComponentProps<{ user: User; stale: boolean }>) {
  const { user, stale } = yield* Props;
  return (
    <div className="user-card" style={{ opacity: stale ? 0.6 : 1 }}>
      <h3>
        {user.name} {stale && <span className="stale-badge">stale</span>}
      </h3>
      <p>{user.email}</p>
      <span className="role-badge">{user.role}</span>
    </div>
  );
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ErrorView = Component.gen(function* (
  Props: ComponentProps<{ error: Error; onRetry: Effect.Effect<void, never, any> }>,
) {
  const { error, onRetry } = yield* Props;
  return (
    <div className="error-card">
      <strong>Error</strong>
      <p>{error.message}</p>
      <button onClick={onRetry}>Try Again</button>
    </div>
  );
});

// =============================================================================
// Resource-backed Components
// =============================================================================

/**
 * UsersList using Resource API and Signal.each for list rendering.
 */
const UsersList = Component.gen(function* (
  Props: ComponentProps<{ onSelect: (id: string) => Effect.Effect<void> }>,
) {
  const { onSelect } = yield* Props;
  const state = yield* Resource.fetch(usersResource);

  return yield* Resource.match(state, {
    Pending: () => <Skeleton lines={4} />,

    Success: (users, stale) => {
      // Convert to Signal for Signal.each
      const usersSignal = Signal.unsafeMake(users);

      return (
        <div className="users-list" style={{ opacity: stale ? 0.6 : 1 }}>
          <div className="list-header">
            <span>
              {users.length} users {stale && "(refreshing...)"}
            </span>
            <button onClick={Resource.invalidate(usersResource)} disabled={stale}>
              Refresh
            </button>
          </div>
          <ul>
            {Signal.each(
              usersSignal,
              (user) =>
                Effect.succeed(
                  <li className="user-item" onClick={onSelect(user.id)}>
                    <span className="user-name">{user.name}</span>
                    <span className="user-role">{user.role}</span>
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

/**
 * UserDetail using Resource API with Signal.chain for reactive switching.
 *
 * When userId changes, Signal.chain:
 * 1. Calls Resource.fetch for the new user
 * 2. Switches to the new resource's state signal
 * 3. The UI automatically updates to show the new user's data
 */
const UserDetail = Component.gen(function* (
  Props: ComponentProps<{ userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;

  // Chain resource state from userId - automatically switches when userId changes
  const state = yield* Signal.chain(userId, (id) => Resource.fetch(userResource({ id })));

  // Get current id for button handlers (they need the resource reference)
  const currentId = yield* Signal.derive(userId, (id) => id);

  return yield* Resource.match(state, {
    Pending: () => <Skeleton lines={3} />,

    Success: (user, stale) => (
      <div className="resource-content">
        <UserCard user={user} stale={stale} />
        <div className="resource-actions">
          <button
            onClick={Signal.get(currentId).pipe(
              Effect.flatMap((id) => Resource.invalidate(userResource({ id }))),
            )}
            disabled={stale}
          >
            {stale ? "Refreshing..." : "Refresh (Stale)"}
          </button>
          <button
            onClick={Signal.get(currentId).pipe(
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
            onRetry={Signal.get(currentId).pipe(
              Effect.flatMap((id) => Resource.refresh(userResource({ id }))),
            )}
          />
        ),
        onSome: (user) => (
          <div className="resource-content">
            <div className="error-banner">
              Failed to refresh: {error.message}
              <button
                onClick={Signal.get(currentId).pipe(
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

/**
 * UserPosts using Resource API with Signal.chain for reactive switching.
 *
 * When userId changes, automatically fetches the new user's posts.
 */
const UserPosts = Component.gen(function* (
  Props: ComponentProps<{ userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;

  // Derive resource state from userId - automatically switches when userId changes
  const state = yield* Signal.chain(userId, (id) => Resource.fetch(postsResource({ id })));

  // Get current id for button handlers
  const currentId = yield* Signal.derive(userId, (id) => id);

  return yield* Resource.match(state, {
    Pending: () => <Skeleton lines={6} />,

    Success: (posts, stale) => {
      const postsSignal = Signal.unsafeMake(posts);

      return (
        <div className="resource-content" style={{ opacity: stale ? 0.6 : 1 }}>
          <ul className="post-list">
            {Signal.each(
              postsSignal,
              (post) =>
                Effect.succeed(
                  <li>
                    <strong>{post.title}</strong>
                    <p>{post.body}</p>
                  </li>,
                ),
              { key: (post) => post.id },
            )}
            {posts.length === 0 && <li className="empty">No posts found</li>}
          </ul>
          <div className="resource-actions">
            <button
              onClick={Signal.get(currentId).pipe(
                Effect.flatMap((id) => Resource.invalidate(postsResource({ id }))),
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
            onRetry={Signal.get(currentId).pipe(
              Effect.flatMap((id) => Resource.refresh(postsResource({ id }))),
            )}
          />
        ),
        onSome: (posts) => {
          const postsSignal = Signal.unsafeMake(posts);
          return (
            <div className="resource-content">
              <div className="error-banner">Failed to refresh</div>
              <ul className="post-list stale">
                {Signal.each(
                  postsSignal,
                  (post) =>
                    Effect.succeed(
                      <li>
                        <strong>{post.title}</strong>
                        <p>{post.body}</p>
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

// =============================================================================
// Main Demo Component
// =============================================================================

const ResourceDemo = Component.gen(function* () {
  const selectedUserId = yield* Signal.make("1");

  const selectUser = (id: string) => Signal.set(selectedUserId, id);

  return (
    <div className="example">
      <h2>Resource</h2>
      <p className="description">
        Cached, deduplicated data fetching with API routes and Signal.each for lists
      </p>

      <div className="resource-demo resource-layout">
        <div className="resource-section resource-sidebar">
          <h3>Users List (API: /api/users)</h3>
          <UsersList onSelect={selectUser} />
        </div>

        <div className="resource-main">
          <div className="resource-section">
            <h3>
              User Detail (API: /api/users/
              {selectedUserId})
            </h3>
            <UserDetail userId={selectedUserId} />
          </div>

          <div className="resource-section">
            <h3>
              User Posts (API: /api/users/
              {selectedUserId}
              /posts)
            </h3>
            <UserPosts userId={selectedUserId} />
          </div>
        </div>
      </div>

      <div className="code-example">
        <h3>Type-Safe API Client Pattern</h3>
        <pre>{`// 1. Define API route (app/api/users/group.ts)
export const group = HttpApiGroup.make("users")
  .add(HttpApiEndpoint.get("getUser", "/api/users/:id")
    .setPath(Schema.Struct({ id: Schema.String }))
    .addSuccess(User)
    .addError(UserNotFound))

// 2. Create type-safe client from API definition
import { api } from "virtual:effect-ui-api"
import { HttpApiClient } from "@effect/platform"

const client = HttpApiClient.make(api, { baseUrl: "" })

// 3. Define resource using typed client
// Types inferred: Resource<User, UserNotFound | HttpClientError>
const userResource = (id: string) => Resource.make({
  key: \`user:\${id}\`,
  fetch: Effect.flatMap(client, c => 
    c.users.getUser({ path: { id } })
  )
})

// 4. Use Resource.match - error type is known!
return yield* Resource.match(state, {
  Pending: () => <Skeleton />,
  Success: (user, stale) => <UserCard user={user} />,
  Failure: (error, staleUser) => 
    error._tag === "UserNotFound" 
      ? <NotFound /> 
      : <ErrorView error={error} />
})`}</pre>
      </div>

      <div className="code-example">
        <h3>Signal.each for Lists</h3>
        <pre>{`// Signal.each maintains stable scopes per key
// Nested signals are preserved across list updates

Success: (users, stale) => {
  const usersSignal = Signal.unsafeMake(users)
  
  return (
    <ul>
      {Signal.each(
        usersSignal,
        (user) => Effect.succeed(
          <li onClick={selectUser(user.id)}>
            {user.name}
          </li>
        ),
        { key: (user) => user.id }
      )}
    </ul>
  )
}`}</pre>
      </div>

      <div className="code-example">
        <h3>Key Features</h3>
        <ul className="feature-list">
          <li>
            <strong>HttpApiClient:</strong> Type-safe API calls - types flow from definition
          </li>
          <li>
            <strong>Typed Errors:</strong> Error types inferred from API schema (e.g., UserNotFound)
          </li>
          <li>
            <strong>Caching:</strong> Same key = same data (click users to see cache hits)
          </li>
          <li>
            <strong>Signal.each:</strong> Efficient list rendering with stable keys
          </li>
          <li>
            <strong>Stale-while-revalidate:</strong> Shows stale UI during refresh
          </li>
          <li>
            <strong>Error resilience:</strong> Failed refresh preserves stale data
          </li>
        </ul>
      </div>
    </div>
  );
});

export default ResourceDemo;
