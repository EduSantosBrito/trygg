# Portal

## When to use

Use `Portal` when UI should stay owned by the current component tree but render into a different DOM target such as a modal root or `document.body`. Common cases are modals, tooltips, toasts, and overflow-escaping popovers.

## Behavior

`Portal.make` returns a component that teleports its content into a resolved target. Portals can use a fixed element, a selector, or a dynamic container and can be toggled with the `visible` prop.

For modal lifecycle, keep open state in a signal and pass it to `visible`. When the signal flips to `false`, the portalled subtree unmounts: component scopes close, pending Effect fibers are interrupted, subscription listeners are removed, and any DOM nodes created by the portal are detached. When the owning component scope closes (for example, the parent unmounts), any dynamic container created by `Portal.make` is also removed. The modal still reads the same services and signals as the owner component because only DOM placement changes; ownership and Effect context do not.

```tsx
const ModalDemo = Component.gen(function* () {
  const isOpen = yield* Signal.make(false)

  const ModalRoot = yield* Portal.make(
    <div className="backdrop">
      <div className="dialog">
        <h2>Confirm action</h2>
        <button onClick={() => Signal.set(isOpen, false)}>Close</button>
      </div>
    </div>,
    { target: document.body },
  )

  return (
    <>
      <button onClick={() => Signal.set(isOpen, true)}>Open modal</button>
      <ModalRoot visible={isOpen} />
    </>
  )
})
```

The modal still reads the same services and signals as the owner component because only DOM placement changes; ownership and Effect context do not.

## Related exports

- `Portal.make`
- `PortalProps`
- `PortalOptions`
- `PortalTargetNotFoundError`
