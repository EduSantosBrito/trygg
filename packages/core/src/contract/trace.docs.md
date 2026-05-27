# Contract Trace

## When to use

Use contract traces only in Trygg behavior contracts and framework-owned verification tests. A **contract trace** is a verifier-facing record of meaningful framework side effects; it is no-op by default and is not a public app-facing observability API.

Do not use contract traces as application telemetry, debug logging, or a replacement for Effect tracing. Emit only semantic transitions that define framework correctness.

## Behavior

Trace events are grouped into stable event families. Behavior contracts may assert the event names and ordering guarantees below, but should avoid depending on private helper call order or every Effect runtime step.

### Navigation family

Events:

- `router.navigate.request`
- `router.navigate.commit`
- `router.current.set`
- `router.query.set`
- `history.push`
- `history.replace`
- `history.back`
- `history.forward`
- `prefetch.trigger`

Ordering guarantees:

1. `router.navigate.request` is emitted before a Router-owned navigation writes history or commits the **Current route**.
2. A successful client navigation emits exactly one history intent (`history.push`, `history.replace`, `history.back`, or `history.forward`) before the matching route commit becomes observable.
3. `router.current.set` and `router.query.set` describe committed Router state, not speculative route matching.
4. `prefetch.trigger` is advisory and may occur before navigation; it must not imply a route commit.

### Route activation family

Events:

- `outlet.process.start`
- `outlet.process.commit`
- `outlet.process.dropStale`
- `outlet.lazyLeaf.load.start`
- `outlet.lazyLeaf.load.ready`
- `outlet.lazyLeaf.load.error`
- `outlet.match.found`
- `outlet.match.notFound`
- `route.leaf.mount`
- `route.leaf.unmount`
- `route.render.skipStale`
- `route.layout.skipStale`
- `route.finalizer.run`

Ordering guarantees:

1. `outlet.process.start` begins one Outlet attempt to render the active **Route** tree from the **Routes manifest**.
2. Lazy leaf events are ordered as `outlet.lazyLeaf.load.start` followed by either `outlet.lazyLeaf.load.ready` or `outlet.lazyLeaf.load.error` for the same activation.
3. `outlet.process.dropStale`, `route.render.skipStale`, and `route.layout.skipStale` mean a newer activation won; they must happen before any stale visible commit.
4. `outlet.process.commit` is emitted only after the activation selected by RouteActivation becomes the visible route content.
5. `route.leaf.unmount` and `route.finalizer.run` belong to cleanup of the previously visible route tree and occur after the replacement commit that makes cleanup safe.

### Render transaction family

Events:

- `signalElement.create`
- `signalElement.scope.start`
- `signalElement.swap.start`
- `signalElement.swap.render`
- `signalElement.swap.dropStale`
- `signalElement.swap.commit`
- `signalElement.cleanup`
- `dom.create`
- `dom.remove`
- `component.render`

Ordering guarantees:

1. A no-blank replacement renders the next **Element** before removing the previous visible DOM.
2. `signalElement.swap.render` precedes `signalElement.swap.commit` for successful SignalElement swaps.
3. `signalElement.swap.dropStale` means the rendered result was superseded and must be cleaned without becoming visible.
4. `signalElement.cleanup` and `dom.remove` describe cleanup after a safe commit or unmount, not pre-commit blanking.
5. `component.render` is a cost/semantic boundary for the **Component** producing an **Element** tree; it must not imply a provider scope replacement by itself.

### Provider and signal lifecycle family

Events:

- `provider.acquire`
- `provider.reuse`
- `provider.failure`
- `provider.replace`
- `provider.finalize`
- `signal.create`
- `signal.dispose`
- `signal.disposed_access`
- `signal.subscribe`
- `signal.unsubscribe`
- `signal.set`

Ordering guarantees:

1. `provider.acquire` is emitted when a mounted provided **Component** creates a **provider scope**.
2. `provider.reuse` is emitted when provider identity is stable across rerender; it must not be interpreted as Layer re-acquisition.
3. `provider.replace` precedes acquiring the replacement provider scope for identity or key changes.
4. `provider.finalize` occurs when the provider scope is closed after unmount, replacement, or failure cleanup.
5. `signal.dispose` belongs to scope-owned reactivity cleanup. `signal.disposed_access` is diagnostic and precedes the runtime failure for accessing a disposed Signal.

### Scroll family

Events:

- `scroll.apply`

Ordering guarantees:

1. `scroll.apply` occurs after the Outlet has committed the route content whose scroll strategy is being applied.
2. Hash, restore, top, and no-scroll decisions are represented in payload fields rather than separate public event names unless a future behavior contract needs them.
3. Scroll traces are best-effort semantic records; storage or platform scroll failures must not change route activation ordering.

### Effect lifecycle family

Events:

- `effect.fork.scoped`
- `effect.fiber.interrupt`
- `effect.finalizer.register`
- `effect.finalizer.run`
- `effect.scope.close`
- `effect.error.ignored`

Ordering guarantees:

1. These events represent Trygg-owned Effect lifecycle seams, not all Effect runtime internals.
2. `effect.finalizer.register` precedes the corresponding `effect.finalizer.run` for framework-owned finalizers.
3. `effect.scope.close` is emitted at explicit Trygg scope closure boundaries such as provider, signal, component, Portal, or Boundary cleanup.
4. `effect.error.ignored` is diagnostic and must only mark errors that framework cleanup intentionally narrows or tolerates.

## Related exports

- `ContractTraceEventName`
- `ContractTraceLevel`
- `ContractTraceEvent`
- `ContractTraceRecord`
- `ContractTraceCollector`
- `createInMemoryCollector`
- `withCollector`
- `withAction`
- `emit`
