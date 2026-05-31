# jsx-dev-runtime

Keep source-location and debug metadata flowing into your trygg Elements during development, so render failures can point back at the file and line that produced them; a JSX compiler targets this entrypoint for you and you almost never call it by hand.

```ts
import { jsxDEV } from "trygg/jsx-dev-runtime";

// what the compiler lowers `<div id="root" />` to in a dev build
const element = jsxDEV(
  "div",
  { id: "root" },
  undefined, // key
  false, // isStaticChildren
  { fileName: "App.tsx", lineNumber: 1, columnNumber: 1 },
  undefined, // self
);
```

## When to use

You configure this entrypoint, you do not import it. Point a tool's `jsxImportSource` at `trygg`; the dev runtime is selected for you in development builds and the production `jsx-runtime` in production builds. Write components with `Component.gen` and JSX and let the compiler emit the `jsxDEV` calls.

Reach for it directly only when authoring tooling — a compiler plugin, a test harness, or a codegen step — that emits or inspects lowered dev-mode JSX.

## Behavior

`jsxDEV(type, props, key, isStaticChildren, source, self)` accepts the three extra development-only arguments a JSX compiler supplies (`isStaticChildren`, `source`, `self`, on top of the shared `type`/`props`/`key`), then delegates to the production `jsx` runtime. Dev and production lowering therefore produce the same `Element` shape; the extra arguments are accepted and currently unused, reserved for richer error messages.

`type` is an intrinsic tag string or a `Component`, mirroring `jsx`. `jsxsDEV` is the static-children companion the compiler lowers to when an element has multiple static children; it is the same function. `Fragment` is re-exported so the runtime can render `<>…</>` without a wrapper element.

## Related exports

- `jsxDEV` — dev lowering with source/self args, delegates to `jsx`
- `jsxsDEV` — static-children companion to `jsxDEV`, the same function
- `Fragment` — re-exported to render `<>…</>` without a wrapper
- `jsx` — production runtime `jsxDEV` delegates to
- `Element`

## Troubleshooting

Symptom: production-only behavior differs from what you saw while developing. Cause: only the entrypoint changes between builds (`jsx-dev-runtime` versus `jsx-runtime`); both yield identical Elements, so a divergence is in your build configuration, not the runtime. Confirm `jsxImportSource` resolves to `trygg` in both modes.