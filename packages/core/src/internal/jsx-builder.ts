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
    const elementProps = unsafeAsElementProps(
      Object.fromEntries(
        Object.entries(resolvedProps).filter(
          ([property]) => property !== "children" && property !== "key",
        ),
      ),
    );

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

export const JsxBuilder = {
  build,
  normalizeInput,
};
