# Component lifecycle provision for provided layers

Trygg treats `.provide(layer)` as a component lifecycle boundary rather than a render-time wrapper or user-facing provider element: provided layers are acquired once per mounted provided component instance, reused across rerenders while provider identity and key are stable, and finalized on unmount or replacement. This makes stores built with `Layer.effect` and `Signal.make` Effect-idiomatic scoped services, replacing module-lifetime `Signal.makeSync` state and dynamic layer swapping for UI state.

## Consequences

- Each mounted provided component instance owns its own provider scope; providing at a root layout creates shared application-level state for that subtree.
- Nested providers follow Effect context shadowing: the nearest provider for a service tag wins within its subtree.
- Changing provider identity or key replaces the provider scope; changing props does not.
- Store construction parameters are explicit config services composed with layers, not implicit component props.
- Event handlers run with the provider context captured for their rendered element.
- `Signal.makeSync` is removed rather than repositioned; reactive state should be created inside Effect scopes with `Signal.make`.
- General application services should be provided at component/layout boundaries; route-level provision is reserved for route strategies.
- Component provision accepts one boundary layer per `Component.provide(layer)` call through the canonical pipeable API; repeated provision creates nested provider scopes with Effect-style semantics rather than merging layers in Trygg.
- Layer composition, provision ordering, requirements narrowing, dependency satisfaction, and shadowing remain owned by Effect APIs and semantics.
