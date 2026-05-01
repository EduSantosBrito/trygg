# Custom Oxlint Rules

Rules to enforce Trygg's Effect-native component lifecycle model. These are planned custom rules, not current lint behavior.

## Component provision

1. **no-component-method-provide**
   - Disallow `SomeComponent.provide(layer)`.
   - Use `SomeComponent.pipe(Component.provide(layer))`.

2. **no-inline-component-provide-in-render**
   - Disallow calling `Component.provide(...)` or `.pipe(Component.provide(...))` inside `Component.gen` bodies or JSX render paths.
   - Provided component identities should be stable and defined outside render.

3. **component-provide-layer-only**
   - `Component.provide(...)` should receive exactly one Effect `Layer` value.
   - Do not accept arrays, raw service values, or context-like objects.

4. **prefer-effect-layer-composition**
   - Discourage Trygg-specific layer composition patterns at component boundaries.
   - Prefer named layers composed with `Layer.mergeAll`, `Layer.provide`, and `Layer.provideMerge` before passing to `Component.provide`.

## Signal lifecycle

5. **no-signal-make-sync**
   - Disallow `Signal.makeSync` entirely.
   - Reactive state must be created with `Signal.make` inside a component scope, provider scope, or explicit Effect scope.

6. **no-module-scope-signal-make**
   - Disallow `Signal.make(...)` at module top level or in non-Effect initialization paths.
   - Signals must have an owner scope.

7. **no-unscoped-signal-run**
   - Flag `Effect.runSync` / `Effect.runPromise` programs that create signals without `Effect.scoped` or a Trygg lifecycle owner.

## Route provision

8. **route-provide-strategies-only**
   - `Route.provide(...)` may only receive route strategy layers such as render and scroll strategies.
   - Application services must be provided at component/layout boundaries.

9. **no-route-service-provide**
   - Disallow route-level provision of application service layers.
   - Move service ownership to page/layout components via `Component.provide`.

## Store patterns

10. **prefer-layer-effect-store**
    - Encourage store services that own reactive state to use `Layer.effect` plus `Signal.make`.
    - Discourage module-private signal globals and `Layer.succeed` stores with mutable global state.

11. **no-prop-derived-provider-layer-in-render**
    - Disallow constructing provider layers from component props inside render.
    - Use explicit store config services for construction-time config, or service methods/signals for runtime changes.

## Future diagnostics

12. **provided-component-display-name**
    - Encourage stable exported names for provided components so debug traces can show useful component lineage.
