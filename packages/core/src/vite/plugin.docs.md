# Vite Plugin

## When to use

Use `trygg/vite-plugin` in `vite.config.ts` when you want trygg's JSX transform, generated entry module, route types, and optional dev API wiring applied as one Vite plugin.

## Behavior

The `trygg` factory configures Vite for the trygg JSX runtime, manages generated `.trygg` files, and boots the dev-time routing and API integration path from app config.

For `.tsx` modules, the plugin also applies a hidden JSX requirement lowering pass. User source stays as JSX, but Vite receives explicit `jsx` / `jsxs` calls from `trygg/jsx-runtime` so component child requirements remain visible to Trygg-owned tooling and generated type fixtures.

Current limitation: stock TypeScript, `tsgo --noEmit`, and editor hovers still parse raw JSX as `JSX.Element` without running Vite plugins, so they can still erase child component requirements until a Trygg-owned typecheck/editor integration feeds them the lowered virtual source.

## Related exports

- `trygg`
- `TryggOptions`
- `TryggPlugin`
