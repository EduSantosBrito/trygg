# Effect UI Router - Design Document

## Overview

Client-side SPA router for effect-ui with file-based routing, designed to work seamlessly with @effect/rpc for full-stack type-safe applications.

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
  const { id } = yield* Router.params<{ id: string }>()
  
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

## Vite Plugin

The vite plugin scans the routes directory and generates a route manifest:

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

### Generated Manifest

The plugin generates a virtual module `virtual:effect-ui-routes`:

```ts
// Generated at build time
export const routes = {
  "/": () => import("./routes/index.tsx"),
  "/about": () => import("./routes/about.tsx"),
  "/users": () => import("./routes/users/index.tsx"),
  "/users/:id": () => import("./routes/users/[id].tsx"),
  "/settings": {
    layout: () => import("./routes/settings/_layout.tsx"),
    children: {
      "/": () => import("./routes/settings/index.tsx"),
      "/profile": () => import("./routes/settings/profile.tsx"),
      "/security": () => import("./routes/settings/security.tsx"),
    }
  }
}
```

## API Design

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
// Type-safe params from route pattern
const UserProfile = Effect.gen(function* () {
  // For route /users/:id
  const { id } = yield* Router.params<{ id: string }>()
  
  return <div>User: {id}</div>
})

// Multiple params - /posts/:postId/comments/:commentId
const Comment = Effect.gen(function* () {
  const { postId, commentId } = yield* Router.params<{ 
    postId: string
    commentId: string 
  }>()
  
  return <div>Post {postId}, Comment {commentId}</div>
})

// Catch-all params - /files/[...path]
const FileExplorer = Effect.gen(function* () {
  const { path } = yield* Router.params<{ path: string }>()
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

// Update query params
yield* Router.setQuery({ q: "new search", page: "2" })
yield* Router.updateQuery(current => ({ 
  ...Object.fromEntries(current), 
  page: "3" 
}))
```

### Current Route Signal

```tsx
const Breadcrumb = Effect.gen(function* () {
  const route = yield* Router.current  // Signal<Route>
  const { path, params } = yield* Signal.get(route)
  
  return (
    <nav className="breadcrumb">
      <span>Path: {path}</span>
      <span>Params: {JSON.stringify(params)}</span>
    </nav>
  )
})
```

### Active Link Styling

```tsx
// Router.Link adds data-active="true" when route matches
<Router.Link to="/users" className="nav-link">
  Users
</Router.Link>

// CSS
.nav-link[data-active="true"] {
  font-weight: bold;
  color: var(--primary);
}

// Or check programmatically
const NavLink = Effect.gen(function* () {
  const isActive = yield* Router.isActive("/users")
  return (
    <Router.Link to="/users" className={isActive ? "active" : ""}>
      Users
    </Router.Link>
  )
})
```

## Route Guards

Guards are Effects that run before a route renders. Export `guard` from route file:

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

## Integration with @effect/rpc

### Shared Types

```tsx
// shared/api.ts
import { Rpc, RpcGroup } from "@effect/rpc"
import { Schema } from "effect"

// Define RPC procedures
export class GetUser extends Rpc.make("GetUser")
  .setPayload(Schema.Struct({ id: Schema.String }))
  .setSuccess(Schema.Struct({ 
    id: Schema.String,
    name: Schema.String, 
    email: Schema.String 
  }))
  .setError(Schema.Struct({ 
    _tag: Schema.Literal("NotFound"),
    message: Schema.String 
  })) {}

export class ListUsers extends Rpc.make("ListUsers")
  .setSuccess(Schema.Array(Schema.Struct({
    id: Schema.String,
    name: Schema.String
  }))) {}

export const UserApi = RpcGroup.make("User")
  .add(GetUser)
  .add(ListUsers)
```

### Server Implementation

```tsx
// server/main.ts
import { RpcServer } from "@effect/rpc"
import { BunHttpServer } from "@effect/platform-bun"
import { UserApi, GetUser, ListUsers } from "../shared/api"
import { Effect, Layer } from "effect"

// Implement handlers
const handlers = RpcServer.router(UserApi, {
  GetUser: ({ id }) => Effect.gen(function* () {
    const repo = yield* UserRepository
    const user = yield* repo.findById(id)
    return user
  }),
  
  ListUsers: () => Effect.gen(function* () {
    const repo = yield* UserRepository
    return yield* repo.findAll()
  })
})

// Start server
const server = BunHttpServer.serve(handlers, { port: 3000 })

Effect.runFork(
  server.pipe(
    Effect.provide(UserRepositoryLive),
    Effect.provide(DatabaseLive)
  )
)
```

### Client Usage in Routes

```tsx
// routes/users/index.tsx
import { Effect } from "effect"
import { RpcClient } from "@effect/rpc"
import { Signal } from "effect-ui"
import { ListUsers } from "../../shared/api"

export default Effect.gen(function* () {
  const client = yield* RpcClient.Tag
  const users = yield* client(new ListUsers())
  
  return (
    <div>
      <h1>Users</h1>
      <ul>
        {users.map(user => (
          <li key={user.id}>
            <Router.Link to={`/users/${user.id}`}>{user.name}</Router.Link>
          </li>
        ))}
      </ul>
    </div>
  )
})
```

```tsx
// routes/users/[id].tsx
import { Effect } from "effect"
import { Router } from "effect-ui"
import { RpcClient } from "@effect/rpc"
import { GetUser } from "../../shared/api"

export default Effect.gen(function* () {
  const { id } = yield* Router.params<{ id: string }>()
  const client = yield* RpcClient.Tag
  const user = yield* client(new GetUser({ id }))
  
  return (
    <div>
      <h1>{user.name}</h1>
      <p>Email: {user.email}</p>
    </div>
  )
})
```

### RPC Layer Setup

```tsx
// main.tsx
import { Effect, Layer } from "effect"
import { mount, Router } from "effect-ui"
import { RpcClient } from "@effect/rpc"
import { FetchHttpClient } from "@effect/platform"
import { routes } from "virtual:effect-ui-routes"
import { UserApi } from "./shared/api"

// Create RPC client layer
const rpcLayer = Layer.mergeAll(
  RpcClient.layerProtobuf(UserApi, {
    url: "http://localhost:3000/rpc"
  }),
  FetchHttpClient.layer
)

const App = Effect.gen(function* () {
  return <Router.Outlet routes={routes} />
})

// Provide RPC layer to entire app
mount(
  document.getElementById("root")!,
  App.pipe(Effect.provide(rpcLayer))
)
```

## Implementation Status

### Phase 1: Core Router - COMPLETE

- [x] **RouterService** - Context.Tag service with navigation methods
- [x] **Route matching** - Parse paths, extract params (static, dynamic `:id`, wildcard `*`)
- [x] **Router.Outlet** - Renders matched route component
- [x] **Router.Link** - Navigation links with type-safe params
- [x] **Browser integration** - history.pushState, popstate

### Phase 2: File-Based Routing - COMPLETE

- [x] **Vite plugin** - Scan routes directory, generate manifest
- [x] **Virtual module** - `virtual:effect-ui-routes`
- [x] **Dynamic imports** - Automatic code splitting
- [x] **Hot reload** - Route changes in dev mode
- [x] **Type generation** - Auto-generate `routes.d.ts` with RouteMap types

### Phase 3: Type-Safe Routing - COMPLETE (January 2026)

- [x] **ExtractRouteParams<Path>** - Template literal type extracts params from paths
- [x] **TypeSafeLinkProps<Path>** - Requires params prop when path has `:param` segments
- [x] **buildPathWithParams()** - Substitutes params into path patterns
- [x] **Generated RouteMap** - Vite plugin generates typed route map

### Phase 4: Advanced Features - PARTIALLY COMPLETE (January 2026)

- [x] **Layouts** - `_layout.tsx` support for shared navigation/sidebars
- [x] **Nested outlets** - Child outlets inside layouts render matched content
- [x] **NavLink exact** - Support for exact path matching with `exact` prop
- [ ] **Guards** - Route-level and layout-level auth checks
- [ ] **Loading states** - `_loading.tsx` support
- [ ] **Error boundaries** - `_error.tsx` support

### Phase 5: Testing & Observability - PARTIALLY COMPLETE (January 2026)

- [x] **Unit tests** - Route matching, param extraction (22 tests)
- [ ] **Integration tests** - Guards, outlets, active links
- [ ] **Observability events** - router.navigate, router.match, router.guard.*

### Phase 6: RPC Integration - FUTURE

- [ ] **Documentation** - How to use with @effect/rpc
- [ ] **Full-stack example** - Complete app with client + server
- [ ] **Type sharing** - Patterns for shared types

## Current File Structure

```
src/
├── router/
│   ├── index.ts           # Main exports
│   ├── RouterService.ts   # Service + browserLayer
│   ├── Outlet.ts          # Outlet component
│   ├── Link.ts            # Link + NavLink components
│   ├── matching.ts        # Path matching logic
│   ├── types.ts           # Route types + type-safe utilities
│   └── utils.ts           # cx() utility for class names
├── vite-plugin.ts         # Route scanning + type generation
└── virtual-routes.d.ts    # Type declarations for virtual module
```

## Remaining Tasks

### 1. Route Guards (High Priority)

Guards are Effects that run before a route renders:

```tsx
// routes/admin/index.tsx
export const guard = Effect.gen(function* () {
  const auth = yield* AuthService
  const user = yield* auth.getCurrentUser
  if (Option.isNone(user) || !user.value.isAdmin) {
    return yield* Router.redirect("/unauthorized")
  }
})
```

**Implementation needed:**
- Export `guard` effect from route files
- Run guards before component in `loadAndRender()`
- Handle redirect results from guards
- Support layout-level guards (apply to all children)

### 2. Router Observability Events

Per OBSERVABILITY.md, add these events:

| Event | Description | Fields |
|-------|-------------|--------|
| `router.navigate` | Navigation triggered | `from`, `to`, `trigger` |
| `router.match` | Route matched | `path`, `pattern`, `params` |
| `router.guard.start` | Guard started | `guard_name` |
| `router.guard.allow` | Guard allowed | `guard_name`, `duration_ms` |
| `router.guard.block` | Guard blocked | `guard_name`, `reason` |
| `router.transition.complete` | Transition done | `from`, `to`, `duration_ms` |

### 3. Loading/Error States (Future)

- `_loading.tsx` - Suspense fallback during route loading
- `_error.tsx` - Error boundary for route errors

## Completed Tasks (January 2026)

### Layout Support (`_layout.tsx`) - DONE

Layouts wrap sibling and child routes. When a `_layout.tsx` file exists:

```tsx
// routes/settings/_layout.tsx
export default Effect.gen(function* () {
  return (
    <div className="settings-layout">
      <SettingsSidebar />
      <main>
        <Router.Outlet />  {/* Child route renders here */}
      </main>
    </div>
  )
})
```

**How it works:**
1. Vite plugin detects `_layout.tsx` files and adds `layout` property to route definitions
2. `Outlet` checks if matched route has a layout
3. If so, it renders the layout with child content passed via `CurrentOutletChild` FiberRef
4. The layout's nested `<Router.Outlet />` reads from FiberRef and renders the child

### Router Tests - DONE

22 tests covering:
- `parsePath` - Path/query parsing
- `buildPath` - Path/query building
- `createMatcher` - Static, dynamic, wildcard, catch-all matching
- `buildPathWithParams` - Type-safe path building
- `ExtractRouteParams` - Type-level param extraction
