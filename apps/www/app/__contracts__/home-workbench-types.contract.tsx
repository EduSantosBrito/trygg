/**
 * Type-inference contract for the home workbench example code.
 *
 * Mirrors the code shown in `sections.seam.steps[1]` (UserList) and
 * `sections.seam.steps[2]` (the page) and uses `Types.Equals` to assert that
 * the actual inferred types match the signatures advertised in the tooltips.
 *
 * If these assertions break, the workbench tooltips have drifted from reality.
 */

import { Context, Effect, Layer, Scope, type Types } from "effect";
import { Component, Resource, Signal, type ComponentProps } from "trygg";

// ---------------------------------------------------------------------------
// Minimal API surface assumed by the example
// ---------------------------------------------------------------------------

interface User {
  readonly id: string;
  readonly name: string;
}

interface ApiError {
  readonly _tag: "ApiError";
  readonly message: string;
}

interface ApiClientService {
  readonly users: {
    readonly list: () => Effect.Effect<ReadonlyArray<User>, ApiError>;
  };
}

class ApiClient extends Context.Service<ApiClient, ApiClientService>()("App/ApiClient") {}

const ApiClientLive: Layer.Layer<ApiClient> = Layer.succeed(ApiClient, {
  users: { list: () => Effect.succeed([] as ReadonlyArray<User>) },
});

// ---------------------------------------------------------------------------
// Step 02 — UserList: Component<{ state: Signal<Resource.ResourceState<...>> }>
// ---------------------------------------------------------------------------

type UserListProps = {
  readonly state: Signal.Signal<Resource.ResourceState<ReadonlyArray<User>, ApiError>>;
};

const UserList = Component.gen(function* (props: ComponentProps<UserListProps>) {
  const { state } = yield* props;
  return yield* Resource.match(state).pipe(
    Resource.on("Pending", () => <p>Loading users…</p>),
    Resource.on("Success", ({ value }: { value: ReadonlyArray<User> }) => (
      <ul>
        {value.map((u) => (
          <li key={u.id}>{u.name}</li>
        ))}
      </ul>
    )),
    Resource.on("Failure", ({ error }) => <p>{error.message}</p>),
    Resource.exhaustive,
  );
});

// ---------------------------------------------------------------------------
// Step 03 — Resource + Component.provide
// ---------------------------------------------------------------------------

const users = Resource.make(
  () =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.users.list();
    }),
  { key: "users.list" },
);

const UsersPage = Component.gen(function* () {
  const state = yield* Resource.fetch(users);
  return <UserList state={state} />;
}).pipe(Component.provide(ApiClientLive));

// ---------------------------------------------------------------------------
// Type assertions — the tooltips in home.tsx claim these signatures.
// `Types.Equals` resolves to `true` when its two type arguments are identical.
// ---------------------------------------------------------------------------

type AssertTrue<T extends true> = T;

// Tooltip: `users: Resource<readonly User[], ApiError, ApiClient>`
type _UsersIsResourceOfUsers = AssertTrue<
  Types.Equals<typeof users, Resource.Resource<ReadonlyArray<User>, ApiError, ApiClient>>
>;

// Tooltip: `state: Signal<Resource.ResourceState<readonly User[], ApiError>>`
// (the signature of the `state` symbol bound by `yield* Resource.fetch(users)`)
type StateInUsersPage = Signal.Signal<Resource.ResourceState<ReadonlyArray<User>, ApiError>>;
const _proveStateSignature = (
  state: Signal.Signal<Resource.ResourceState<ReadonlyArray<User>, ApiError>>,
): StateInUsersPage => state;

// Debug surface: expose the actual inferred shapes so a hover or a deliberate
// type comparison reveals what trygg produces.
export type _UserListType = typeof UserList;
export type _UsersPageType = typeof UsersPage;

// Tooltip: `UserList: Component<{ state: Signal<Resource.ResourceState<User[], ApiError>> }>`
// Verify the Props slot specifically — _E and _R are intentionally omitted in
// the tooltip for readability.
type _UserListProps = AssertTrue<
  Types.Equals<
    typeof UserList extends Component.Type<infer P, infer _E, infer _R> ? P : never,
    UserListProps
  >
>;

// Probe: Resource.exhaustive covers all three resource states (Pending,
// Success, Failure). Disposed signal access is reported as a diagnostic defect,
// not as a typed component error channel.
type _UserListErrorIsNever = AssertTrue<
  Types.Equals<
    typeof UserList extends Component.Type<infer _P, infer E, infer _R> ? E : never,
    never
  >
>;

// Probe: UserList only needs Scope.Scope (added by Resource.exhaustive itself
// — see packages/core/src/primitives/resource.ts:1224-1225).
type _UserListR = AssertTrue<
  Types.Equals<
    typeof UserList extends Component.Type<infer _P, infer _E, infer R> ? R : never,
    Scope.Scope
  >
>;

// `.pipe(Component.provide(ApiClientLive))` should remove ApiClient from R.
type _UsersPageDoesNotRequireApiClient = AssertTrue<
  Types.Equals<
    typeof UsersPage extends Component.Type<infer _P, infer _E, infer R> ? R : never,
    Exclude<
      typeof UsersPage extends Component.Type<infer _P, infer _E, infer R> ? R : never,
      ApiClient
    >
  >
>;

// Surface the assertions so `noUnusedLocals` doesn't elide them.
export type WorkbenchTypeContract = [
  _UsersIsResourceOfUsers,
  _UserListProps,
  _UserListErrorIsNever,
  _UserListR,
  _UsersPageDoesNotRequireApiClient,
];

export { UserList, UsersPage, users, _proveStateSignature };
