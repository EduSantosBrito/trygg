/**
 * @since 1.0.0
 * JSX Runtime for trygg
 *
 * This module provides the JSX transformation functions used by TypeScript/Babel
 * when compiling JSX syntax. It implements the "automatic" JSX runtime.
 */
import { Effect } from "effect";
import {
  Element,
  type ElementProps,
  type ElementKey,
  normalizeChildren,
  componentElement,
  empty,
  keyed,
  type ComponentElementWithRequirements,
} from "./primitives/element.js";
import * as Component from "./primitives/component.js";
import type { Component as ComponentType, ComponentProps } from "./primitives/component.js";
import { unsafeAsElementFor, unsafeAsElementProps } from "./internal/unsafe.js";

/**
 * Props passed to JSX elements
 * @since 1.0.0
 */
export interface JSXProps extends ElementProps {
  readonly key?: ElementKey;
}

/**
 * Valid JSX element type - either an intrinsic string or a Component.Type
 * @since 1.0.0
 */
export type JSXElementType<Props = Record<string, unknown>, E = never, R = unknown> =
  | string
  | ComponentType.Type<Props, E, R>;

type ElementFor<Type> =
  Type extends ComponentType.Type<any, any, infer R>
    ? ComponentElementWithRequirements<R>
    : Element;

/**
 * Check if a value is an Effect
 * @internal
 */
const isEffect = (value: unknown): value is Effect.Effect<Element, unknown, unknown> =>
  typeof value === "object" && value !== null && Effect.EffectTypeId in value;

/**
 * Check if a value is a valid ElementKey
 * @internal
 */
const isElementKey = (value: unknown): value is ElementKey =>
  typeof value === "string" || typeof value === "number";

/**
 * Create a JSX element
 *
 * This is called by the TypeScript compiler for JSX expressions.
 * Supports two types:
 * - String: intrinsic elements like `<div>`, `<span>`
 * - Component.Type: Effect components created with `Component.gen`
 *
 * Invalid component types (plain functions or direct Effects) fail with
 * InvalidComponentError via Effect.fail when rendered.
 *
 * @since 1.0.0
 */
export const jsx = <Props extends Record<string, unknown>, Type extends JSXElementType<Props>>(
  type: Type,
  props: Props | null,
  key?: ElementKey,
): ElementFor<Type> => {
  const resolvedProps = props ?? {};
  const children = "children" in resolvedProps ? resolvedProps.children : undefined;
  const propsKeyRaw = "key" in resolvedProps ? resolvedProps.key : undefined;
  const propsKey = isElementKey(propsKeyRaw) ? propsKeyRaw : undefined;
  const resolvedKey = key ?? propsKey ?? null;
  const childElements = normalizeChildren(children);

  // Build element props by excluding children and key
  const elementPropsMutable: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(resolvedProps)) {
    if (k !== "children" && k !== "key") {
      elementPropsMutable[k] = v;
    }
  }
  const elementProps = unsafeAsElementProps(elementPropsMutable);

  if (typeof type === "string") {
    // Intrinsic element: <div>, <span>, etc.
    const intrinsic = Element.Intrinsic({
      tag: type,
      props: elementProps,
      children: childElements,
      key: resolvedKey,
    });
    return unsafeAsElementFor<Type>(intrinsic);
  }

  // Check if it's an Effect being passed directly (invalid - not allowed)
  if (isEffect(type)) {
    const errorElement = componentElement(
      () =>
        Effect.fail(
          new Component.InvalidComponentError({
            reason: "effect",
            displayName: type.constructor?.name,
          }),
        ),
      resolvedKey,
    );
    return unsafeAsElementFor<Type>(errorElement);
  }

  if (!Component.isEffectComponent(type)) {
    const errorElement = componentElement(
      () =>
        Effect.fail(
          new Component.InvalidComponentError({
            reason: typeof type === "function" ? "plain-function" : "unknown",
            displayName: typeof type === "function" ? type.name : undefined,
          }),
        ),
      resolvedKey,
    );
    return unsafeAsElementFor<Type>(errorElement);
  }

  const element = type(resolvedProps);
  return unsafeAsElementFor<Type>(resolvedKey !== null ? keyed(resolvedKey, element) : element);
};

/**
 * Create a JSX element with static children
 *
 * This is called by the TypeScript compiler for JSX expressions with
 * multiple static children.
 *
 * @since 1.0.0
 */
export const jsxs: typeof jsx = jsx;

/**
 * Fragment component
 *
 * Used for grouping elements without adding extra DOM nodes.
 *
 * @since 1.0.0
 */
export const Fragment = Component.gen(function* (Props: ComponentProps<{ children?: unknown }>) {
  const { children } = yield* Props;
  const normalized = normalizeChildren(children);
  if (normalized.length === 0) {
    return empty;
  }
  return Element.Fragment({ children: normalized });
});

// Re-export Element type for use in JSX
export { Element };
export type { ElementProps, ElementKey };

// Re-export error type
export { InvalidComponentError } from "./primitives/component.js";

// JSX namespace for TypeScript - required for jsxImportSource
export namespace JSX {
  export type Element = import("./primitives/element.js").ElementWithRequirements<unknown>;

  export interface IntrinsicAttributes {
    readonly key?: ElementKey;
  }

  export interface IntrinsicElements {
    [elemName: string]: ElementProps;
  }

  export interface ElementChildrenAttribute {
    children: {};
  }
}
