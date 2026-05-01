# Configuration

## When to use

Use `trygg/config` in `trygg.config.ts` when an app needs one typed place to choose its production runtime and output mode.

## Behavior

`defineConfig` is a thin typed wrapper over the config object. The resulting shape is shared with `trygg/vite-plugin`, so app config and build setup stay aligned.

`platform` and `output` are orthogonal. `platform` selects the runtime platform contract, such as Bun, Node, or Cloudflare. The public config remains `platform`, not `adapter`, because trygg models runtime behavior through Effect services and Layers rather than naming deploy-tool adapters. `output` selects the artifact mode generated for that platform.

Use `output: "static"` for a Static SPA. Static output serves generated assets directly and falls back app routes to the SPA shell. It does not include server-owned behavior such as API routes or SSR.

Use `output: "server"` when the app has server-owned behavior. Today, server output requires `app/api.ts`; if an app has no API module, use `output: "static"` instead. Server output reserves `/api/*` for API routes across supported runtime platforms.

`platform: "cloudflare"` is an explicit runtime platform. Cloudflare static and server outputs share the Cloudflare Worker artifact path at `.trygg/worker-entry.js`. Bun and Node builds do not emit Cloudflare Worker artifacts.

The Cloudflare server MVP supports APIs from `app/api.ts`, generated static assets, and SPA fallback for document-like non-API requests. It explicitly excludes full SSR route rendering. Server output adds API capability to the same Worker artifact concept rather than introducing a second deploy entry.

Cloudflare Worker output uses the fixed `ASSETS` binding for Workers Static Assets. Preview and deploy tooling must provide that binding, and the binding name is not configurable today.

Public Cloudflare preview UX is deferred. Generated production Worker output is the contract; local preview tooling is not part of the public config surface yet.

## Related exports

- `defineConfig`
- `TryggConfig`
- `Platform`
- `Output`
