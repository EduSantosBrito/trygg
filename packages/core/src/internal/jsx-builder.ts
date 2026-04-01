import { Data, Effect, Exit, Match } from "effect";

import * as Component from "../primitives/component.js";
import { Element, keyed, type ElementKey } from "../primitives/element.js";
import type { Element as ElementType } from "../primitives/element.js";
import { unsafeAsElementProps } from "./unsafe.js";

type RuntimeProps = Record<string, unknown>;

export class InvalidJsxComponentInput extends Data.TaggedError("InvalidJsxComponentInput")<{
  readonly reason: "plain-function" | "effect" | "unknown";
  readonly displayName?: string | undefined;
  readonly key: ElementKey | null;
}> {}

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

const collectProps = Effect.fn("JsxBuilder.collectProps")(function* (props: RuntimeProps) {
  const keysExit = yield* Effect.exit(Effect.sync(() => Object.keys(props)));
  if (Exit.isFailure(keysExit)) {
    return {} satisfies RuntimeProps;
  }

  const entries = yield* Effect.forEach(keysExit.value, (property) =>
    Effect.gen(function* () {
      const valueExit = yield* Effect.exit(Effect.sync(() => Reflect.get(props, property)));
      return Exit.isSuccess(valueExit) ? ([[property, valueExit.value]] as const) : [];
    }),
  );

  return Object.fromEntries(entries.flat());
});

const normalizeInput: (props: unknown, key?: ElementKey) => Effect.Effect<NormalizedJsxInput> =
  Effect.fn("JsxBuilder.normalizeInput")(function* (props: unknown, key?: ElementKey) {
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

const build: (
  type: unknown,
  props: unknown,
  key?: ElementKey,
) => Effect.Effect<ElementType, InvalidJsxComponentInput> = Effect.fn("JsxBuilder.build")(
  function* (type: unknown, props: unknown, key?: ElementKey) {
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
  },
);

export const JsxBuilder = {
  build,
  normalizeInput,
};
