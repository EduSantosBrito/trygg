# Vite Plugin

## When to use

Use `trygg/vite-plugin` in `vite.config.ts` when you want trygg's JSX transform, generated entry module, route types, and optional dev API wiring applied as one Vite plugin.

## Behavior

The `trygg` factory configures Vite for the trygg JSX runtime, manages generated `.trygg` files, and boots the dev-time routing and API integration path from app config.

## Related exports

- `trygg`
- `TryggOptions`
- `TryggPlugin`
