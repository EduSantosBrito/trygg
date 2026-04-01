import { Effect, Match } from "effect";

import * as Component from "../primitives/component.js";
import {
  Element,
  componentElement,
  keyed,
  normalizeChildren,
  type ElementKey,
} from "../primitives/element.js";
import type { Element as RuntimeElement } from "../primitives/element.js";
import { unsafeAsElementProps } from "./unsafe.js";

type RuntimeProps = Record<string, unknown>;

interface NormalizedJsxInput {
  readonly props: RuntimeProps;
  readonly childElements: ReadonlyArray<RuntimeElement>;
  readonly elementProps: import("../primitives/element.js").ElementProps;
  readonly resolvedKey: ElementKey | null;
}

const isElementKey = (value: unknown): value is ElementKey =>
  typeof value === "string" || typeof value === "number";

const isRecord = (value: unknown): value is RuntimeProps => typeof value === "object" && value !== null;

const invalidComponentElement = (
  reason: "plain-function" | "effect" | "unknown",
  displayName: string | undefined,
  key: ElementKey | null,
): RuntimeElement =>
  componentElement(
    () =>
      Effect.fail(
        new Component.InvalidComponentError({
          reason,
          displayName,
        }),
      ),
    key,
  );

const normalizeInput = Effect.fn("JsxBuilder.normalizeInput")(function* (
  props: unknown,
  key?: ElementKey,
) {
  const resolvedProps = isRecord(props) ? props : {};
  const children = "children" in resolvedProps ? resolvedProps.children : undefined;
  const propsKeyRaw = "key" in resolvedProps ? resolvedProps.key : undefined;
  const propsKey = isElementKey(propsKeyRaw) ? propsKeyRaw : undefined;
  const resolvedKey = key ?? propsKey ?? null;
  const elementProps = unsafeAsElementProps(
    Object.assign(
      {},
      ...(yield* Effect.forEach(Object.entries(resolvedProps), ([property, value]) =>
        Effect.succeed(property === "children" || property === "key" ? {} : { [property]: value }),
      )),
    ),
  );

  return {
    props: resolvedProps,
    childElements: normalizeChildren(children),
    elementProps,
    resolvedKey,
  };
});

const buildIntrinsic = Effect.fn("JsxBuilder.buildIntrinsic")(function* (
  tag: string,
  input: NormalizedJsxInput,
) {
  return Element.Intrinsic({
    tag,
    props: input.elementProps,
    children: input.childElements,
    key: input.resolvedKey,
  });
});

const buildComponent = Effect.fn("JsxBuilder.buildComponent")(function* (
  type: Component.Component.Type<unknown>,
  input: NormalizedJsxInput,
) {
  const element = type(input.props);
  return input.resolvedKey === null ? element : keyed(input.resolvedKey, element);
});

export const buildJsx: (
  type: unknown,
  props: unknown,
  key?: ElementKey,
) => Effect.Effect<RuntimeElement> = Effect.fn("JsxBuilder.build")(function* (
  type: unknown,
  props: unknown,
  key?: ElementKey,
) {
  const input = yield* normalizeInput(props, key);

  return yield* Match.value(type).pipe(
    Match.when(
      (value: unknown): value is string => typeof value === "string",
      (tag) => buildIntrinsic(tag, input),
    ),
    Match.when(Effect.isEffect, (effectValue) =>
      Effect.succeed(invalidComponentElement("effect", effectValue.constructor?.name, input.resolvedKey)),
    ),
    Match.when(Component.isEffectComponent, (component) => buildComponent(component, input)),
    Match.orElse((value: unknown) =>
      Effect.succeed(
        invalidComponentElement(
          typeof value === "function" ? "plain-function" : "unknown",
          typeof value === "function" ? value.name : undefined,
          input.resolvedKey,
        ),
      ),
    ),
  );
});
