# Future Solutions (effect-ui)

## Status: Ready for Implementation
**Last Updated:** 2026-01-20
**Architect:** OpenCode

---

## Solution Index
| ID | Finding | Category | Priority | Status | Solution Link |
|----|---------|----------|----------|--------|---------------|
| FUT-001 | API Routes (Effect HttpApi integration) | Feature/Security | HIGH | ✅ Ready | [Link](#fut-001) |
| FUT-002 | Resource API (data fetching) | Feature/Performance | HIGH | ✅ Ready | [Link](#fut-002) |

---

## Detailed Solutions

### FUT-001: API Routes (effect-first, platform-agnostic)
**Status:** ✅ Ready
**Category:** Feature / Security / Reliability
**Priority:** HIGH
**Files Affected:** `src/vite-plugin.ts`, `src/api.ts` (new), `src/server/*` (new), `src/index.ts`, `docs/design.md`

#### TL;DR
File-based API route discovery in `app/api/` using `route.ts` (single endpoint) and `group.ts` (multiple endpoints). Zero config - uses `app/` directory convention like Next.js. Standard Effect Platform `HttpApiEndpoint` and `HttpApiGroup` with type utilities. Build-time validation via `ssrLoadModule`. Server handled internally - dev middleware + production build.

#### Effort Estimate
**High** (~5-6 days)
- Vite plugin extension: 1.5 days
- Type utilities + validation: 1 day
- Dev server middleware: 1 day
- Production server build: 1 day
- Integration glue + docs: 0.5-1 day

#### Risk Estimate
**Low-Medium**
- Effect HttpApi is stable and well-documented
- Main risk: API surface changes in Effect Platform (mitigated by pinning versions)
- File-system scanning already proven in route discovery

#### Original Finding
> API routes with `src/api/**/route.ts` convention, schema-driven validation, build-time checks, and per-app error mapping. Platform agnostic; adapters inject platform services.

#### Clarifying Questions
1. How is platform selected?
   - **Answer:** Effect Platform adapters (`@effect/platform-node`, `@effect/platform-bun`) selected by user in their server entry. No effect-ui config needed.
2. Build-time integration location?
   - **Answer:** Existing Vite plugin.
3. Client surface?
   - **Answer:** Use Effect's `HttpApiClient.make` directly. effect-ui generates the `HttpApi` definition.
4. Error mapping policy?
   - **Answer:** Use Effect's `HttpApiError` patterns—errors with `status` field map directly.
5. Build-time validation strategy?
   - **Answer:** `ssrLoadModule` to evaluate route modules, validate exports, types, and path matching.
6. Internal manifest strategy?
   - **Answer:** `virtual:effect-ui-api` exports the composed `HttpApi` definition and type-safe handler layer.

#### Analysis
Effect Platform already provides `HttpApi`, `HttpApiBuilder`, `HttpApiGroup`, `HttpApiEndpoint`, and `HttpApiClient`. Building a parallel system would duplicate effort and create API inconsistency. The value-add for effect-ui is:
1. **File-based discovery** - Auto-discover `app/api/**/route.ts` and `group.ts`
2. **Build-time validation** - Fail fast on missing exports, type mismatches, path conflicts
3. **Type generation** - Emit `api-routes.d.ts` for IDE support
4. **Type utilities** - `Api.Handler<E>` for compile-time handler validation

#### File Convention

| File | Export | Contains | When to Use |
|------|--------|----------|-------------|
| `route.ts` | `endpoint` + `handler` | Single `HttpApiEndpoint` | One HTTP method on this path |
| `group.ts` | `group` + `handlers` | `HttpApiGroup` | Multiple HTTP methods on this path |

#### Type Utilities

```typescript
// effect-ui/api.ts
import type { HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import type { Effect } from "effect"

/**
 * Extract handler signature from an HttpApiEndpoint.
 * Provides compile-time type checking without runtime overhead.
 */
export type Handler<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  (request: HttpApiEndpoint.Request<E>) => Effect.Effect<
    HttpApiEndpoint.Success<E>,
    HttpApiEndpoint.Error<E>,
    any  // R is inferred from implementation
  >

/**
 * Extract handlers map signature from an HttpApiGroup.
 * Keys are endpoint names, values are handler functions.
 */
export type GroupHandlers<G extends HttpApiGroup.HttpApiGroup.Any> = {
  [K in HttpApiGroup.EndpointName<G>]: Handler<HttpApiGroup.Endpoint<G, K>>
}

/**
 * Extract request type from endpoint (path, payload, headers, urlParams)
 */
export type Request<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  HttpApiEndpoint.Request<E>

/**
 * Extract success type from endpoint
 */
export type Success<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  HttpApiEndpoint.Success<E>

/**
 * Extract error type from endpoint
 */
export type Error<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  HttpApiEndpoint.Error<E>
```

#### Proposed Solution

**Single endpoint (`app/api/users/[id]/route.ts`):**
```typescript
import { HttpApiEndpoint } from "@effect/platform"
import { Schema } from "effect"
import type { Api } from "effect-ui"

// Standard HttpApiEndpoint - path must match filesystem
// Filesystem: app/api/users/[id] → /api/users/:id
export const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id")
  .setPath(Schema.Struct({ id: Schema.String }))
  .addSuccess(UserSchema)
  .addError(NotFoundError)

// Type annotation provides compile-time validation
export const handler: Api.Handler<typeof endpoint> = ({ path }) =>
  UserService.findById(path.id)
```

**Multiple methods (`app/api/users/[id]/group.ts`):**
```typescript
import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"
import type { Api } from "effect-ui"

const get = HttpApiEndpoint.get("getUser", "/api/users/:id")
  .setPath(Schema.Struct({ id: Schema.String }))
  .addSuccess(UserSchema)

const update = HttpApiEndpoint.put("updateUser", "/api/users/:id")
  .setPath(Schema.Struct({ id: Schema.String }))
  .setPayload(UpdateUserSchema)
  .addSuccess(UserSchema)

const remove = HttpApiEndpoint.del("deleteUser", "/api/users/:id")
  .setPath(Schema.Struct({ id: Schema.String }))
  .addSuccess(Schema.Void)

export const group = HttpApiGroup.make("usersById")
  .add(get)
  .add(update)
  .add(remove)

export const handlers: Api.GroupHandlers<typeof group> = {
  getUser: ({ path }) => UserService.findById(path.id),
  updateUser: ({ path, payload }) => UserService.update(path.id, payload),
  deleteUser: ({ path }) => UserService.delete(path.id)
}
```

**Collection endpoints (`app/api/users/group.ts`):**
```typescript
import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import type { Api } from "effect-ui"

const list = HttpApiEndpoint.get("listUsers", "/api/users")
  .setUrlParams(Schema.Struct({
    page: Schema.NumberFromString.pipe(Schema.optional),
    limit: Schema.NumberFromString.pipe(Schema.optional)
  }))
  .addSuccess(Schema.Array(UserSchema))

const create = HttpApiEndpoint.post("createUser", "/api/users")
  .setPayload(CreateUserSchema)
  .addSuccess(UserSchema)
  .addError(ValidationError)

export const group = HttpApiGroup.make("users")
  .add(list)
  .add(create)

export const handlers: Api.GroupHandlers<typeof group> = {
  listUsers: ({ urlParams }) => UserService.list(urlParams.page ?? 1, urlParams.limit ?? 20),
  createUser: ({ payload }) => UserService.create(payload)
}
```

**Build-time (Vite plugin):**
- Scan `app/api/**/route.ts` and `app/api/**/group.ts`
- Use `ssrLoadModule` to evaluate each module
- Validate export types:
  - `route.ts` must export `HttpApiEndpoint` (not `HttpApiGroup`)
  - `group.ts` must export `HttpApiGroup` (not `HttpApiEndpoint`)
- Validate path matching:
  - Endpoint paths must match filesystem-derived path
  - Group endpoints must be within directory scope
- Detect conflicts:
  - Same method+path in multiple files
- Generate `virtual:effect-ui-api` with explicit handler chain
- Emit `api-routes.d.ts` for typed imports

**Generated virtual module (`virtual:effect-ui-api`):**
```typescript
// Auto-generated by effect-ui vite plugin
import { HttpApi, HttpApiBuilder, HttpApiGroup, Layer } from "@effect/platform"
import * as UsersGroup from "./app/api/users/group.js"
import * as UsersIdGroup from "./app/api/users/[id]/group.js"

// Compose API definition
export const api = HttpApi.make("app")
  .add(UsersGroup.group)
  .add(UsersIdGroup.group)

// Type-safe handler layer (explicit chain - full type safety)
export const ApiLive = Layer.mergeAll(
  HttpApiBuilder.group(api, "users", (handlers) =>
    handlers
      .handle("listUsers", UsersGroup.handlers.listUsers)
      .handle("createUser", UsersGroup.handlers.createUser)
  ),
  HttpApiBuilder.group(api, "usersById", (handlers) =>
    handlers
      .handle("getUser", UsersIdGroup.handlers.getUser)
      .handle("updateUser", UsersIdGroup.handlers.updateUser)
      .handle("deleteUser", UsersIdGroup.handlers.deleteUser)
  )
)
```

**Server (internal - handled by effect-ui):**

The Vite plugin handles server setup automatically:
- Dev: API routes served via Vite dev server middleware
- Prod: `bun run build` generates server bundle, `bun run start` runs it
- User provides services via `app/services.ts` export

```typescript
// app/services.ts (user code)
import { Layer } from "effect"
import { UserRepositoryLive, AuthServiceLive } from "@/lib/services/index.js"

// effect-ui provides this layer to all API handlers
export const services = Layer.mergeAll(
  UserRepositoryLive,
  AuthServiceLive
)
```

**Client usage (user code):**
```typescript
import { api } from "virtual:effect-ui-api"
import { HttpApiClient } from "@effect/platform"

const client = yield* HttpApiClient.make(api, { baseUrl: "/api" })
const user = yield* client.usersById.getUser({ path: { id: "123" } })
```

**Path param rules (same as page routes):**
| Filesystem | Derived Path | Param Schema Requirement |
|------------|--------------|--------------------------|
| `[id]/route.ts` | `/:id` | `{ id: Schema.String }` |
| `[...rest]/route.ts` | `/*` | `{ rest: Schema.String }` |
| `users/route.ts` | `/users` | (none) |

#### Build-Time Validation

**Export type checking:**
```
ERROR: Export type mismatch in app/api/users/route.ts

  route.ts must export HttpApiEndpoint, not HttpApiGroup.
  
  Found: HttpApiGroup
  Expected: HttpApiEndpoint
  
  For multiple endpoints, rename file to group.ts
```

**Path mismatch detection:**
```
ERROR: Path mismatch in app/api/users/[id]/route.ts

  Filesystem expects: /api/users/:id
  Endpoint declares:  /api/users/:userId
  
  The endpoint path must match the filesystem location.
  Either:
    1. Update endpoint: HttpApiEndpoint.get("...", "/api/users/:id")
    2. Move file to match declared path
```

**Path scope validation (for groups):**
```
ERROR: Path outside directory scope in app/api/users/[id]/group.ts

  Endpoint "getPosts" has path: /api/users/:id/posts
  Directory scope allows:       /api/users/:id
  
  Move this endpoint to app/api/users/[id]/posts/route.ts
  or app/api/users/[id]/posts/group.ts
```

**Conflict detection:**
```
ERROR: Duplicate endpoint path

  POST /api/users defined in multiple files:
    - app/api/users/group.ts (endpoint "createUser")
    - app/api/users/create/route.ts (endpoint "createUser")
  
  Remove one definition or use different paths.
```

**Missing handler detection:**
```
ERROR: Missing handler in app/api/users/group.ts

  Group defines endpoints: listUsers, createUser
  Handlers exported for:   listUsers
  
  Missing handler for: createUser
```

#### Implementation Plan
1. [ ] Update Vite plugin to use `app/` directory by default (zero config)
2. [ ] Add type utilities to `src/api.ts` (`Api.Handler`, `Api.GroupHandlers`)
3. [ ] Add `scanApiRoutes()` to Vite plugin (scan `app/api/` for route.ts and group.ts)
4. [ ] Add `validateApiRoute()` using `ssrLoadModule`:
   - Export type checking (endpoint vs group)
   - Path matching validation
   - Path scope validation for groups
   - Handler completeness check
5. [ ] Add conflict detection (duplicate method+path)
6. [ ] Generate `virtual:effect-ui-api` module with explicit handler chain
7. [ ] Generate `api-routes.d.ts` for virtual module types
8. [ ] Add dev server middleware for API routes (Vite plugin `configureServer`)
9. [ ] Add production server generation (`bun run build` outputs server bundle)
10. [ ] Add `app/services.ts` convention for user-provided service layers
11. [ ] Add docs section in `docs/design.md`
12. [ ] Tests (see below)

#### Tests

**Happy Path:**
| Case | Input | Expected |
|------|-------|----------|
| Valid route.ts | Single endpoint + handler | Build succeeds, endpoint in virtual module |
| Valid group.ts | Group with 3 endpoints + handlers | Build succeeds, all endpoints composed |
| Nested routes | `users/group.ts` + `users/[id]/route.ts` | Both composed correctly |
| Path params match | `[id]/route.ts` with path `/api/users/:id` | Build succeeds |

**Error Cases:**
| Case | Input | Expected |
|------|-------|----------|
| Wrong export type | `route.ts` exports HttpApiGroup | Build fails: "route.ts must export HttpApiEndpoint" |
| Missing endpoint | `route.ts` without `export const endpoint` | Build fails: "route.ts must export 'endpoint'" |
| Missing handler | `route.ts` without `export const handler` | Build fails: "route.ts must export 'handler'" |
| Missing group handler | `group.ts` missing one handler | Build fails: "Missing handler for: endpointName" |
| Path mismatch | `[id]/route.ts` with path `/api/users/:userId` | Build fails: "Path mismatch" |
| Path outside scope | Group endpoint path beyond directory | Build fails: "Path outside directory scope" |
| Duplicate path | Same method+path in two files | Build fails: "Duplicate endpoint path" |

**Edge Cases:**
| Case | Input | Expected |
|------|-------|----------|
| Catch-all | `[...path]/route.ts` | Path `/*`, schema requires `path` key |
| No API routes | Empty `app/api/` | Virtual module exports empty `HttpApi` |
| Deeply nested | `app/api/v1/users/[id]/posts/[postId]/route.ts` | Correct path composition |

#### Verification
- [ ] `bun run build` fails with actionable message on export type mismatch
- [ ] Path mismatch shows both filesystem and declared paths in error
- [ ] Generated `virtual:effect-ui-api` has explicit handler chain (type-safe)
- [ ] `HttpApiClient.make(api)` works with generated api definition
- [ ] Hot reload regenerates virtual module when route files change
- [ ] `bun run dev` serves API routes via Vite middleware
- [ ] `bun run build && bun run start` runs production server
- [ ] Services from `app/services.ts` are provided to handlers

---

### FUT-002: Data Fetching Resource API
**Status:** ✅ Ready
**Category:** Feature / Performance
**Priority:** HIGH
**Files Affected:** `src/Resource.ts` (new), `src/index.ts`, `docs/design.md`

#### TL;DR
`Resource` module for cached, deduplicated data fetching. `Resource.make` creates a descriptor, `Resource.fetch` returns a `Signal<ResourceState<A, E>>`, `Resource.match` uses `Signal.derive` for fine-grained rendering. Stale-while-revalidate via `Resource.invalidate` with dedupe. Failure state preserves stale value when available.

#### Effort Estimate
**Medium** (~2-3 days)
- Core types + registry: 0.5 days
- fetch/invalidate/refresh with dedupe: 1 day
- match helper + tests: 0.5-1 day
- Docs: 0.5 days

#### Risk Estimate
**Low**
- Uses existing Signal infrastructure
- Simple key-based caching (no complex normalization)
- Clear state machine (Pending → Success | Failure)

#### Original Finding
> Resource-based data fetching with `Data.resource`, `Data.fetch`, and `Data.match`. Inline failure handling; no boundary-first variant.

#### Clarifying Questions
1. Should `Resource.fetch` be the only entry (no `fetchOrFail`)?
   - **Answer:** Yes. Only `Resource.fetch`.
2. Should failures be handled inline via `Resource.match` (error boundary style)?
   - **Answer:** Yes. Failure branch returns an element.
3. Should resources be cached by key across mounts and dedupe concurrent requests?
   - **Answer:** Yes.
4. Do you want an explicit invalidation/refetch API?
   - **Answer:** Yes. `Resource.invalidate` and `Resource.refresh`, both with dedupe.
5. Should failure preserve stale data when available?
   - **Answer:** Yes. Failure includes `staleValue: Option<A>`.

#### Analysis
No data fetching layer exists. The desired DX is Effect-first, schema-agnostic, and UI-friendly. Caching + dedupe require a shared registry to persist across component lifetimes while remaining explicit and controllable. Naming as `Resource` avoids conflict with `effect/Data`.

#### Proposed Solution

**Naming:** `Resource` module exported from `effect-ui`. Users import: `import { Resource } from "effect-ui"`.

**Core Types:**
```typescript
// src/Resource.ts
import { Context, Data, Deferred, Effect, Match, Option, Ref } from "effect"
import type { Signal } from "./Signal"

/** State of a resource fetch */
export type ResourceState<A, E> = Data.TaggedEnum<{
  Pending: {}
  Success: { readonly value: A; readonly stale: boolean }
  Failure: { 
    readonly error: E
    readonly staleValue: Option.Option<A>  // Previous success if any
  }
}>

// Type-safe constructors
export const Pending = <A, E>(): ResourceState<A, E> =>
  Data.tagged<ResourceState<A, E>>("Pending")()

export const Success = <A, E>(value: A, stale: boolean = false): ResourceState<A, E> =>
  Data.tagged<ResourceState<A, E>>("Success")({ value, stale })

export const Failure = <A, E>(error: E, staleValue: Option.Option<A> = Option.none()): ResourceState<A, E> =>
  Data.tagged<ResourceState<A, E>>("Failure")({ error, staleValue })

/** Resource descriptor - what to fetch and how */
export interface Resource<A, E, R> {
  readonly _tag: "Resource"
  readonly key: string
  readonly fetch: Effect.Effect<A, E, R>
}

/** Registry entry for internal state management (type-erased) */
interface RegistryEntry {
  readonly state: Signal.Signal<ResourceState<unknown, unknown>>
  readonly inFlight: Ref.Ref<Option.Option<Deferred.Deferred<void, never>>>
  readonly timestamp: Ref.Ref<number>
}

/** Registry service for caching resources */
export interface ResourceRegistry {
  readonly _tag: "ResourceRegistry"
  readonly get: (key: string) => Effect.Effect<Option.Option<RegistryEntry>>
  readonly getOrCreate: (key: string) => Effect.Effect<RegistryEntry>
  readonly delete: (key: string) => Effect.Effect<void>
}

export const ResourceRegistry = Context.GenericTag<ResourceRegistry>("effect-ui/ResourceRegistry")
```

**API Signatures:**
```typescript
/** Create a resource descriptor */
export const make: <A, E, R>(config: {
  readonly key: string
  readonly fetch: Effect.Effect<A, E, R>
}) => Resource<A, E, R>

/** 
 * Fetch a resource, returning reactive state signal.
 * - Starts fetch if no cached state or if invalidated
 * - Dedupes concurrent fetches via Deferred
 * - R must be provided before calling (R = never in component)
 */
export const fetch: <A, E>(
  resource: Resource<A, E, never>
) => Effect.Effect<Signal.Signal<ResourceState<A, E>>, never, ResourceRegistry>

/**
 * Pattern match on resource state for rendering.
 * Uses Signal.derive for fine-grained updates - component renders once,
 * derived signal updates Element when state changes.
 */
export const match: <A, E>(
  state: Signal.Signal<ResourceState<A, E>>,
  handlers: {
    readonly Pending: () => Element
    readonly Success: (value: A, stale: boolean) => Element
    readonly Failure: (error: E, staleValue: Option.Option<A>) => Element
  }
) => Effect.Effect<Element, never, Scope.Scope>

/**
 * Mark resource as stale and trigger background refetch.
 * Preserves current Success value with stale=true during refetch.
 * Dedupes: no-op if fetch already in progress.
 */
export const invalidate: <A, E>(
  resource: Resource<A, E, never>
) => Effect.Effect<void, never, ResourceRegistry>

/**
 * Force immediate refetch, transitioning to Pending first.
 * Does not preserve stale value.
 * Dedupes: waits for in-progress fetch if any.
 */
export const refresh: <A, E>(
  resource: Resource<A, E, never>
) => Effect.Effect<void, never, ResourceRegistry>
```

**Implementation - Resource.match with Signal.derive:**
```typescript
export const match = <A, E>(
  state: Signal.Signal<ResourceState<A, E>>,
  handlers: {
    readonly Pending: () => Element
    readonly Success: (value: A, stale: boolean) => Element
    readonly Failure: (error: E, staleValue: Option.Option<A>) => Element
  }
): Effect.Effect<Element, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Derive a Signal<Element> from the state signal
    const elementSignal = yield* Signal.derive(state, (s) =>
      Match.value(s).pipe(
        Match.tag("Pending", () => handlers.Pending()),
        Match.tag("Success", ({ value, stale }) => handlers.Success(value, stale)),
        Match.tag("Failure", ({ error, staleValue }) => 
          handlers.Failure(error as E, staleValue as Option.Option<A>)
        ),
        Match.exhaustive
      )
    )
    
    // Return SignalElement for fine-grained updates
    return Element.SignalElement({ signal: elementSignal })
  })
```

**Implementation - fetch with dedupe:**
```typescript
const fetchInternal = <A, E>(
  resource: Resource<A, E, never>,
  entry: RegistryEntry
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const state = entry.state as Signal.Signal<ResourceState<A, E>>
    
    // Start new fetch
    const deferred = yield* Deferred.make<void, never>()
    yield* Ref.set(entry.inFlight, Option.some(deferred))
    
    yield* resource.fetch.pipe(
      Effect.tap((value) => 
        Signal.set(state, Success<A, E>(value, false))
      ),
      Effect.tapError((error) =>
        Effect.gen(function* () {
          const prev = yield* Signal.get(state)
          const staleValue = prev._tag === "Success" 
            ? Option.some(prev.value as A)
            : Option.none()
          yield* Signal.set(state, Failure<A, E>(error as E, staleValue))
        })
      ),
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Deferred.succeed(deferred, void 0)
          yield* Ref.set(entry.inFlight, Option.none())
          yield* Ref.set(entry.timestamp, Date.now())
        })
      ),
      Effect.fork
    )
  })

export const fetch = <A, E>(
  resource: Resource<A, E, never>
): Effect.Effect<Signal.Signal<ResourceState<A, E>>, never, ResourceRegistry> =>
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    const entry = yield* registry.getOrCreate(resource.key)
    const state = entry.state as Signal.Signal<ResourceState<A, E>>
    
    const currentInFlight = yield* Ref.get(entry.inFlight)
    
    // Dedupe: if fetch in progress, wait for it
    if (Option.isSome(currentInFlight)) {
      yield* Deferred.await(currentInFlight.value)
      return state
    }
    
    // Check if we have cached data
    const currentState = yield* Signal.get(state)
    if (currentState._tag !== "Pending") {
      // Already have data (Success or Failure), return cached
      return state
    }
    
    // Start fetch
    yield* fetchInternal(resource, entry)
    
    return state
  })
```

**Implementation - invalidate with dedupe:**
```typescript
export const invalidate = <A, E>(
  resource: Resource<A, E, never>
): Effect.Effect<void, never, ResourceRegistry> =>
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    const maybeEntry = yield* registry.get(resource.key)
    
    if (Option.isNone(maybeEntry)) return  // Nothing to invalidate
    
    const entry = maybeEntry.value
    const state = entry.state as Signal.Signal<ResourceState<A, E>>
    const currentInFlight = yield* Ref.get(entry.inFlight)
    
    // Dedupe: if already fetching, no-op
    if (Option.isSome(currentInFlight)) {
      return  // Fetch in progress, will get fresh data
    }
    
    // Mark current success as stale
    const currentState = yield* Signal.get(state)
    if (currentState._tag === "Success") {
      yield* Signal.set(state, Success<A, E>(currentState.value as A, true))
    }
    
    // Trigger background refetch
    yield* fetchInternal(resource, entry)
  })

export const refresh = <A, E>(
  resource: Resource<A, E, never>
): Effect.Effect<void, never, ResourceRegistry> =>
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    const entry = yield* registry.getOrCreate(resource.key)
    const state = entry.state as Signal.Signal<ResourceState<A, E>>
    
    const currentInFlight = yield* Ref.get(entry.inFlight)
    
    // Dedupe: if already fetching, wait for it
    if (Option.isSome(currentInFlight)) {
      yield* Deferred.await(currentInFlight.value)
      return
    }
    
    // Go to Pending (unlike invalidate which keeps stale)
    yield* Signal.set(state, Pending<A, E>())
    
    // Trigger fetch
    yield* fetchInternal(resource, entry)
  })
```

**Usage Example:**
```typescript
import { Resource } from "effect-ui"
import { Effect, Option } from "effect"

// Define resource
const userResource = Resource.make({
  key: "user:123",
  fetch: Effect.gen(function* () {
    const client = yield* ApiClient
    return yield* client.getUser("123")
  }).pipe(Effect.provide(ApiClientLive))  // R = never
})

// Component
const UserProfile = Effect.gen(function* () {
  const state = yield* Resource.fetch(userResource)
  
  // Returns Element that auto-updates when state changes
  // Component renders once, Signal.derive handles reactivity
  return yield* Resource.match(state, {
    Pending: () => <Spinner />,
    Success: (user, stale) => (
      <div style={{ opacity: stale ? 0.5 : 1 }}>
        <h1>{user.name}</h1>
        <button onClick={() => Resource.invalidate(userResource)}>
          Refresh
        </button>
      </div>
    ),
    Failure: (error, staleValue) => 
      Option.match(staleValue, {
        onNone: () => <ErrorMessage error={error} />,
        onSome: (user) => (
          <>
            <ErrorBanner error={error} />
            <StaleUserCard user={user} />
          </>
        )
      })
  })
})
```

**State Transitions:**
```
Initial fetch:
  (no entry) → Pending → Success | Failure(staleValue: None)

invalidate (stale-while-revalidate):
  Success(value) → Success(value, stale=true) → Success(newValue) | Failure(staleValue: Some(value))

refresh (hard reload):
  Success | Failure → Pending → Success | Failure(staleValue: None)

Concurrent fetch (dedupe):
  fetch() while in-flight → awaits existing Deferred, returns same Signal

Concurrent invalidate (dedupe):
  invalidate() while in-flight → no-op (already fetching fresh data)

Concurrent refresh (dedupe):
  refresh() while in-flight → awaits existing Deferred
```

**Cache Key Strategy:**
- User provides explicit string key in `Resource.make`
- Keys should be unique across the app (e.g., `"user:123"`, `"posts:page:2"`)
- No automatic key derivation (explicit is better)

**Lifecycle Rules:**
- `ResourceRegistry` default layer lives at app root (created by `render`)
- Entries persist for app lifetime (no automatic eviction)
- Future: optional TTL config in `Resource.make`
- Cleanup: `ResourceRegistry` can be scoped for tests

#### Implementation Plan
1. [ ] Create `src/Resource.ts` with `ResourceState` tagged enum and type-safe constructors
2. [ ] Add `Resource.make` descriptor factory
3. [ ] Add `ResourceRegistry` service with in-memory Map implementation
4. [ ] Implement `Resource.fetch` with dedupe via Deferred
5. [ ] Implement `Resource.match` using `Signal.derive` for fine-grained rendering
6. [ ] Implement `Resource.invalidate` (stale-while-revalidate, with dedupe)
7. [ ] Implement `Resource.refresh` (hard reload, with dedupe)
8. [ ] Export from `src/index.ts`
9. [ ] Add default `ResourceRegistry` layer to `render`
10. [ ] Docs: add Resource section in `docs/design.md`
11. [ ] Tests (see below)

#### Tests

**Happy Path:**
| Case | Setup | Action | Expected |
|------|-------|--------|----------|
| Initial fetch | Empty registry | `Resource.fetch(userResource)` | Signal starts as Pending, transitions to Success |
| Cache hit | Registry has Success for key | `Resource.fetch(userResource)` | Returns existing Signal immediately, no fetch |
| Dedupe concurrent fetch | Two parallel `Resource.fetch` calls | Both resolve | Single fetch executed, both get same Signal |
| Match renders | Signal in Success state | `Resource.match(state, handlers)` | Calls Success handler with value |
| Match updates | Signal transitions Pending→Success | `Resource.match(state, handlers)` | Element updates via Signal.derive |

**Error Cases:**
| Case | Setup | Action | Expected |
|------|-------|--------|----------|
| Fetch fails (no cache) | Empty registry, fetch fails | `Resource.fetch(...)` | Signal: Failure(error, staleValue: None) |
| Fetch fails (has cache) | Success state, invalidate, refetch fails | `Resource.invalidate(...)` | Signal: Failure(error, staleValue: Some(oldValue)) |
| Match failure | Signal in Failure state | `Resource.match(state, handlers)` | Calls Failure handler with error + staleValue |

**Edge Cases:**
| Case | Setup | Action | Expected |
|------|-------|--------|----------|
| Invalidate while pending | Fetch in progress | `Resource.invalidate(...)` | No-op (dedupe) |
| Invalidate success | Success state | `Resource.invalidate(...)` | State: Success(stale=true), refetch starts |
| Refresh while pending | Fetch in progress | `Resource.refresh(...)` | Awaits current fetch (dedupe) |
| Refresh success | Success state | `Resource.refresh(...)` | State: Pending, refetch starts |
| Empty key | `key: ""` | `Resource.make(...)` | Works (user's responsibility) |
| Concurrent invalidate | Two parallel invalidate calls | Both complete | Single refetch (dedupe) |

#### Verification
- [ ] Multiple components mounting with same key share one Signal (no duplicate fetches)
- [ ] `Resource.match` uses Signal.derive - component renders once, updates fine-grained
- [ ] Failure state includes staleValue when previous Success existed
- [ ] `invalidate` shows stale UI immediately, updates on refetch complete
- [ ] `refresh` shows pending UI, then success/failure
- [ ] Concurrent fetch/invalidate/refresh operations are properly deduped

---

## Expected End-User UX

This section shows the complete developer experience after FUT-001 and FUT-002 are implemented. A full-stack example: API route + data fetching + UI.

### Project Structure

Uses fixed `app/` directory like Next.js - zero config needed:

```
my-app/
  app/
    api/
      users/
        group.ts          # GET /api/users, POST /api/users
        [id]/
          route.ts        # GET /api/users/:id
    users/
      page.tsx            # /users (user list)
      [id]/
        page.tsx          # /users/:id (user detail)
    page.tsx              # / (home)
    layout.tsx            # Root layout (optional)
    services.ts           # Service layer for API handlers
  lib/
    schemas/
      User.ts             # Shared schemas
  vite.config.ts
```

### Step 1: Define Schemas (shared between server & client)

```typescript
// lib/schemas/User.ts
import { Schema } from "effect"

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const User = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
  createdAt: Schema.DateFromString
})
export type User = typeof User.Type

export const CreateUser = Schema.Struct({
  name: Schema.String,
  email: Schema.String
})
export type CreateUser = typeof CreateUser.Type

export const UserNotFound = Schema.TaggedStruct("UserNotFound", {
  userId: UserId
})
export type UserNotFound = typeof UserNotFound.Type
```

### Step 2: Define API Routes

```typescript
// app/api/users/group.ts
import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Schema } from "effect"
import type { Api } from "effect-ui"
import { User, CreateUser } from "@/lib/schemas/User.js"

const list = HttpApiEndpoint.get("listUsers", "/api/users")
  .addSuccess(Schema.Array(User))

const create = HttpApiEndpoint.post("createUser", "/api/users")
  .setPayload(CreateUser)
  .addSuccess(User)

export const group = HttpApiGroup.make("users")
  .add(list)
  .add(create)

export const handlers: Api.GroupHandlers<typeof group> = {
  listUsers: () => UserRepository.findAll(),
  createUser: ({ payload }) => UserRepository.create(payload)
}
```

```typescript
// app/api/users/[id]/route.ts
import { HttpApiEndpoint } from "@effect/platform"
import { Schema } from "effect"
import type { Api } from "effect-ui"
import { User, UserId, UserNotFound } from "@/lib/schemas/User.js"

export const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id")
  .setPath(Schema.Struct({ id: UserId }))
  .addSuccess(User)
  .addError(UserNotFound)

export const handler: Api.Handler<typeof endpoint> = ({ path }) =>
  UserRepository.findById(path.id)
```

### Step 3: Configuration

Zero config needed - effect-ui uses `app/` directory by default (like Next.js):

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import effectUI from "effect-ui/vite-plugin"

export default defineConfig({
  plugins: [effectUI()]  // That's it!
})
```

```typescript
// app/services.ts - provide your service implementations
import { Layer } from "effect"
import { UserRepositoryLive } from "@/lib/services/UserRepository.js"

// effect-ui automatically provides this layer to API handlers
export const services = Layer.mergeAll(
  UserRepositoryLive,
  // ... other services
)
```

**How it works internally:**
- `app/` directory is the convention (like Next.js)
- `app/api/**` → API routes
- `app/**/page.tsx` → page routes
- `app/services.ts` → service layer for handlers
- `bun run dev` starts Vite dev server with API routes
- `bun run build` generates server bundle alongside client
- `bun run start` runs production server (Node/Bun auto-detected)

### Step 4: Client-Side Data Fetching

```typescript
// lib/resources/users.ts
import { Effect } from "effect"
import { HttpApiClient } from "@effect/platform"
import { Resource } from "effect-ui"
import { api } from "virtual:effect-ui-api"
import type { UserId } from "@/lib/schemas/User.js"

// Create typed API client - types flow from api definition
// client.users.listUsers() returns Effect<Array<User>>
// client.usersById.getUser({ path: { id } }) returns Effect<User, UserNotFound>
const client = HttpApiClient.make(api, { baseUrl: "" })

// Resource for user list
// Return type inferred as Resource<Array<User>, HttpClientError>
export const usersResource = Resource.make({
  key: "users:list",
  fetch: Effect.flatMap(client, (c) => c.users.listUsers())
})

// Resource factory for individual user
// Return type inferred as Resource<User, UserNotFound | HttpClientError>
export const userResource = (id: UserId) => Resource.make({
  key: `user:${id}`,
  fetch: Effect.flatMap(client, (c) => c.usersById.getUser({ path: { id } }))
})
```

**Type safety flow:**
```
src/api/users/[id]/route.ts
  └─ endpoint: HttpApiEndpoint<"getUser", User, UserNotFound, { id: UserId }>
       │
       ▼
virtual:effect-ui-api
  └─ api: HttpApi (contains all endpoint types)
       │
       ▼
HttpApiClient.make(api)
  └─ client.usersById.getUser: (req: { path: { id: UserId } }) => Effect<User, UserNotFound>
       │
       ▼
Resource.make({ fetch: ... })
  └─ Resource<User, UserNotFound | HttpClientError>
       │
       ▼
Resource.match(state, { Success: (user) => ... })
  └─ user: User (fully typed!)
```

### Step 5: UI Components

```tsx
// app/users/page.tsx
import { Effect, Option } from "effect"
import { Resource, Signal } from "effect-ui"
import { Link } from "effect-ui/router"
import { usersResource } from "@/lib/resources/users.js"

const UserList = Effect.gen(function* () {
  const state = yield* Resource.fetch(usersResource)
  
  return yield* Resource.match(state, {
    Pending: () => (
      <div class="loading">
        <Spinner />
        <p>Loading users...</p>
      </div>
    ),
    
    Success: (users, stale) => (
      <div class="user-list" style={{ opacity: stale ? 0.7 : 1 }}>
        <header>
          <h1>Users ({users.length})</h1>
          <button 
            onClick={() => Resource.invalidate(usersResource)}
            disabled={stale}
          >
            {stale ? "Refreshing..." : "Refresh"}
          </button>
        </header>
        
        <ul>
          {Signal.each(
            Signal.unsafeMake(users),
            (user) => Effect.succeed(
              <li>
                <Link to="/users/:id" params={{ id: user.id }}>{user.name}</Link>
                <span class="email">{user.email}</span>
              </li>
            ),
            { key: (user) => user.id }
          )}
        </ul>
      </div>
    ),
    
    Failure: (error, staleUsers) => (
      <div class="error-state">
        <ErrorBanner message="Failed to load users" error={error} />
        
        {Option.match(staleUsers, {
          onNone: () => (
            <button onClick={() => Resource.refresh(usersResource)}>
              Try Again
            </button>
          ),
          onSome: (users) => (
            <>
              <p class="stale-notice">Showing cached data</p>
              <ul class="stale">
                {Signal.each(
                  Signal.unsafeMake(users),
                  (user) => Effect.succeed(<li>{user.name}</li>),
                  { key: (user) => user.id }
                )}
              </ul>
            </>
          )
        })}
      </div>
    )
  })
})

export default UserList
```

```tsx
// app/users/[id]/page.tsx
import { Effect, Option } from "effect"
import { Resource } from "effect-ui"
import { Link, params } from "effect-ui/router"
import { userResource } from "@/lib/resources/users.js"

const UserDetail = Effect.gen(function* () {
  // Get route params - path pattern for type inference
  const { id } = yield* params("/users/:id")
  
  // Fetch user data
  const state = yield* Resource.fetch(userResource(id))
  
  return yield* Resource.match(state, {
    Pending: () => <UserSkeleton />,
    
    Success: (user, stale) => (
      <article class="user-detail">
        <h1>{user.name}</h1>
        <dl>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Member since</dt>
          <dd>{user.createdAt.toLocaleDateString()}</dd>
        </dl>
        
        <nav>
          <Link to="/users">Back to list</Link>
          <button onClick={() => Resource.invalidate(userResource(id))}>
            Refresh
          </button>
        </nav>
        
        {stale && <StaleIndicator />}
      </article>
    ),
    
    Failure: (error, staleUser) => 
      error._tag === "UserNotFound" 
        ? <NotFound message={`User ${error.userId} not found`} />
        : (
          <ErrorPage 
            error={error} 
            staleContent={Option.map(staleUser, (u) => <UserCard user={u} />)}
          />
        )
  })
})

export default UserDetail
```

### Step 6: App Entry

```tsx
// app/layout.tsx (root layout - optional)
import { Effect } from "effect"
import { Link, Outlet } from "effect-ui/router"

export default Effect.gen(function* () {
  return (
    <div class="app">
      <nav>
        <Link to="/">Home</Link>
        <Link to="/users">Users</Link>
      </nav>
      
      <main>
        <Outlet />
      </main>
    </div>
  )
})
```

```tsx
// app/page.tsx (home page)
import { Effect } from "effect"

export default Effect.gen(function* () {
  return <h1>Welcome to effect-ui</h1>
})
```

### What the Developer Gets

| Feature | Benefit |
|---------|---------|
| **Zero server code** | Define routes in `app/api/`, framework handles serving |
| **Type-safe API** | Endpoint schemas flow to client - `client.users.getUser()` is fully typed |
| **Build-time validation** | Path mismatches, missing handlers caught before runtime |
| **Automatic caching** | Same `userResource("123")` in multiple components = one fetch |
| **Deduplicated requests** | Concurrent mounts don't trigger duplicate API calls |
| **Stale-while-revalidate** | UI stays responsive during background refreshes |
| **Error resilience** | Stale data preserved on refetch failure |
| **Fine-grained updates** | `Resource.match` + `Signal.derive` = no full re-renders |
| **Explicit control** | `invalidate()` vs `refresh()` for different UX patterns |

### Development Commands

```bash
# Start dev server (client + API routes with HMR)
bun run dev

# Build for production
bun run build

# Start production server
bun run start
```

### Network Timeline Example

```
User navigates to /users:
  t=0ms    Resource.fetch("users:list") → Pending
  t=0ms    UI shows <Spinner />
  t=150ms  GET /api/users → 200 OK
  t=150ms  State → Success(users, stale=false)
  t=150ms  UI shows user list (fine-grained update, no re-render)

User clicks Refresh:
  t=0ms    Resource.invalidate("users:list")
  t=0ms    State → Success(users, stale=true)
  t=0ms    UI dims (opacity: 0.7), button shows "Refreshing..."
  t=200ms  GET /api/users → 200 OK
  t=200ms  State → Success(newUsers, stale=false)
  t=200ms  UI updates with new data

Another component mounts while refreshing:
  t=100ms  Resource.fetch("users:list") → deduped
  t=100ms  Returns same Signal (no new request)
  t=200ms  Both components see Success(newUsers)
```

---

## Session Log
### 2026-01-20 - Revision Session (Round 3)
- FUT-001: Adopted `app/` directory convention (like Next.js)
  - Zero config: `effectUI()` with no options needed
  - `app/api/**` for API routes
  - `app/**/page.tsx` for page routes  
  - `app/services.ts` for service layer
  - Internal server handling (no user server code)
- UX section: Updated all paths to use `app/` convention
- Updated imports to use `@/` alias pattern

### 2026-01-20 - Revision Session (Round 2)
- FUT-001: Refined to Effect-idiomatic API using standard HttpApiEndpoint/HttpApiGroup
  - Type utilities: `Api.Handler<E>`, `Api.GroupHandlers<G>` for compile-time validation
  - File convention: `route.ts` (single endpoint) vs `group.ts` (multiple endpoints)
  - Build-time validation: export type checking, path matching, scope validation, conflict detection
  - Generated virtual module uses explicit handler chain (Option A) for full type safety
- FUT-002: Refined implementation details
  - Type-safe constructors for ResourceState
  - Resource.match uses Signal.derive for fine-grained rendering
  - Failure state includes `staleValue: Option<A>` for stale-while-revalidate on error
  - Dedupe for both fetch and invalidate operations
  - Clear Deferred lifecycle with proper cleanup

### 2026-01-20 - Revision Session
- Revised FUT-001: Use Effect HttpApi (not custom), added TL;DR/effort/risk, concrete types, test table
- Revised FUT-002: Renamed to Resource (avoid effect/Data conflict), added TL;DR/effort/risk, full API signatures, state transitions, test table
- Both solutions now ✅ Ready for implementation

### 2026-01-19 - Solution Session
- Processed findings: FUT-001, FUT-002
- Decisions finalized: FUT-001 (public ApiClient.make + internal virtual manifest, module evaluation for validation), FUT-002 (invalidate -> stale + background fetch)
- Solutions proposed: FUT-001, FUT-002
- Next: implement when ready
