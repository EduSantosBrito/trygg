# Configuration

## When to use

Use `trygg/config` in `trygg.config.ts` when an app needs one typed place to choose its production runtime and output mode.

## Behavior

`defineConfig` is a thin typed wrapper over the config object. The resulting shape is shared with `trygg/vite-plugin`, so app config and build setup stay aligned.

## Related exports

- `defineConfig`
- `TryggConfig`
- `Platform`
- `Output`
