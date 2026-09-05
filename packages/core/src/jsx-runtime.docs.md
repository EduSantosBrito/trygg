# jsx-runtime

Build a trygg `Element` the same way the compiler does, when you are writing tooling or JSX-lowering code by hand instead of `.tsx`.

```ts
import { jsx } from "trygg/jsx-runtime";

// What `<div id="root">hi</div>` lowers to:
const element = jsx("div", { id: "root", children: "hi" });
```

## When to use

Almost never call this directly. TypeScript and Vite target this entrypoint automatically when `jsxImportSource` is set to `trygg`, so every `.tsx` file you write already lowers to `jsx`, `jsxs`, and `Fragment` for you.

Reach for it by hand only when:

- You are writing a macro, codegen, or another tool that emits trygg `Element` values without going through JSX syntax.
- You need to construct an `Element` in a context where JSX is unavailable.

For normal UI, write JSX inside a `Component` and let the compiler emit these calls. See the `Component` and `Element` topics.

## Behavior

`jsx(type, props, key?)` produces a trygg `Element` from a `type` and a props object. `type` is either an intrinsic tag string (`"div"`, `"span"`) or a `Component.Type` created with `Component.gen`. Children are passed on `props.children`, and `key` is supplied by the compiler as the dedicated third argument (falling back to `props.key` only when that argument is absent).

`jsxs` is the same function value as `jsx`. The compiler picks `jsxs` when a JSX expression has a static array of children and `jsx` for a single child; both build the same `Element`.

`Fragment` groups children without adding a DOM node. It is a `Component.gen` that normalizes its `children` and returns an `Element.Fragment`, or the empty element when there are no children.

Construction is data-building, so the common intrinsic and component cases build synchronously. A few cases are deferred: a Signal child, or an invalid `type`. Passing a plain function or a bare Effect as `type` is invalid — the resulting `Element` carries an `InvalidComponentError` that surfaces when the Renderer mounts it, not when `jsx` is called.

`JSXProps` is the props shape the runtime accepts: intrinsic element props plus an optional `key`. `JSXElementType` is the union the compiler passes as `type`: a tag string or a `Component.Type`.

## Related exports

- `jsx` — build a trygg `Element` from type and props
- `jsxs` — same function as `jsx`, picked for static children
- `Fragment` — groups children without adding a DOM node
- `JSXProps` — props shape the runtime accepts: intrinsic props plus optional `key`
- `JSXElementType` — the type union: tag string or `Component.Type`

## Troubleshooting

- Symptom: an `InvalidComponentError` appears at mount, not at the `jsx` call. Cause: `type` was a plain function or a raw Effect instead of a `Component.Type`. Fix: create the component with `Component.gen` so it carries the `Component.Type` brand the runtime expects.
- Symptom: `.tsx` files do not lower to trygg's `jsx`/`jsxs`/`Fragment`. Cause: `jsxImportSource` is not set to `trygg`. Fix: set `jsxImportSource: "trygg"` so the compiler resolves the `trygg/jsx-runtime` subpath automatically — the trygg Vite plugin sets this for you.
