# Head

## When to use

Use `Head` when components need to describe document metadata near the route or UI that owns it instead of mutating `document.head` manually.

## Behavior

The `Head` module defines the hoisting rules, key derivation, and browser or test services that keep `<title>`, `<meta>`, and related tags deduplicated as components mount and unmount.

## Related exports

- `Head.HeadStrategy`
- `Head.deriveKey`
- `Head.makeBrowserHead`
- `Head.browserHeadLayer`
