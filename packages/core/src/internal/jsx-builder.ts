import { Data, Effect, Match } from "effect";

import * as Component from "../primitives/component.js";
import {
  Element,
  keyed,
  type ElementKey,
} from "../primitives/element.js";
import type { Element as RuntimeElement } from "../primitives/element.js";
import { unsafeAsElementProps } from "./unsafe.js";

type RuntimeProps = Record<string, unknown>;

export class InvalidJsxComponentInput extends Data.TaggedError("InvalidJsxComponentInput")<{
  readonly reason: "plain-function" | "effect" | "unknown";
  readonly displayName?: string | undefined;
  readonly key: ElementKey | null;
}> {}

interface NormalizedJsxInput {
  readonly props: RuntimeProps;
  readonly childElements: ReadonlyArray<RuntimeElement>;
  readonly elementProps: import("../primitives/element.js").ElementProps;
  readonly resolvedKey: ElementKey | null;
}

const isElementKey = (value: unknown): value is ElementKey =>
  typeof value === "string" || typeof value === "number";

const isRecord = (value: unknown): value is RuntimeProps => typeof value === "object" && value !== null;

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
    childElements: yield* Element.fromChildren(children),
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
) => Effect.Effect<RuntimeElement, InvalidJsxComponentInput> = Effect.fn("JsxBuilder.build")(function* (
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
      Effect.fail(
        new InvalidJsxComponentInput({
          reason: "effect",
          displayName: effectValue.constructor?.name,
          key: input.resolvedKey,
        }),
      ),
    ),
    Match.when(Component.isEffectComponent, (component) => buildComponent(component, input)),
    Match.orElse((value: unknown) =>
      Effect.fail(
        new InvalidJsxComponentInput({
          reason: typeof value === "function" ? "plain-function" : "unknown",
          displayName: typeof value === "function" ? value.name : undefined,
          key: input.resolvedKey,
        }),
      ),
    ),
  );
});
