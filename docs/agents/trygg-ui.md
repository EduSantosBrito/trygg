# Trygg UI Patterns

- Components use `Component.gen(function* () { ... })`.
- Children yield services; parents provide them with `.pipe(Component.provide(layer))`.
- The top-level effect passed to mount must have `R = never`.
- Event handlers are effect thunks: `() => Effect.Effect<void>`.
