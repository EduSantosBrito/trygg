# Vite Plugin

Add trygg's JSX transform, route code-splitting, generated entry module, and dev API wiring to a Vite app with one plugin in `vite.config.ts`.

```ts
import { defineConfig } from "vite";
import { trygg } from "trygg/vite-plugin";

export default defineConfig({
  plugins: [trygg()],
});
```

## When to use

Add `trygg()` to `vite.config.ts` for every trygg app built on Vite — it is required, not optional. Without it, `.tsx` files never lower to trygg's JSX runtime, routes are not code-split, and the dev API path is not wired. There is nothing to configure for the common case; pass `TryggOptions` only to opt into non-default behavior.

## Behavior

The `trygg` factory configures Vite for the trygg JSX runtime, manages generated `.trygg` files, and boots the dev-time routing and API integration path from app config.

For `.tsx` modules, the plugin also applies a hidden JSX requirement lowering pass. User source stays as JSX, but Vite receives explicit `jsx` / `jsxs` calls from `trygg/jsx-runtime` so component child requirements remain visible to Trygg-owned tooling and generated type fixtures.

Current limitation: stock TypeScript, `tsgo --noEmit`, and editor hovers still parse raw JSX as `JSX.Element` without running Vite plugins, so they can still erase child component requirements until a Trygg-owned typecheck/editor integration feeds them the lowered virtual source.

## Related exports

- `trygg`
- `TryggOptions`
- `TryggPlugin`
