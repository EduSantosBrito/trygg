# Deployment

Deploying a trygg app is two decisions and one build. You choose a runtime **platform** and an **output** mode in `trygg.config.ts`, run the build, and ship the artifacts. This page covers what each mode emits and how to run it.

## Configure platform and output

Both fields live in `trygg.config.ts` and are read by the Vite plugin and the build:

```ts
import { defineConfig } from "trygg/config";

export default defineConfig({
  platform: "bun",
  output: "server",
});
```

- `platform` (`"bun" | "node" | "cloudflare"`) selects the production runtime.
- `output` (`"server" | "static"`) selects the artifact shape. `"server"` emits a runnable server with API routing; `"static"` emits assets for a CDN or any static host.

The fields are orthogonal, but not every pair is supported — see the matrix at the end.

## Build

The build runs through Vite:

```bash
bun run build
```

What lands in `dist/` depends on the output mode.

## Server output (bun or node)

`output: "server"` on `platform: "bun"` or `platform: "node"` emits a runnable server plus the client bundle:

```
dist/
  server.js          # generated production server
  client/
    .trygg/
      index.html      # SPA shell
    assets/           # hashed JS and CSS
    favicon.svg
```

Run it with the matching runtime:

```bash
bun dist/server.js      # platform: "bun"
node dist/server.js     # platform: "node"
```

The server listens on `http://0.0.0.0:4173` by default; override with the `PORT` and `HOST` environment variables. Its middleware handles three cases in order: it serves static files from `dist/client/`, routes `/api/*` to your API handler, and falls back to the SPA shell for other GET requests so client-side navigation works on a hard refresh.

`app/api.ts` is optional. When it exists, the build wires its `HttpApi` into the server and reserves `/api/*` for it; when it does not, the server simply serves static files and the SPA shell. Reach for `output: "server"` whenever the app has server-owned behavior.

## Static output

`output: "static"` emits only client assets, written to `dist/` directly (no `server.js`):

```
dist/
  .trygg/
    index.html        # SPA shell
  assets/             # hashed JS and CSS
  favicon.svg
```

Serve `dist/` from any static host (a CDN, object storage, or a static file server). Because the app is a single-page application, the host must rewrite unknown navigation paths to the SPA shell — configure a fallback to `index.html` on your platform (for example, a Netlify `_redirects` rule or a Vercel rewrite).

If `app/api.ts` exists, a static build keeps building but warns that those API routes are not included. Deploy the API separately, or switch to `output: "server"`.

## Cloudflare (static only)

`platform: "cloudflare"` is supported with `output: "static"` only. It emits the client assets plus a Worker entry at `.trygg/worker-entry.js` that serves assets through the fixed `ASSETS` binding (the binding name is not configurable today) and falls back to `/index.html` for navigation requests.

Two combinations are rejected with a build error:

- `output: "server"` with `platform: "cloudflare"` — Cloudflare server output is not supported yet. Use `platform: "bun"` or `platform: "node"`.
- `app/api.ts` alongside `platform: "cloudflare"` + `output: "static"` — move API routes to a server-output build on bun or node.

## What to commit

The scaffold's `.gitignore` already excludes both build directories:

```
dist
.trygg
```

`dist/` is the build output and `.trygg/` is regenerated on every dev run and build (the SPA shell, the browser entry, and generated route and API type declarations). Neither belongs in version control.

## Support matrix

| platform       | output   | Emits                              | Run with              |
| -------------- | -------- | ---------------------------------- | --------------------- |
| `bun`          | `server` | `dist/server.js` + `dist/client/`  | `bun dist/server.js`  |
| `node`         | `server` | `dist/server.js` + `dist/client/`  | `node dist/server.js` |
| `bun` / `node` | `static` | `dist/` (assets only)              | any static host       |
| `cloudflare`   | `static` | `dist/` + `.trygg/worker-entry.js` | Cloudflare Workers    |
| `cloudflare`   | `server` | —                                  | rejected at build     |

See the [Config](/docs/config) page for the full `TryggConfig` reference, the [Vite plugin](/docs/vite-plugin) page for how the plugin consumes it, and [API types](/docs/api-types) for the generated same-origin client used by `output: "server"` apps.
