# Configuration

## When to use

Use `trygg/config` in `trygg.config.ts` when an app needs one typed place to choose its production runtime and output mode.

## Behavior

`defineConfig` is a thin typed wrapper over the config object. The resulting shape is shared with `trygg/vite-plugin`, so app config and build setup stay aligned.

`platform: "cloudflare"` is an explicit runtime platform. With `output: "static"`, trygg emits a Static SPA with public `dist/index.html` plus an internal `.trygg/worker-entry.js` Cloudflare Worker that serves `ASSETS` first and falls back root/document requests to the SPA shell. Bun and Node static builds do not emit Cloudflare Worker artifacts.

## Related exports

- `defineConfig`
- `TryggConfig`
- `Platform`
- `Output`
