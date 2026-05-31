import { Effect, Schema } from "effect";

import * as Component from "../primitives/component.js";
import { Element, keyed, type ElementKey } from "../primitives/element.js";
import type { Element as ElementType } from "../primitives/element.js";
import { unsafeAsElementProps } from "./unsafe.js";

type RuntimeProps = Record<string, unknown>;

const InvalidJsxComponentInputReason = Schema.Union([
  Schema.Literal("plain-function"),
  Schema.Literal("effect"),
  Schema.Literal("unknown"),
]);

export class InvalidJsxComponentInput extends Schema.TaggedErrorClass<InvalidJsxComponentInput>()(
  "InvalidJsxComponentInput",
  {
    reason: InvalidJsxComponentInputReason,
    displayName: Schema.optional(Schema.String),
    key: Schema.NullOr(Schema.Union([Schema.String, Schema.Number])),
  },
) {}

interface NormalizedJsxInput {
  readonly props: RuntimeProps;
  readonly childElements: ReadonlyArray<ElementType>;
  readonly elementProps: import("../primitives/element.js").ElementProps;
  readonly resolvedKey: ElementKey | null;
}

const isElementKey = (value: unknown): value is ElementKey =>
  typeof value === "string" || typeof value === "number";

const isRecord = (value: unknown): value is RuntimeProps =>
  typeof value === "object" && value !== null;

// Copy `props` minus the runtime-reserved `children` and `key` fields in a single
// pass. The previous `Object.fromEntries(Object.entries(props).filter(...))` form
// allocated, per JSX node, an entries array plus a `[k, v]` tuple for every key
// plus a filtered array before the result object — three-plus short-lived objects
// per node. On the create benchmark that is ~10k nodes per render, so the
// intermediate tuples/arrays surface directly as GC pressure. `Object.keys` +
// an indexed loop is the same own-enumerable, insertion-order semantics with one
// array and the result object, and no per-prop tuple garbage.
const stripReservedProps = (props: RuntimeProps): RuntimeProps => {
  const result: RuntimeProps = {};
  const keys = Object.keys(props);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (key !== "children" && key !== "key") {
      result[key] = props[key];
    }
  }
  return result;
};

const PropReadFailedTypeId: unique symbol = Symbol("trygg/PropReadFailed");

interface PropReadFailed {
  readonly [PropReadFailedTypeId]: true;
}

const PropReadFailed: PropReadFailed = { [PropReadFailedTypeId]: true };

const readPropKeys = (props: RuntimeProps): Effect.Effect<ReadonlyArray<string>> =>
  Effect.try({
    try: () => Object.keys(props),
    catch: () => PropReadFailed,
  }).pipe(Effect.catch(() => Effect.succeed([])));

const readPropValue = (
  props: RuntimeProps,
  property: string,
): Effect.Effect<unknown | PropReadFailed> =>
  Effect.try({
    try: () => props[property],
    catch: () => PropReadFailed,
  }).pipe(Effect.catch((failed: PropReadFailed) => Effect.succeed(failed)));

const collectProps = Effect.fnUntraced(function* (props: RuntimeProps) {
  const result: RuntimeProps = {};
  const keys = yield* readPropKeys(props);

  for (const property of keys) {
    const value = yield* readPropValue(props, property);
    if (value !== PropReadFailed) {
      result[property] = value;
    }
  }

  return result;
});

const normalizeInput: (props: unknown, key?: ElementKey) => Effect.Effect<NormalizedJsxInput> =
  Effect.fnUntraced(function* (props: unknown, key?: ElementKey) {
    const resolvedProps = isRecord(props) ? yield* collectProps(props) : {};
    const children = resolvedProps.children;
    const propsKeyRaw = resolvedProps.key;
    const propsKey = isElementKey(propsKeyRaw) ? propsKeyRaw : undefined;
    const resolvedKey = key ?? propsKey ?? null;
    const elementProps = unsafeAsElementProps(stripReservedProps(resolvedProps));

    return {
      props: resolvedProps,
      childElements: yield* Element.fromChildren(children),
      elementProps,
      resolvedKey,
    };
  });

const buildIntrinsic = Effect.fnUntraced(function* (tag: string, input: NormalizedJsxInput) {
  return Element.Intrinsic({
    tag,
    props: input.elementProps,
    children: input.childElements,
    key: input.resolvedKey,
  });
});

const buildComponent = Effect.fnUntraced(function* (
  type: Component.Component.Type<unknown>,
  input: NormalizedJsxInput,
) {
  const element = type(input.props);
  return input.resolvedKey === null ? element : keyed(input.resolvedKey, element);
});

const build: (
  type: unknown,
  props: unknown,
  key?: ElementKey,
) => Effect.Effect<ElementType, InvalidJsxComponentInput> = Effect.fnUntraced(function* (
  type: unknown,
  props: unknown,
  key?: ElementKey,
) {
  const input = yield* normalizeInput(props, key);

  if (typeof type === "string") {
    return yield* buildIntrinsic(type, input);
  }

  if (Effect.isEffect(type)) {
    return yield* new InvalidJsxComponentInput({
      reason: "effect",
      key: input.resolvedKey,
    });
  }

  if (Component.isEffectComponent(type)) {
    return yield* buildComponent(type, input);
  }

  return yield* new InvalidJsxComponentInput({
    reason: typeof type === "function" ? "plain-function" : "unknown",
    displayName: typeof type === "function" ? type.name : undefined,
    key: input.resolvedKey,
  });
});

/**
 * Synchronous fast path for {@link build}.
 *
 * @remarks
 * JSX element construction is pure data-building; the Effect wrapper exists only
 * for the defensive per-prop reads and the lazy invalid-component failure. For
 * the overwhelmingly common cases — an intrinsic tag, or a valid Effect
 * component, with no `Signal` children — this builds the identical `Element`
 * synchronously so the runtime never spins a fiber per node. Returns `null` to
 * defer to the Effect-based {@link build} when a child needs effectful
 * resolution (a `Signal`, peeked by `fromChildren`) or `type` is not a plain
 * intrinsic/component (the rare invalid-input branches, whose failure elements
 * `build` already produces).
 */
const buildSync = (type: unknown, props: unknown, key?: ElementKey): ElementType | null => {
  const resolvedProps: RuntimeProps = isRecord(props) ? props : {};
  const childElements = Element.fromChildrenSync(resolvedProps.children);
  if (childElements === null) {
    return null;
  }

  const propsKeyRaw = resolvedProps.key;
  const propsKey = isElementKey(propsKeyRaw) ? propsKeyRaw : undefined;
  const resolvedKey = key ?? propsKey ?? null;

  if (typeof type === "string") {
    const elementProps = unsafeAsElementProps(stripReservedProps(resolvedProps));
    return Element.Intrinsic({
      tag: type,
      props: elementProps,
      children: childElements,
      key: resolvedKey,
    });
  }

  if (Component.isEffectComponent(type)) {
    const element = type(resolvedProps);
    return resolvedKey === null ? element : keyed(resolvedKey, element);
  }

  return null;
};

export const JsxBuilder = {
  build,
  buildSync,
  normalizeInput,
};
