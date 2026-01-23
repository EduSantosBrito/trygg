# Path to v1: Production Readiness

## Overview

effect-ui is a full-stack Effect-native UI framework. Production readiness means:
1. A project built with effect-ui can be deployed to any hosting provider
2. The framework handles the build pipeline end-to-end (client + server)
3. The CLI scaffolds production-ready projects with zero configuration
4. The package is publishable to npm

---

## 1. Production Build System

### Problem

The current Vite plugin builds a client-side SPA only. The API middleware (`src/api/middleware.ts`) runs exclusively inside Vite's dev server. After `vite build`, there is no server to handle `/api/*` requests. The build output is static files with no way to serve them alongside API routes.

### Solution: `output` option

```ts
effectUI({
  output: "server",  // "server" | "static"
  platform: "bun",   // "bun" | "node"
})
```

#### `output: "server"` (default)

Produces a self-contained production server that:
- Serves the built static client files
- Handles all API routes via the user's `ApiLive` layer
- Includes SPA fallback (returns `index.html` for non-file, non-API GET requests)
- Responds to `GET /healthz` with 200
- Gracefully shuts down on SIGTERM/SIGINT

Build output:
```
dist/
├── client/           → static assets
│   ├── index.html
│   └── assets/
│       ├── index-[hash].js
│       └── index-[hash].css
└── server.js         → complete production server
```

Deploy: `bun dist/server.js` (or `node dist/server.js`)

#### `output: "static"`

Produces a purely static client build. No server code is generated.

Build output:
```
dist/
├── index.html
└── assets/
    ├── index-[hash].js
    └── index-[hash].css
```

Deploy: Upload `dist/` to any static host (Vercel, Netlify, S3, Cloudflare Pages).

If `app/api.ts` exists when `output: "static"`, the build emits a warning:
```
⚠ API routes in app/api.ts will not be included in static build.
  Deploy your API separately or use output: "server".
```

This follows Next.js's `output: "export"` behavior — static export and API routes are mutually exclusive. The framework errors/warns rather than silently ignoring code.

### Rationale

- **Why not separate the concern?** We considered `effect-ui/server` as a public export with composable layers (StaticFiles, SpaFallback, HealthCheck, etc.). Rejected because it contradicts the framework's goal — the user shouldn't have to wire up server infrastructure. The Vite plugin knows everything it needs to generate a complete server.
- **Why not always build a server?** Some deployments are purely static (marketing sites, docs, apps with external APIs). Forcing a server build adds unnecessary complexity and deploy overhead.
- **Why "server" and "static"?** These names describe the primary deployment artifact. "Server" = you run a process. "Static" = you upload files to a CDN. Both are well-understood terms in the deployment world.

---

## 2. Platform Option

```ts
effectUI({
  platform: "bun",  // "bun" | "node"
})
```

Determines which `@effect/platform-*` runtime is used for the production server.

| Platform | Runtime import | Server command |
|----------|---------------|----------------|
| `"bun"` | `@effect/platform-bun` | `bun dist/server.js` |
| `"node"` | `@effect/platform-node` | `node dist/server.js` |

### Rationale

- The user chooses their deployment runtime once, and the framework handles the rest.
- The build output is runtime-specific (different platform layers, different APIs).
- Default is `"node"` for maximum compatibility, but Bun is recommended for new projects.

---

## 3. Routes Convention (No Configuration)

### Change

Remove the `routes?: string` option from `EffectUIOptions`. The plugin always looks for `app/routes.ts`.

Before:
```ts
effectUI({ routes: "./app/routes.ts" })
```

After:
```ts
effectUI() // routes discovered automatically
```

### Behavior

- Plugin checks for `app/routes.ts` in `configResolved`
- If it exists: enable route type generation, code splitting transforms, Router integration
- If it doesn't exist: no router features (simpler SPA mode)

### Rationale

- Convention over configuration. Every effect-ui project uses the same structure.
- No decision fatigue — there's one right place for routes.
- Matches the `app/` directory convention already established (`app/layout.tsx`, `app/api.ts`).
- The option added no value — no one has a reason to put routes elsewhere.

---

## 4. Revised `EffectUIOptions`

```ts
export interface EffectUIOptions {
  readonly platform?: "node" | "bun"     // default: "node"
  readonly output?: "server" | "static"  // default: "server"
}
```

Two options. That's it. The plugin discovers everything else from the `app/` directory convention.

---

## 5. Server Build Implementation

### Architecture

The server code lives in `packages/core/src/server/` as **internal modules** (not exported in package.json). These are bundled into the generated server entry at build time.

Internal modules:
```
packages/core/src/server/
├── static-files.ts    → Serves files from a directory with MIME types, cache headers
├── spa-fallback.ts    → Returns index.html for non-file, non-API GET requests
├── health.ts          → GET /healthz → 200
└── shutdown.ts        → SIGTERM/SIGINT handling, connection draining
```

### Build Phase

The Vite plugin's `closeBundle` hook (runs after client build):

1. **Generate `.effect-ui/server-entry.ts`** — imports `ApiLive` from `app/api.ts` (if it exists), composes all server layers, launches with the chosen platform runtime.

2. **Run Vite SSR build** targeting the generated entry:
   ```ts
   await build({
     configFile: false,
     build: {
       ssr: ".effect-ui/server-entry.ts",
       outDir: "dist",
       rollupOptions: {
         output: { entryFileNames: "server.js" },
         external: ["effect", /^@effect\//,  /^node:/, /^bun:/]
       }
     }
   })
   ```

3. **Output** → `dist/server.js` — a single runnable file.

### Generated Server Entry (pseudocode)

```ts
import { ApiLive } from "../app/api"
import { HttpApiBuilder, HttpMiddleware, HttpServer } from "@effect/platform"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Layer, Effect } from "effect"

const PORT = Number(process.env.PORT ?? 3000)

// Static files from ./client/
const StaticLayer = ...

// SPA fallback
const SpaLayer = ...

// Health check
const HealthLayer = ...

// Compose
const ServerLive = HttpApiBuilder.serve().pipe(
  Layer.provide(ApiLive),
  Layer.provide(StaticLayer),
  Layer.provide(SpaLayer),
  Layer.provide(HealthLayer),
  Layer.provide(BunHttpServer.layer({ port: PORT })),
)

BunRuntime.runMain(Layer.launch(ServerLive))
```

### Rationale

- **Why Vite SSR build?** Reuses the same config, aliases, and plugins as the client build. This is what Remix, SvelteKit, and other Vite-based frameworks do.
- **Why externalize deps?** For Docker/VPS deployments, `node_modules` is available. Smaller output, faster builds, no duplicate bundling of Effect internals.
- **Why not a public `effect-ui/server` export?** The user should never write server code. The framework is opinionated: `vite build` produces a deployable artifact. Zero server configuration.
- **Why generate the entry instead of shipping a static one?** The entry depends on user choices: whether `app/api.ts` exists, which platform runtime to use, which port to bind. Generation handles all combinations.

---

## 6. Port and Environment

The production server reads from environment variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | HTTP listen port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |

This is the universal convention (Next.js, Remix, SvelteKit adapter-node, Astro, Fly.io, Railway, Heroku all use `PORT`). No framework-specific config needed.

---

## 7. No Compression

The production server does **not** include response compression (gzip/brotli).

### Rationale

- Production deployments sit behind a reverse proxy (Cloudflare, nginx, AWS ALB, Fly.io proxy) that handles compression.
- Adding app-level compression is redundant work, adds latency, and can cause double-compression bugs.
- Next.js includes it (with a disable option). Remix and Astro don't. We follow Remix's approach: keep the server lean, let infrastructure handle transport concerns.

---

## 8. CLI Redesign: `create-effect-ui`

### Current State

The current CLI is minimal: accepts a project name, copies a single static template. No prompts, no options, no feature selection.

### Design Principles

1. **`@effect/cli`** — command structure, args, flags, help, version
2. **`consola`** — interactive prompts (text, select, confirm, multiselect)
3. **Effect** — all logic (file system, validation, error handling)
4. **Composable templates** — base + feature overlays, not one template per combination
5. **Dynamic generation** — `package.json` and `vite.config.ts` are constructed from selections
6. **Bun-only runtime** — the CLI itself runs on Bun (matches the project's DNA)

### User Flow

```
$ bun create effect-ui

┌  create-effect-ui v0.2.0
│
◇  Project name: my-app
│
◇  Platform:
│  ● Bun (recommended)
│  ○ Node
│
◇  Output mode:
│  ● Server (full-stack, single deployment)
│  ○ Static (CDN deploy, no server build)
│
◇  Features:                              ← API excluded if output: "static"
│  ☑ Router (file-based routing)
│  ☑ API (Effect HttpApi endpoints)        ← only shown for output: "server"
│  ◻ Tailwind CSS v4
│
│  ℹ API routes are not available with static output.   ← hint if static
│
◇  Version control:
│  ● Git
│  ○ Jujutsu (jj)
│  ○ None
│
◇  Install dependencies? Yes
│
└  Done! Created my-app in ./my-app

  cd my-app
  bun run dev       → http://localhost:5173
  bun run build     → dist/
  bun run start     → http://localhost:3000
```

### CLI Flags (non-interactive)

| Flag | Type | Purpose |
|------|------|---------|
| `--platform` | `bun \| node` | Skip platform prompt |
| `--output` | `server \| static` | Skip output prompt |
| `--router` | boolean | Include router |
| `--api` | boolean | Include API routes |
| `--tailwind` | boolean | Include Tailwind CSS v4 |
| `--vcs` | `git \| jj \| none` | Version control system |
| `--install` / `--no-install` | boolean | Install dependencies |
| `--yes` / `-y` | boolean | Accept all defaults |

If `--api` is passed with `--output static`, emit a warning and ignore:
```
⚠ --api ignored: API routes are not available with static output.
```

### Defaults (for `--yes`)

| Option | Default |
|--------|---------|
| platform | bun |
| output | server |
| features | router + api |
| vcs | git |
| install | true |

---

## 9. CLI Package Structure

```
packages/cli/
├── package.json
├── index.ts                        ← Entry: @effect/cli commands + run
├── src/
│   ├── prompts.ts                  ← consola prompt definitions
│   ├── scaffold.ts                 ← Orchestrates file generation + copy
│   ├── generators/
│   │   ├── package-json.ts         ← Builds package.json from selections
│   │   ├── vite-config.ts          ← Builds vite.config.ts from selections
│   │   ├── tsconfig.ts             ← Builds tsconfig.json
│   │   └── gitignore.ts            ← Builds .gitignore
│   └── detect-pm.ts               ← Package manager detection (npm_config_user_agent)
├── templates/
│   ├── base/
│   │   └── app/
│   │       └── layout.tsx          ← Root layout component
│   ├── router/
│   │   └── app/
│   │       ├── routes.ts           ← Example route definitions
│   │       └── pages/
│   │           ├── home.tsx        ← Home page component
│   │           └── about.tsx       ← About page component
│   ├── api/
│   │   └── app/
│   │       └── api.ts             ← Example API (hello endpoint)
│   ├── tailwind/
│   │   └── app/
│   │       └── styles/
│   │           └── global.css     ← @import "tailwindcss"
│   └── static/
│       └── public/
│           └── favicon.svg        ← Simple SVG favicon
```

### Template Strategy

Templates are **composable overlays**, not monolithic copies:

1. **Base** is always copied (layout.tsx, public/)
2. **Feature overlays** are merged on top (router/, api/, tailwind/)
3. **Cross-cutting files** are generated dynamically (package.json, vite.config.ts, tsconfig.json, .gitignore)

This avoids the combinatorial explosion of maintaining separate templates for every feature combination (2^3 = 8 templates vs 3 overlays).

---

## 10. Generated Project Structure

The CLI produces this structure based on selections:

```
my-app/
├── app/
│   ├── layout.tsx              ← always (root layout, uses mountDocument)
│   ├── routes.ts               ← if router selected
│   ├── api.ts                  ← if api selected
│   ├── pages/                  ← if router selected
│   │   ├── home.tsx
│   │   └── about.tsx
│   └── styles/                 ← if tailwind selected
│       └── global.css
├── public/                     ← always
│   └── favicon.svg
├── vite.config.ts              ← generated dynamically
├── tsconfig.json               ← generated dynamically
├── package.json                ← generated dynamically
└── .gitignore                  ← generated dynamically
```

---

## 11. Generated File Contents

### `vite.config.ts` (generated)

Constructed from platform, output, and feature selections:

```ts
// Example: platform: "bun", output: "server", features: [router, api, tailwind]
import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import { effectUI } from "effect-ui/vite-plugin"

export default defineConfig({
  plugins: [
    tailwindcss(),
    effectUI({
      platform: "bun",
      output: "server",
    }),
  ],
})
```

Without tailwind, the `tailwindcss` import and plugin are omitted.
Without any options matching defaults, the `effectUI()` call can be bare.

### `package.json` (generated)

Constructed from all selections:

```json
{
  "name": "my-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "bun dist/server.js",
    "start": "bun dist/server.js"
  },
  "dependencies": {
    "effect": "^3.19.14",
    "@effect/platform": "^0.94.1",
    "@effect/platform-browser": "^0.74.0",
    "@effect/platform-bun": "^0.87.0",
    "effect-ui": "^0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0"
  }
}
```

Variations:
- `platform: "node"` → `@effect/platform-node` instead of `@effect/platform-bun`, commands use `node`
- `output: "static"` → no `start` script, `preview` uses `vite preview`
- No tailwind → no tailwind devDependencies

### Scripts per mode

| Script | `server` + `bun` | `server` + `node` | `static` |
|--------|------------------|--------------------|----------|
| dev | `vite` | `vite` | `vite` |
| build | `vite build` | `vite build` | `vite build` |
| preview | `bun dist/server.js` | `node dist/server.js` | `vite preview` |
| start | `bun dist/server.js` | `node dist/server.js` | *(omitted)* |

### `tsconfig.json` (generated)

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "effect-ui",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true
  },
  "include": ["app/**/*.ts", "app/**/*.tsx"]
}
```

### Template: `app/layout.tsx`

Follows the examples app convention — uses `mountDocument` with a full HTML structure:

```tsx
import { Component } from "effect-ui"
import * as Router from "effect-ui/router"

export default Component.gen(function* () {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>effect-ui</title>
      </head>
      <body>
        <Router.Outlet />
      </body>
    </html>
  )
})
```

### Template: `app/routes.ts`

```ts
import { Routes, Route, RenderStrategy } from "effect-ui/router"
import Home from "./pages/home"
import About from "./pages/about"

export const routes = Routes.make(
  Route.make("/")
    .component(Home)
    .strategy(RenderStrategy.Eager),
  Route.make("/about")
    .component(About),
)
```

### Template: `app/pages/home.tsx`

```tsx
import { Component, Signal } from "effect-ui"

export default Component.gen(function* () {
  const count = yield* Signal.make(0)
  const increment = () => Signal.update(count, (n) => n + 1)

  return (
    <main>
      <h1>effect-ui</h1>
      <p>Effect-native UI framework with fine-grained reactivity.</p>
      <button onClick={increment}>Count: {count}</button>
    </main>
  )
})
```

### Template: `app/pages/about.tsx`

```tsx
import { Component } from "effect-ui"
import * as Router from "effect-ui/router"

export default Component.gen(function* () {
  return (
    <main>
      <h1>About</h1>
      <p>Built with effect-ui.</p>
      <Router.Link to="/">← Home</Router.Link>
    </main>
  )
})
```

### Template: `app/api.ts`

```ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiBuilder } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"

const Hello = Schema.Struct({ message: Schema.String })

class HelloGroup extends HttpApiGroup.make("hello")
  .add(HttpApiEndpoint.get("greet", "/hello").addSuccess(Hello))
  .prefix("/api") {}

class Api extends HttpApi.make("app").add(HelloGroup) {}

const HelloLive = HttpApiBuilder.group(Api, "hello", (handlers) =>
  handlers.handle("greet", () =>
    Effect.succeed({ message: "Hello from effect-ui!" })
  )
)

export const ApiLive = HttpApiBuilder.api(Api).pipe(Layer.provide(HelloLive))
```

### Template: `app/styles/global.css`

```css
@import "tailwindcss";
```

---

## 12. Version Control Support

The CLI supports initializing with either Git or Jujutsu (jj):

| VCS | Command | Ignore file |
|-----|---------|-------------|
| `git` | `git init` | `.gitignore` |
| `jj` | `jj git init` | `.gitignore` (jj respects the same file) |
| `none` | *(skip)* | `.gitignore` still generated (useful if user inits later) |

### Rationale

- Git is the standard, but Jujutsu is gaining adoption in the Effect/TypeScript community.
- Both use `.gitignore` for ignore rules (jj is git-compatible).
- The `.gitignore` is always generated regardless of VCS choice — it's useful even if the user initializes VCS later.

---

## 13. Package Manager Detection

The CLI detects which package manager invoked it by reading `process.env.npm_config_user_agent`:

```ts
const agent = process.env.npm_config_user_agent ?? ""
if (agent.startsWith("bun")) return "bun"
if (agent.startsWith("pnpm")) return "pnpm"
if (agent.startsWith("yarn")) return "yarn"
return "npm"
```

Used for:
- Running the correct install command (`bun install`, `npm install`, etc.)
- Printing correct commands in the success message
- The CLI itself is Bun-only, but the *generated project* can use any PM

---

## 14. CLI Execution Flow

1. Parse args and flags via `@effect/cli`
2. If `--yes`: use all defaults, skip prompts
3. Otherwise: run `consola.prompt()` for each missing option
4. Validate: project name format, target directory doesn't exist, `--api` + `--output static` conflict
5. Create target directory
6. Copy base template files (`templates/base/`)
7. Copy feature overlays (`templates/router/`, `templates/api/`, `templates/tailwind/`)
8. Generate dynamic files (package.json, vite.config.ts, tsconfig.json, .gitignore)
9. Initialize VCS (git/jj) if selected
10. Install dependencies if selected
11. Print success message with next steps

---

## 15. Vite Plugin Implementation Changes

### Files Modified

| File | Change |
|------|--------|
| `src/vite/plugin.ts` | Remove `routes` option, add `platform` + `output`, add `closeBundle` server build, adjust client `outDir` |
| `src/server/static-files.ts` | **New** (internal) — static file serving |
| `src/server/spa-fallback.ts` | **New** (internal) — SPA fallback |
| `src/server/health.ts` | **New** (internal) — health check endpoint |
| `src/server/shutdown.ts` | **New** (internal) — graceful shutdown |
| `package.json` | Add `@effect/platform-bun` peer dep, update `peerDependenciesMeta` |
| `rolldown.config.ts` | Add server internals to bundle |

### Plugin Hook Changes

| Hook | Current | New |
|------|---------|-----|
| `config()` | Sets esbuild JSX, build input | + Adjusts `outDir` to `dist/client` when `output: "server"` |
| `configResolved()` | Resolves dirs, reads `routes` option | Auto-discovers `app/routes.ts` instead of option |
| `buildStart()` | Generates entry + index.html | Same, no change needed |
| `closeBundle()` | *(doesn't exist)* | **New**: generates server entry, runs Vite SSR build |
| `transform()` | Transforms routes for lazy loading | Uses discovered path instead of option |

### Route Discovery

```ts
// In configResolved:
const routesPath = nodePath.resolve(appDir, "routes.ts")
const hasRoutes = await fs.exists(routesPath)
// Use hasRoutes to conditionally enable route features
```

---

## 16. Package Publishing Checklist

Before v1.0.0 release:

| Item | Current | Required |
|------|---------|----------|
| `"private": true` | Yes | Remove |
| `sideEffects` | Missing | Add `"sideEffects": false` |
| `files` field | Missing | Add to control npm publish contents |
| `license` | Missing | Add MIT |
| `repository` | Missing | Add GitHub URL |
| Version strategy | Manual | Consider changesets |
| Peer dep ranges | Exact | Widen to semver ranges |

---

## 17. What's NOT in v1 Scope

These are explicitly deferred:

| Feature | Reason |
|---------|--------|
| SSR / Hydration | Requires server-side rendering of components — major architectural work |
| Static Site Generation | Pre-rendering pages at build time — needs SSR first |
| Edge Runtime adapters | Cloudflare Workers, Deno Deploy — different bundling strategy needed |
| Serverless adapters | AWS Lambda, Vercel Functions — single-file bundling |
| Image optimization | Build-time image processing — nice-to-have, not critical |
| Service Worker / PWA | Offline support — orthogonal to the framework |
| Response compression | Handled by reverse proxy in production |
| Bundle size tracking | CI integration for size regression — nice-to-have |

---

## 18. Implementation Order

1. **Remove `routes` option** — enforce `app/routes.ts` convention
2. **Add `platform` + `output` to EffectUIOptions** — with defaults
3. **Adjust client outDir** — `dist/client/` when `output: "server"`
4. **Create internal server modules** — static files, SPA fallback, health, shutdown
5. **Generate server entry** — in `buildStart` or `closeBundle`
6. **Add `closeBundle` hook** — runs Vite SSR build for server
7. **Static mode warning** — warn if api.ts exists with `output: "static"`
8. **Update package.json** — peer deps, exports
9. **Rebuild CLI** — new prompts, composable templates, generators
10. **Update examples app** — use new config format
11. **Package publishing prep** — remove private, add metadata
12. **Test end-to-end** — `bun create effect-ui test-app && cd test-app && bun run build && bun run start`
