# Portal

Render children into a DOM node elsewhere in the document — a modal root, `document.body`, a toast region — so overlays escape `overflow` and stacking contexts while the content stays inside your Component tree, services, and lifecycle.

```tsx
import { Component, Portal, Signal } from "trygg";

const ModalDemo = Component.gen(function* () {
  const isOpen = yield* Signal.make(false);

  const ModalRoot = yield* Portal.make(
    <div className="backdrop">
      <div className="dialog">
        <h2>Confirm action</h2>
        <button onClick={() => Signal.set(isOpen, false)}>Close</button>
      </div>
    </div>,
    { target: document.body },
  );

  return (
    <>
      <button onClick={() => Signal.set(isOpen, true)}>Open modal</button>
      <ModalRoot visible={isOpen} />
    </>
  );
});
```

## When to use

Reach for `Portal` when UI must stay owned by the current Component tree but render into a different DOM target. Common cases are modals, tooltips, toasts, and popovers that need to escape a clipping `overflow` or a parent stacking context.

Pick something else when DOM placement is not the problem. If you only need to swap which subtree shows, return a different Element from the Component; if you need to recover from a failed render, use ErrorBoundary; if you need document metadata, use Head.

## Behavior

`Portal.make` is an Effect that resolves a target and returns a Component you render as JSX. The returned Component accepts an optional `visible` prop (`PortalProps`):

- Omitted: the content always renders into the target.
- A static boolean: `true` renders, `false` renders nothing.
- A `Signal<boolean>`: the portal mounts and unmounts as the Signal flips, without redefining the content.

Targets come from `PortalOptions.target`:

- An `HTMLElement`: rendered into directly.
- A CSS selector string: resolved once with `document.querySelector` when `Portal.make` runs.
- Omitted: a `div[data-portal-container]` is created under `document.body` and removed when the owning Component scope closes.

The portalled subtree only changes DOM placement. It reads the same services and Signals as the owner Component; ownership and Effect context do not move with the DOM node. When `visible` flips to `false` or the owner scope closes, the subtree unmounts: child scopes close, pending fibers are interrupted, subscriptions are removed, and portal-created DOM is detached.

Selector targets resolve at creation time, not at render time. If the selector matches nothing or matches a non-`HTMLElement`, `Portal.make` fails with `PortalTargetNotFoundError` carrying the offending `target` string — handle it like any other typed error before the Mount boundary.

Malformed selectors and native DOM acquisition failures return `PortalDomError`,
which records the operation and original cause. Dynamic containers acquire their
cleanup owner before insertion. Failed or interrupted acquisition rolls back
immediately; acquisition into a closed owner is interrupted before allocating DOM.
A failed removal during Scope finalization remains observable as a defect carrying
`PortalDomError`; other finalizers still run. If acquisition and rollback both
fail, the resulting Cause retains both failures.

`Portal.make` is client-only: it reads `document` directly to create or resolve its
target and has no server-side rendering path. Missing DOM access returns
`PortalDomError`. Create portals from client-rendered Components only.

## Related exports

- `Portal.make` — resolve a target and return a renderable Component
- `PortalProps` — the optional `visible` prop on the returned Component
- `PortalOptions` — `target` for the portal's DOM destination
- `PortalTargetNotFoundError` — failure when the selector resolves no `HTMLElement`
- `PortalDomError` — failed native acquisition or container removal

## Troubleshooting

- Symptom: `Portal.make` fails with `PortalTargetNotFoundError`. Cause: the selector matched nothing because the target node mounts after `Portal.make` runs. Fix: render the portal into `document.body` (omit `target`), pass an already-mounted `HTMLElement`, or move `Portal.make` after the target exists.
- Symptom: the overlay renders but stays clipped or hidden behind other content. Cause: the chosen target is itself inside the clipping `overflow` or stacking context. Fix: target a node nearer the document root, such as `document.body` or a dedicated `#modal-root`.
