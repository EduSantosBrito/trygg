# Effect UI Router

Client-side SPA router with file-based routing, designed for @effect/rpc integration.

## Core Principles

1. **File-based routes** - Routes defined by file structure, automatic code splitting
2. **Signal-based** - Current route is a Signal for reactive updates
3. **Effect-native** - Navigation returns Effects, guards are Effects
4. **Type-safe** - Route params extracted at type level
5. **Composable** - Routes can be nested with layouts

## File-Based Routing

### Directory Structure

```
src/
├── routes/
│   ├── index.tsx           → /
│   ├── about.tsx           → /about
│   ├── users/
│   │   ├── index.tsx       → /users
│   │   └── [id].tsx        → /users/:id
│   ├── posts/
│   │   ├── index.tsx       → /posts
│   │   └── [postId]/
│   │       ├── index.tsx   → /posts/:postId
│   │       └── comments/
│   │           └── [commentId].tsx  → /posts/:postId/comments/:commentId
│   └── settings/
│       ├── _layout.tsx     → Layout wrapper for /settings/*
│       ├── index.tsx       → /settings
│       ├── profile.tsx     → /settings/profile
│       └── security.tsx    → /settings/security
├── main.tsx
└── vite.config.ts
```

### Conventions

| Pattern | Meaning |
|---------|---------|
| `index.tsx` | Index route for directory |
| `[param].tsx` | Dynamic parameter segment |
| `[...rest].tsx` | Catch-all/wildcard segment |
| `_layout.tsx` | Layout wrapper for sibling routes |
| `_error.tsx` | Error boundary for sibling routes |
| `_loading.tsx` | Loading fallback for sibling routes |
| `_404.tsx` | Not found fallback |

### Route File Format

```tsx
// routes/users/[id].tsx
import { Effect } from "effect"
import { Router } from "effect-ui"

// Route component - default export
export default Effect.gen(function* () {
  // Path-based type safety: params are inferred from the path pattern
  const { id } = yield* Router.params("/users/:id")
  
  return (
    <div>
      <h1>User Profile</h1>
      <p>User ID: {id}</p>
    </div>
  )
})

// Optional: Route guard
export const guard = Effect.gen(function* () {
  const auth = yield* AuthService
  const user = yield* auth.getCurrentUser
  if (Option.isNone(user)) {
    return yield* Router.redirect("/login")
  }
})

// Optional: Loading component
export const loading = <div>Loading user...</div>

// Optional: Error component  
export const error = (err: unknown) => <div>Error: {String(err)}</div>
```

### Layout Files

```tsx
// routes/settings/_layout.tsx
import { Effect } from "effect"
import { Router } from "effect-ui"

export default Effect.gen(function* () {
  return (
    <div className="settings-layout">
      <aside>
        <nav>
          <Router.Link to="/settings">Overview</Router.Link>
          <Router.Link to="/settings/profile">Profile</Router.Link>
          <Router.Link to="/settings/security">Security</Router.Link>
        </nav>
      </aside>
      <main>
        <Router.Outlet />  {/* Child route renders here */}
      </main>
    </div>
  )
})
```

### Nested Route Stacking Rules

When routes are nested (via `children` property or directory structure), the following rules apply:

#### Layout Stacking Order

Layouts stack from **root to leaf**. The root layout wraps outer, and child layouts nest inside:

```
/admin/_layout.tsx         → Outermost wrapper
  /admin/users/_layout.tsx   → Wraps inside admin layout
    /admin/users/[id].tsx      → Leaf component, innermost
```

For path `/admin/users/123`:
```tsx
<AdminLayout>           {/* /admin/_layout.tsx */}
  <UsersLayout>         {/* /admin/users/_layout.tsx */}
    <UserProfile />     {/* /admin/users/[id].tsx */}
  </UsersLayout>
</AdminLayout>
```

#### Error Boundary Resolution (Nearest Wins)

When a route component throws or fails, the **nearest** `_error.tsx` catches it:

1. If the leaf route has `_error.tsx`, it handles the error
2. Otherwise, walk up to parent routes until one has `_error.tsx`
3. If no `_error.tsx` found, error propagates to app-level boundary

```
/dashboard/_error.tsx        → Catches errors from dashboard/* if child has none
  /dashboard/reports/_error.tsx  → Catches errors from reports/*
    /dashboard/reports/[id].tsx    → If this throws, reports/_error.tsx catches
```

**Error Handling Features:**
- Both typed failures (`Effect.fail`) and defects (thrown exceptions) are caught
- Error info is available via `Router.currentError` in the error component
- Error is automatically scoped to the error component's render (no stale errors)
- If the error component itself throws, the error propagates to the parent boundary

#### Error Component Example

```tsx
// routes/dashboard/_error.tsx
import { Cause, Effect } from "effect"
import * as Router from "effect-ui/router"

export default Effect.gen(function* () {
  // Access error info - only available inside _error.tsx components
  const { cause, path, reset } = yield* Router.currentError
  
  return (
    <div className="error-boundary">
      <h1>Something went wrong</h1>
      <p>Error on route: {path}</p>
      <pre>{String(Cause.squash(cause))}</pre>
      <button onClick={reset}>Try Again</button>
    </div>
  )
})
```

**RouteErrorInfo properties:**
- `cause` - The `Cause<unknown>` of the error. Use `Cause.squash(cause)` for display, `Cause.match` for pattern matching
- `path` - The route path where the error occurred
- `reset` - An Effect that triggers a re-render to retry the failed route

#### Pattern Matching on Cause

For more sophisticated error handling, use `Cause.match` to handle different error types:

```tsx
// routes/api/_error.tsx
import { Cause, Effect, Option } from "effect"
import * as Router from "effect-ui/router"

// Custom error types
class NotFoundError {
  readonly _tag = "NotFoundError"
  constructor(readonly resource: string) {}
}

class UnauthorizedError {
  readonly _tag = "UnauthorizedError"
}

export default Effect.gen(function* () {
  const { cause, path, reset } = yield* Router.currentError
  
  // Extract typed failure if present
  const failure = Cause.failureOption(cause)
  
  if (Option.isSome(failure)) {
    const error = failure.value
    
    // Pattern match on error type
    if (error instanceof NotFoundError) {
      return (
        <div className="not-found">
          <h1>Not Found</h1>
          <p>{error.resource} could not be found</p>
          <Router.Link to="/">Go Home</Router.Link>
        </div>
      )
    }
    
    if (error instanceof UnauthorizedError) {
      return (
        <div className="unauthorized">
          <h1>Unauthorized</h1>
          <p>Please log in to access this page</p>
          <Router.Link to="/login">Log In</Router.Link>
        </div>
      )
    }
  }
  
  // Check for defects (thrown exceptions)
  const defect = Cause.dieOption(cause)
  if (Option.isSome(defect)) {
    return (
      <div className="crash">
        <h1>Unexpected Error</h1>
        <pre>{String(defect.value)}</pre>
        <button onClick={reset}>Reload</button>
      </div>
    )
  }
  
  // Fallback for other causes
  return (
    <div className="error">
      <h1>Error on {path}</h1>
      <pre>{String(Cause.squash(cause))}</pre>
      <button onClick={reset}>Try Again</button>
    </div>
  )
})
```

#### Loading Component Resolution (Nearest Wins)

Same as error boundaries - the nearest `_loading.tsx` displays while the route loads:

```
/shop/_loading.tsx           → Shows while any /shop/* route loads (if child has none)
  /shop/products/_loading.tsx  → Shows while /shop/products/* routes load
```

#### Parameter Propagation

Route params are merged across all matched routes. Child params override parent params if they have the same name:

```tsx
// For path: /orgs/acme/projects/123/tasks/456
// With routes: /orgs/:orgId/projects/:projectId/tasks/:taskId

// In any layout or component:
const { orgId, projectId, taskId } = yield* Router.params("/orgs/:orgId/projects/:projectId/tasks/:taskId")
// orgId = "acme", projectId = "123", taskId = "456"
```

All params are available at every level of the route tree.

## Vite Plugin

```ts
// vite.config.ts
import { defineConfig } from "vite"
import effectUI from "effect-ui/vite-plugin"

export default defineConfig({
  plugins: [
    effectUI({
      routes: "./src/routes"  // Enable file-based routing
    })
  ]
})
```

## API

### App Entry Point

```tsx
// main.tsx
import { Effect } from "effect"
import { mount, Router } from "effect-ui"
import { routes } from "virtual:effect-ui-routes"

const App = Effect.gen(function* () {
  return (
    <div>
      <header>
        <nav>
          <Router.Link to="/">Home</Router.Link>
          <Router.Link to="/users">Users</Router.Link>
          <Router.Link to="/settings">Settings</Router.Link>
        </nav>
      </header>
      <main>
        <Router.Outlet routes={routes} />
      </main>
    </div>
  )
})

mount(document.getElementById("root")!, App)
```

### Navigation

```tsx
// Declarative - Link component
<Router.Link to="/users/123">View User</Router.Link>
<Router.Link to="/users/123" replace>Replace History</Router.Link>

// With query params
<Router.Link to="/search" query={{ q: "effect", page: "1" }}>Search</Router.Link>

// Prefetch control
<Router.Link to="/users" prefetch="intent">Users</Router.Link>  // Default: hover/focus prefetch
<Router.Link to="/users" prefetch="render">Users</Router.Link>  // Prefetch immediately on render
<Router.Link to="/users" prefetch={false}>Users</Router.Link>   // No prefetch

// Programmatic - in Effects
yield* Router.navigate("/users/123")
yield* Router.navigate("/users/123", { replace: true })
yield* Router.back()
yield* Router.forward()

// With query params
yield* Router.navigate("/search", { query: { q: "effect" } })
```

### Route Parameters

```tsx
// Type-safe params from path pattern
const UserProfile = Effect.gen(function* () {
  const { id } = yield* Router.params("/users/:id")
  
  return <div>User: {id}</div>
})

// Multiple params
const Comment = Effect.gen(function* () {
  const { postId, commentId } = yield* Router.params("/posts/:postId/comments/:commentId")
  
  return <div>Post {postId}, Comment {commentId}</div>
})

// Catch-all params - /files/[...path] becomes /files/*
const FileExplorer = Effect.gen(function* () {
  const { path } = yield* Router.params("/files/*")
  // path = "docs/api/router" for /files/docs/api/router
  
  return <div>File: {path}</div>
})
```

### Query Parameters

```tsx
const SearchResults = Effect.gen(function* () {
  // Get query signal
  const query = yield* Router.query  // Signal<URLSearchParams>
  const params = yield* Signal.get(query)
  
  const searchTerm = params.get("q") ?? ""
  const page = parseInt(params.get("page") ?? "1")
  
  return <div>Searching for: {searchTerm}, Page: {page}</div>
})

// Update query params (effect-first) by navigating
yield* Router.navigate("/search", { query: { q: "new search", page: "2" } })

// Update query for the current path
const current = yield* Router.current
const route = yield* Signal.get(current)
yield* Router.navigate(route.path, {
  query: { ...Object.fromEntries(route.query), page: "3" }
})
```

> **Note:** Query updates use `Router.navigate` exclusively. This keeps all navigation effect-first and composable—no separate `setQuery`/`updateQuery` helpers exist.

### Active Link Styling

Use `Router.isActive()` to compute active state and set attributes:

```tsx
// Recommended: Link + Router.isActive
const NavItem = Effect.gen(function* () {
  const isActive = yield* Router.isActive("/users")
  return (
    <Router.Link 
      to="/users" 
      className={isActive ? "nav-link active" : "nav-link"}
      aria-current={isActive ? "page" : undefined}
      data-active={isActive ? "true" : undefined}
    >
      Users
    </Router.Link>
  )
})

// CSS - target both class and data attribute
.nav-link.active,
.nav-link[data-active="true"] {
  font-weight: bold;
  color: var(--primary);
}

// For exact matching (only /settings, not /settings/profile)
const SettingsLink = Effect.gen(function* () {
  const isActive = yield* Router.isActive("/settings", true) // exact=true
  return (
    <Router.Link 
      to="/settings"
      className={isActive ? "nav-link active" : "nav-link"}
      aria-current={isActive ? "page" : undefined}
    >
      Settings
    </Router.Link>
  )
})

// Using the cx utility for cleaner class composition
import { cx } from "effect-ui/router"

const NavItem = Effect.gen(function* () {
  const isActive = yield* Router.isActive("/users")
  const className = yield* cx("nav-link", isActive && "active")
  return (
    <Router.Link to="/users" className={className} aria-current={isActive ? "page" : undefined}>
      Users
    </Router.Link>
  )
})
```

**Accessibility Note:** Use `aria-current="page"` for screen readers when the link points to the current page.

**Security Note:** `Link` and anchor `href` values are validated at render time. Dangerous schemes like `javascript:` are blocked. See [design.md Section 12](design.md#12-security) for details on URL validation and adding custom schemes.

### Link Prefetching

Links can prefetch route modules before navigation to make transitions instant:

```tsx
// "intent" (default) - prefetch on hover (50ms debounce) or focus
<Router.Link to="/users">Users</Router.Link>
<Router.Link to="/users" prefetch="intent">Users</Router.Link>

// "render" - prefetch immediately when Link mounts
<Router.Link to="/dashboard" prefetch="render">Dashboard</Router.Link>

// false - disable prefetch (for rarely-visited links)
<Router.Link to="/admin" prefetch={false}>Admin</Router.Link>
```

| Strategy | When Prefetch Triggers | Use Case |
|----------|----------------------|----------|
| `"intent"` (default) | Hover (50ms delay) or focus | Most links - balances performance and bandwidth |
| `"render"` | Immediately on mount | Critical paths, likely destinations |
| `false` | Never | Rarely-visited links, bandwidth-sensitive |

**How it works:**
- Prefetch loads route modules (component, layouts) into cache
- Modules are cached for 30 seconds
- Navigation to prefetched routes is instant (no loading state)
- Prefetch failures are silently ignored (best-effort)

### Programmatic Prefetch

```tsx
// Prefetch a route programmatically
yield* Router.prefetch("/users/123")

// Useful for prefetching based on predictions
const SearchResults = Effect.gen(function* () {
  const results = yield* fetchResults(query)
  
  // Prefetch the first result's detail page
  if (results.length > 0) {
    yield* Router.prefetch(`/items/${results[0].id}`)
  }
  
  return <ResultsList results={results} />
})

## Route Guards

Guards are Effects that run before a route renders:

```tsx
// routes/dashboard/index.tsx
import { Effect, Option } from "effect"
import { Router } from "effect-ui"

// Guard runs before component
export const guard = Effect.gen(function* () {
  const auth = yield* AuthService
  const user = yield* auth.getCurrentUser
  
  if (Option.isNone(user)) {
    // Redirect to login, preserving intended destination
    const current = yield* Router.current
    const returnTo = yield* Signal.get(current)
    return yield* Router.redirect("/login", { 
      query: { returnTo: returnTo.path } 
    })
  }
  
  // Guard passes - continue to render component
})

// Component only renders if guard passes
export default Effect.gen(function* () {
  return <div>Dashboard (protected)</div>
})
```

### Layout-Level Guards

Guards in `_layout.tsx` apply to all child routes:

```tsx
// routes/admin/_layout.tsx
export const guard = Effect.gen(function* () {
  const auth = yield* AuthService
  const user = yield* auth.getCurrentUser
  
  if (Option.isNone(user) || !user.value.isAdmin) {
    return yield* Router.redirect("/unauthorized")
  }
})

export default Effect.gen(function* () {
  return (
    <div className="admin-layout">
      <AdminSidebar />
      <Router.Outlet />
    </div>
  )
})
```

## File Structure

```
src/router/
├── index.ts           # Main exports
├── RouterService.ts   # Service + browserLayer + prefetch
├── Outlet.ts          # Outlet component with parallel loading
├── Link.ts            # Link component with prefetch prop
├── moduleLoader.ts    # Memoized module loader with timeout/retry
├── matching.ts        # Path matching logic
├── types.ts           # Route types + type-safe utilities
└── utils.ts           # cx() utility for class names
```
