---
name: effect-ui-router
description: File-based routing for effect-ui with type-safe navigation, route guards, layouts, and error boundaries. Use when adding routes, navigation, params, query strings, or route protection.
license: MIT
metadata:
  author: effect-ui
  version: "1.0"
---

# effect-ui Router

File-based routing with type-safe navigation.

## File Structure

```
src/routes/
  index.tsx           -> /
  about.tsx           -> /about
  users/
    index.tsx         -> /users
    [id].tsx          -> /users/:id
  settings/
    _layout.tsx       -> Layout for /settings/*
    _error.tsx        -> Error boundary for /settings/*
    _loading.tsx      -> Loading for /settings/*
    index.tsx         -> /settings
    profile.tsx       -> /settings/profile
```

## Conventions

| Pattern | Meaning |
|---------|---------|
| `index.tsx` | Index route for directory |
| `[param].tsx` | Dynamic parameter segment |
| `[...rest].tsx` | Catch-all/wildcard segment |
| `_layout.tsx` | Layout wrapper for siblings |
| `_error.tsx` | Error boundary for siblings |
| `_loading.tsx` | Loading fallback for siblings |
| `_404.tsx` | Not found fallback |

## Route File Format

```tsx
// routes/users/[id].tsx
import { Effect } from "effect"
import * as Router from "effect-ui/router"

// Default export = route component
export default Effect.gen(function* () {
  const { id } = yield* Router.params("/users/:id")
  return <div>User: {id}</div>
})

// Optional: guard (runs before component)
export const guard = Effect.gen(function* () {
  const auth = yield* AuthService
  const user = yield* auth.getCurrentUser
  if (Option.isNone(user)) {
    return yield* Router.redirect("/login")
  }
})
```

## Layout Files

```tsx
// routes/settings/_layout.tsx
export default Effect.gen(function* () {
  return (
    <div className="settings-layout">
      <nav>
        <Router.Link to="/settings">Overview</Router.Link>
        <Router.Link to="/settings/profile">Profile</Router.Link>
      </nav>
      <main>
        <Router.Outlet />  {/* Child route renders here */}
      </main>
    </div>
  )
})
```

## Error Boundary (_error.tsx)

```tsx
// routes/dashboard/_error.tsx
import { Cause, Effect } from "effect"

export default Effect.gen(function* () {
  const { cause, path, reset } = yield* Router.currentError
  
  return (
    <div className="error">
      <h1>Error on {path}</h1>
      <pre>{String(Cause.squash(cause))}</pre>
      <button onClick={reset}>Retry</button>
    </div>
  )
})
```

## App Setup

```tsx
// main.tsx
import { Effect } from "effect"
import { mount } from "effect-ui"
import * as Router from "effect-ui/router"
import { routes } from "virtual:effect-ui-routes"

const App = Effect.gen(function* () {
  return (
    <div>
      <nav>
        <Router.Link to="/">Home</Router.Link>
        <Router.Link to="/users">Users</Router.Link>
      </nav>
      <Router.Outlet routes={routes} />
    </div>
  )
})

mount(document.getElementById("root")!, App)
```

## Navigation

### Declarative (Link)

```tsx
<Router.Link to="/users/123">View User</Router.Link>
<Router.Link to="/users" replace>Replace History</Router.Link>
<Router.Link to="/search" query={{ q: "effect" }}>Search</Router.Link>
```

### Programmatic

```tsx
yield* Router.navigate("/users/123")
yield* Router.navigate("/users", { replace: true })
yield* Router.navigate("/search", { query: { q: "effect" } })
yield* Router.back()
yield* Router.forward()
```

## Route Parameters

```tsx
// Params are type-safe based on the path pattern
const { id } = yield* Router.params("/users/:id")

// Multiple params
const { postId, commentId } = yield* Router.params("/posts/:postId/comments/:commentId")

// Catch-all: /files/[...path] becomes /files/*
const { path } = yield* Router.params("/files/*")
```

## Query Parameters

```tsx
const SearchPage = Effect.gen(function* () {
  const query = yield* Router.query  // Signal<URLSearchParams>
  const params = yield* Signal.get(query)
  
  const searchTerm = params.get("q") ?? ""
  return <div>Searching: {searchTerm}</div>
})

// Update query via navigate
yield* Router.navigate("/search", { query: { q: "new search" } })
```

## Active Link Styling

```tsx
const NavItem = Effect.gen(function* () {
  const isActive = yield* Router.isActive("/users")
  
  return (
    <Router.Link
      to="/users"
      className={isActive ? "nav-link active" : "nav-link"}
      aria-current={isActive ? "page" : undefined}
    >
      Users
    </Router.Link>
  )
})

// Exact matching
const isActive = yield* Router.isActive("/settings", true)  // exact=true
```

## Route Guards

```tsx
// routes/dashboard/index.tsx
export const guard = Effect.gen(function* () {
  const auth = yield* AuthService
  const user = yield* auth.getCurrentUser
  
  if (Option.isNone(user)) {
    const current = yield* Router.current
    const route = yield* Signal.get(current)
    return yield* Router.redirect("/login", {
      query: { returnTo: route.path }
    })
  }
})
```

## Stacking Rules

- **Layouts**: Stack root to leaf (outermost wraps innermost)
- **Errors**: Nearest `_error.tsx` wins, walks up to parent if none
- **Params**: All merged across matched routes

## Vite Config

```ts
// vite.config.ts
import { defineConfig } from "vite"
import effectUI from "effect-ui/vite-plugin"

export default defineConfig({
  plugins: [
    effectUI({
      routes: "./src/routes"
    })
  ]
})
```
