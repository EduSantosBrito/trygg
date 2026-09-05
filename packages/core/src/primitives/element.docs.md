# Element

Construct, inspect, and transform the tagged tree that JSX compiles to — without writing JSX — for codegen, dynamic trees, and tooling.

```ts
import { intrinsic, text, fragment, isElement } from "trygg";

const tree = intrinsic("ul", {}, [
  intrinsic("li", {}, [text("one")]),
  intrinsic("li", {}, [text("two")]),
]);

const grouped = fragment([tree]);
isElement(grouped); // true
```

## When to use

Most apps never touch this surface: you write JSX, and the JSX runtime lowers each tag into these constructors for you. Reach for the `Element` model directly when you are below the JSX layer, generating UI from data you only have at runtime, or building tooling that walks the tree:

- Generating an element tree from data whose shape JSX cannot spell statically (codegen, schema-driven layouts).
- Inspecting or transforming an existing tree — read a tag, narrow with `isElement`, or rekey a node for reconciliation.
- Authoring a low-level helper or renderer integration that must accept the same child values JSX accepts.

If you are writing an ordinary Component, use JSX and `Component.gen` instead. If you only need fine-grained reactivity, pass a `Signal` into JSX.

## Behavior

`Element` is a tagged enum — the normalized data shape that represents JSX output before the renderer mounts it. Each JSX form maps to one tag: a string tag becomes `Intrinsic`, a string or number child becomes `Text`, `<>…</>` becomes `Fragment`, a Component invocation becomes `Component`, and a `Signal` child becomes `SignalText` or `SignalElement`. The renderer pattern-matches on these tags; constructing them by hand produces the identical input.

The constructors are thin and synchronous:

- `intrinsic(tag, props, children, key?)` builds an `Intrinsic` node. `children` is a `ReadonlyArray<Element>` — already-normalized elements, not raw JSX children. Wrap strings in `text(...)`.
- `text(content)` builds a `Text` node from a string.
- `fragment(children)` groups a `ReadonlyArray<Element>` with no wrapper DOM node.
- `keyedList(source, renderFn, keyFn)` builds the list primitive that keeps stable scopes per key across updates, so nested Signals survive reorders. `source` is a `Signal<ReadonlyArray<T>>`.
- `empty` is the canonical no-op element (an empty fragment) that child normalization emits for nullish or boolean children.

Inspection and reconciliation helpers operate on the same shape:

- `isElement(value)` narrows an `unknown` to the tagged `Element` union.
- `isEmpty(element)` is true only for the empty-fragment value.
- `getKey(element)` reads the reconciliation key from `Intrinsic` and `Component` nodes; everything else returns `null`.
- `keyed(key, element)` returns a copy of an `Intrinsic` or `Component` node carrying that key; for any other tag it returns the element unchanged.

The `Element` namespace also carries the Effect-native escape hatches. `Element.fromEffect(effect, options?)` lifts an `Effect<Element, …>` into the lazy `Component` node the renderer drives at render time; wrap the effect in `Effect.suspend` first if construction must be deferred. `Element.fail(error, options?)` is the failure shortcut for `Element.fromEffect(Effect.fail(error))`. `Element.fromUnknown(child)` and `Element.fromChildren(children)` are the child-normalization boundaries — they flatten nested arrays, drop empty children, and lift primitives, all inside the current Effect pipeline rather than spinning a new sync boundary.

Sharp edges to know:

- `children` for `intrinsic` and `fragment` is `ReadonlyArray<Element>`, not the permissive `ElementChildren` JSX accepts. Strings and numbers will not auto-wrap; normalize them yourself (`text(...)`) or route raw input through `Element.fromChildren`.
- A raw `Effect` is not a valid child. `Element.fromUnknown` does not throw — it returns an `Element.fail` node that surfaces an `InvalidJsxChildError` when the renderer reaches it, and the JSX runtime produces the same failing element. Lift effects through `Component.gen` or `Element.fromEffect` instead.
- This is canary, escape-hatch surface. The public entrypoint re-exports the constructors above and the namespace methods, but not every internal constructor (for example, the `Provide` and `SignalText` builders stay internal); construct those tags through their owning APIs (`Portal`, for instance, has its own public `portal` constructor).

## Related exports

- `Element` — the tagged enum JSX lowers to before mounting
- `intrinsic` — build an `Intrinsic` node from tag, props, children
- `text` — build a `Text` node from a string
- `fragment` — group elements with no wrapper DOM node
- `keyedList` — list primitive keeping stable scopes per key across updates
- `empty` — the canonical no-op element, an empty fragment
- `isElement` — narrow an `unknown` to the `Element` union
- `isEmpty` — true only for the empty-fragment value
- `getKey` — read the reconciliation key from `Intrinsic`/`Component` nodes
- `keyed` — copy an `Intrinsic`/`Component` node carrying a key
- `Element.fromEffect` — lift an `Effect<Element>` into a lazy node
- `Element.fail` — failure shortcut for `fromEffect(Effect.fail(error))`
- `Element.fromUnknown` — normalize one child value into an Element
- `Element.fromChildren` — flatten and normalize raw children into Elements
- `ElementChild`
- `ElementChildren`
- `ElementProps`
- `ElementKey`
- `EventHandler`

## Troubleshooting

- Tree renders as `[object Object]` or a stray `,`: a string or number was placed directly in an `intrinsic`/`fragment` children array. Those constructors take `ReadonlyArray<Element>` only — wrap with `text(...)` or normalize through `Element.fromChildren`.
- `InvalidJsxChildError` with reason `effect`: a raw `Effect` reached a child slot. Wrap it in `Component.gen`, or lift it with `Element.fromEffect`.
- `keyed(key, node)` seems to do nothing: the node is neither `Intrinsic` nor `Component` (for example a `Fragment` or `Text`), so it is returned unchanged. Key the keyable element, or use `keyedList` for collections.
- `getKey(node)` returns `null` for a Fragment or Text: only `Intrinsic` and `Component` carry keys; that is expected.
