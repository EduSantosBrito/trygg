# Effect UI Router

Declarative routing with Schema-validated params, middleware composition, and Layer-based rendering strategies.

## Core Principles

1. **Explicit route definitions** - All routes in `app/routes.ts`
2. **Schema-validated params** - Params decoded at match time using Effect Schema
3. **Middleware composition** - Chained execution with error propagation
4. **Layer-based rendering** - Lazy/eager rendering via `RenderStrategy` Layer
5. **Type-safe navigation** - `RouteMap` augmented by vite plugin
6. **Trie-based matching** - Priority: static > param > wildcard

---

## Route Builder

### Basic Route

```tsx
import { Route, Routes, RenderStrategy } from "trygg/router"
import { Schema } from "effect"

Route.make("/users/:id")
  .params(Schema.Struct({ id: Schema.NumberFromString }))
  .component(UserProfile)
  .middleware(requireAuth)
  .loading(UserSkeleton)
  .error(UserError)
  .pipe(Route.provide(RenderStrategy.Lazy))
```

### Builder Methods

| Method | Description |
|--------|-------------|
| `Route.make(path)` | Create route with path pattern (`:param`, `:param*`, `:param+`) |
| `Route.index(Component)` | Create index route (matches parent path exactly) |
| `.params(schema)` | Schema for path params - keys must match path params |
| `.query(schema)` | Schema for query params |
| `.component(Component)` | Component to render |
| `.middleware(effect)` | Add middleware (chained, left-to-right) |
| `.prefetch(fn)` | Prefetch Resource on navigation (parallel execution) |
| `.loading(Component)` | Loading fallback while route loads |
| `.error(Component)` | Error boundary (nearest wins) |
| `.notFound(Component)` | 404 fallback for unmatched children |
| `.forbidden(Component)` | 403 fallback for unauthorized access |
| `.layout(Component)` | Layout wrapper (renders `<Router.Outlet />` for children) |
| `.children(...)` | Nested routes with relative paths |
| `.pipe(Route.provide(...))` | Apply Layers (render strategy, scroll strategy) |

### Constraints

- `.component()` and `.children()` are mutually exclusive
- `.params()` only available when path has param segments
- Schema keys must exactly match path params (type-enforced)
- `.component()` only accepts `Component.gen` components (not plain `Effect.gen` or functions)

---

## Routes Collection

```tsx
export const routes = Routes.make()
  .add(HomeRoute)
  .add(UsersRoute)
  .add(SettingsRoutes)
  .notFound(NotFoundComponent)
  .forbidden(ForbiddenComponent)
```

`.add()` enforces `R = never` at the type level - all service requirements must be satisfied via `Route.provide` before adding.

---

## Path Params

### Schema Validation

```tsx
// Schema keys must match path params exactly
Route.make("/users/:id")
  .params(Schema.Struct({ id: Schema.NumberFromString }))

// Multiple params
Route.make("/blog/:year/:slug")
  .params(Schema.Struct({
    year: Schema.NumberFromString,
    slug: Schema.String
  }))

// Catch-all (zero or more segments)
Route.make("/docs/:path*")
  .params(Schema.Struct({ path: Schema.String }))
// /docs -> path = "", /docs/api/users -> path = "api/users"

// Required catch-all (one or more segments)
Route.make("/files/:filepath+")
  .params(Schema.Struct({ filepath: Schema.String }))
// /files/a/b -> filepath = "a/b", /files -> 404
```

### Usage in Components

```tsx
const UserProfile = Component.gen(function* () {
  const { id } = yield* Router.params("/users/:id")
  // id: number (decoded via Schema.NumberFromString)
  return <div>User {id}</div>
})
```

---

## Query Params

```tsx
Route.make("/search")
  .query(Schema.Struct({
    q: Schema.String,
    page: Schema.optional(Schema.NumberFromString),
  }))
  .component(SearchPage)

// In component:
const { q, page } = yield* Router.query("/search")
// q: string, page: number | undefined
```

---

## Middleware

Middleware runs before component rendering. Left-to-right ordering.

### Definition

```tsx
const requireAuth = Effect.gen(function* () {
  const session = yield* FiberRef.get(CurrentSession)
  if (Option.isNone(session)) {
    return yield* Route.redirect("/login")
  }
})

const requireAdmin = Effect.gen(function* () {
  const user = yield* FiberRef.get(CurrentUser)
  if (!user.isAdmin) {
    return yield* Route.forbidden()
  }
})
```

### Results

| Effect Result | Behavior |
|---------------|----------|
| Succeeds with `void` | Continue to next middleware or component |
| Fails with `RouterRedirectError` | Redirect to another route |
| Fails with `RouterForbiddenError` | Render nearest `.forbidden()` component |
| Fails with other error | Render nearest `.error()` component |

### With Service Requirements

```tsx
Route.make("/admin")
  .middleware(requireAuth)      // R = AuthService
  .component(AdminDashboard)
  .pipe(Route.provide(AuthLive))  // R = never
```

---

## Boundary Components

All boundaries use **nearest-wins** resolution (walks up from route to ancestors).

### Error Boundary

```tsx
Route.make("/dashboard")
  .middleware(requireAuth)
  .component(Dashboard)
  .error(DashboardError)

// Error component:
const DashboardError = Component.gen(function* () {
  const { cause, path, reset } = yield* Router.currentError
  return (
    <div>
      <h1>Error on {path}</h1>
      <pre>{String(Cause.squash(cause))}</pre>
      <button onClick={reset}>Try Again</button>
    </div>
  )
})
```

### Not Found

```tsx
Route.make("/admin")
  .layout(AdminLayout)
  .notFound(AdminNotFound)  // Handles /admin/unknown
  .children(
    Route.make("/users").component(AdminUsers),
  )
```

### Forbidden

```tsx
Route.make("/admin")
  .middleware(requireAdmin)
  .forbidden(AdminForbidden)
  .children(...)
```

---

## Render Strategy

Controls how route components are loaded. Applied as a Layer via `Route.provide`.

```tsx
// Lazy (default) - dynamic import at render time
Route.make("/users").component(UsersList)

// Eager - component bundled in same chunk, renders immediately
Route.make("/").component(HomePage).pipe(Route.provide(RenderStrategy.Eager))
```

The vite plugin transforms `.component(X)` to `.component(() => import("./X"))` for Lazy routes. Eager routes keep direct references.

### RenderStrategy Service

```typescript
interface RenderStrategyService {
  readonly _tag: "RenderStrategy"
  readonly isEager: boolean
  readonly load: <A>(loader: () => Promise<{ default: A }>) => Effect<A, RenderLoadError>
}
```

---

## Scroll Strategy

Controls scroll position management on navigation.

```tsx
// Auto (default) - scroll to top on new nav, restore on back/forward
Route.make("/users").component(UsersList)

// None - don't touch scroll (tabs, modals)
Route.make("/settings")
  .layout(SettingsLayout)
  .children(...)
  .pipe(Route.provide(ScrollStrategy.None))
```

Storage uses `sessionStorage` keyed by `history.state.key`. Survives page refresh.

---

## Layouts

```tsx
Route.make("/settings")
  .layout(SettingsLayout)
  .children(
    Route.index(SettingsIndex),
    Route.make("/profile").component(SettingsProfile),
  )

// Layout component:
const SettingsLayout = Component.gen(function* () {
  return (
    <div>
      <nav>...</nav>
      <Router.Outlet />  {/* Child routes render here */}
    </div>
  )
})
```

Layouts stack from root to leaf. Parent layouts persist during child navigation.

---

## Children Routes

Children use relative paths resolved against the parent:

```tsx
Route.make("/settings")           // /settings
  .children(
    Route.index(SettingsIndex),                        // /settings (exact)
    Route.make("/profile").component(Profile),         // /settings/profile
    Route.make("/billing")                             // /settings/billing
      .children(
        Route.index(BillingIndex),                     // /settings/billing
        Route.make("/invoices").component(Invoices),   // /settings/billing/invoices
      )
  )
```

All paths must start with `/`. Use `Route.index(Component)` for index routes.

---

## Navigation

### Router.Link

```tsx
<Router.Link to="/users">Users</Router.Link>
<Router.Link to="/users/:id" params={{ id: 123 }}>View User</Router.Link>
<Router.Link to="/search" query={{ q: "effect" }}>Search</Router.Link>
<Router.Link to="/login" replace>Login</Router.Link>
```

Type-safe: if `RouteMap[path]` has params, the `params` prop is required.

### Programmatic

```tsx
const router = yield* Router.get
yield* router.navigate("/users")
yield* router.navigate("/users/:id", { params: { id: 123 } })
yield* router.navigate("/search", { query: { q: "effect" } })
yield* router.navigate("/login", { replace: true })
yield* router.back()
yield* router.forward()
```

### Active Link Detection

```tsx
const isActive = yield* Router.isActive("/users")
// true if current path starts with "/users"

const isExact = yield* Router.isActive("/settings", { exact: true })
// true only if current path is exactly "/settings"
```

---

## Link Prefetching

```tsx
// "intent" (default) - hover (50ms debounce) or focus
<Router.Link to="/users" prefetch="intent">Users</Router.Link>

// "viewport" - IntersectionObserver (10% visible + idle callback)
<Router.Link to="/dashboard" prefetch="viewport">Dashboard</Router.Link>

// "render" - immediately on mount
<Router.Link to="/critical" prefetch="render">Critical</Router.Link>

// Disable
<Router.Link to="/admin" prefetch={false}>Admin</Router.Link>
```

Modules are cached for 30 seconds. Navigation to prefetched routes skips loading state.

### Programmatic Prefetch

```tsx
yield* Router.prefetch("/users/123")
```

---

## Data Prefetching

Prefetch Resources when navigating to a route:

```tsx
Route.make("/users/:id")
  .params(Schema.Struct({ id: Schema.NumberFromString }))
  .prefetch(({ params }) => Effect.succeed(userResource({ id: params.id })))
  .prefetch(({ params }) => Effect.succeed(postsResource({ userId: params.id })))
  .component(UserProfile)
```

Multiple `.prefetch()` calls run in parallel. Errors are logged but don't block navigation.

---

## Outlet Component

The `Outlet` renders the matched route:

```tsx
// With explicit manifest
<Router.Outlet routes={routes.manifest} />

// Implicit (reads from CurrentRoutesManifest FiberRef)
<Router.Outlet />
```

Outlet behavior:
1. Matches current path via trie matcher
2. Runs middleware chain
3. Decodes params/query via Schema
4. Runs prefetch effects
5. Resolves component (handles lazy loading)
6. Stacks layouts (root-to-leaf)
7. Wraps with error boundary
8. Shows loading state during async loads
9. Updates via `SignalElement` (no parent re-render)

---

## Route Matching

Trie-based matching with priority ordering:

1. **Static segments** score 3 (highest priority)
2. **Param segments** (`:id`) score 2
3. **Required catch-all** (`:path+`) score 1.5
4. **Optional catch-all** (`:path*`) score 1

Longer paths win ties. Multiple matches at same specificity: highest total score wins.

---

## Head Element Hoisting

Route components can render head elements directly:

```tsx
const BlogPost = Component.gen(function* () {
  const { slug } = yield* Router.params("/blog/:slug")
  return <>
    <title>My Blog Post</title>
    <meta property="og:title" content="My Blog Post" />
    <article>...</article>
  </>
})
```

On route navigation, old route's head elements are removed and new route's elements are added. Layout head elements persist.

---

## Type Generation

The vite plugin generates `.trygg/routes.d.ts`:

```typescript
declare module "trygg/router" {
  interface RouteMap {
    "/": {}
    "/users": {}
    "/users/:id": { readonly id: number }
    "/settings": {}
    "/settings/profile": {}
  }
}
```

This provides autocomplete for `Router.Link`, `Router.params`, `Router.navigate`, etc.

---

## Testing

```tsx
import { Router } from "trygg/router"

// testLayer provides in-memory router (no DOM)
const layer = Router.testLayer("/initial/path")

it.scoped("navigates", () =>
  Effect.gen(function* () {
    const router = yield* Router.get
    yield* router.navigate("/users")
    const route = yield* Router.currentRoute
    expect(route.path).toBe("/users")
  }).pipe(Effect.provide(layer))
)
```

---

## Full Example

```tsx
// app/routes.ts
import { Route, Routes, RenderStrategy, ScrollStrategy } from "trygg/router"
import { Schema } from "effect"

export const routes = Routes.make()
  .add(
    Route.make("/")
      .component(HomePage)
      .pipe(Route.provide(RenderStrategy.Eager))
  )
  .add(
    Route.make("/users/:id")
      .params(Schema.Struct({ id: Schema.String }))
      .component(UserProfile)
      .loading(UserSkeleton)
      .error(ErrorBoundary)
  )
  .add(
    Route.make("/settings")
      .layout(SettingsLayout)
      .middleware(requireAuth)
      .forbidden(SettingsForbidden)
      .children(
        Route.index(SettingsIndex),
        Route.make("/profile").component(SettingsProfile),
        Route.make("/security")
          .middleware(requireSecurityAccess)
          .component(SettingsSecurity),
      )
      .pipe(Route.provide(AuthLive, ScrollStrategy.None))
  )
  .notFound(NotFound)
  .forbidden(Forbidden)
```

---

## File Structure

```
src/router/
  index.ts             # Exports + Route/Routes namespace objects
  route.ts             # Route builder, middleware helpers, param decode
  routes.ts            # Routes collection, RoutesManifest
  matching.ts          # Trie-based matcher, boundary resolution
  outlet.ts            # Outlet component
  outlet-services.ts   # OutletRenderer, BoundaryResolver, AsyncLoader
  router-service.ts    # Router tag, browserLayer, testLayer
  link.ts              # Link component with prefetch
  render-strategy.ts   # RenderStrategy (Lazy, Eager)
  scroll-strategy.ts   # ScrollStrategy (Auto, None)
  prefetch.ts          # Prefetch runner
  types.ts             # Core types, RouteMap, TypeSafeLinkProps
  utils.ts             # parsePath, buildPath
```
