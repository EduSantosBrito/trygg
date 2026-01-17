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
├── RouterService.ts   # Service + browserLayer
├── Outlet.ts          # Outlet component
├── Link.ts            # Link + NavLink components
├── matching.ts        # Path matching logic
├── types.ts           # Route types + type-safe utilities
└── utils.ts           # cx() utility for class names
```
