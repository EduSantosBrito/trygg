# Configuration

Declare the production runtime and build output once in a typed config that both the Vite plugin and the build consume.

```ts
import { defineConfig } from "trygg/config";

export default defineConfig({
  platform: "bun",
  output: "server",
});
```

## When to use

Use `trygg/config` in `trygg.config.ts` when an app needs one typed place to choose its production runtime and output mode. `defineConfig` gives editor completion and type-checking on every field; the Vite plugin reads the same `TryggConfig` shape, so build setup and runtime stay aligned.

## Behavior

`defineConfig` returns the provided object unchanged — its only job is to type the argument as `TryggConfig`. The two fields are orthogonal:

- `platform` (`"bun" | "cloudflare" | "node"`) selects the runtime platform for dev API handling and the production server entrypoint. The field is `platform`, not `adapter`, because trygg models runtime behavior through Effect services and Layers rather than naming deploy-tool adapters.
- `output` (`"server" | "static"`) selects the artifact mode generated for that platform.

`output: "static"` emits generated assets served directly, with fallback to the SPA shell for navigation requests and no server-owned behavior such as API routes. If `app/api.ts` exists, the build warns that those API routes are not included in a static build.

`output: "server"` (on `platform: "bun"` or `platform: "node"`) generates a production server entry whose middleware serves static files, reserves `/api/*` for API routes, and falls back to the SPA shell for other GET requests. `app/api.ts` is optional: when it is absent the API route is simply not wired, so reach for `output: "server"` whenever the app has server-owned behavior and `output: "static"` otherwise. The server entry serves the static shell for navigation; it does not perform server-side route rendering.

`platform: "cloudflare"` is supported with `output: "static"` only. That combination emits a Cloudflare Worker at `.trygg/worker-entry.js` that serves assets through the fixed `ASSETS` binding (the binding name is not configurable today) and falls back to `/index.html` for document-like requests. `output: "server"` with `platform: "cloudflare"` is rejected with a build error today, and `app/api.ts` alongside `platform: "cloudflare"` + `output: "static"` is also rejected — use `platform: "bun"` or `platform: "node"` for server output and API routes.

## Related exports

- `defineConfig` — type a config object as `TryggConfig`, returned unchanged
- `TryggConfig` — the `platform` and `output` config shape
- `Platform` — the `"bun" | "cloudflare" | "node"` runtime union
- `Output` — the `"server" | "static"` artifact-mode union

See the Vite Plugin guide for the `trygg()` plugin that consumes this config in `vite.config.ts`.