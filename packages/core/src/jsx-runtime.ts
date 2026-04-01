/**
 * Automatic JSX runtime for trygg.
 *
 * @remarks
 * Owner module for the `jsx-runtime` topic. TypeScript and Babel target this
 * entrypoint when `jsxImportSource` points at `trygg` and the automatic runtime
 * is enabled.
 *
 * @see ./jsx-runtime.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/jsx-runtime
 */
import { Effect } from "effect";
import {
  Element,
  componentElement,
  type ElementProps,
  type ElementKey,
  normalizeChildren,
  empty,
  type ComponentElementWithRequirements,
} from "./primitives/element.js";
import * as Component from "./primitives/component.js";
import type { Component as ComponentType, ComponentProps } from "./primitives/component.js";
import { buildJsx, InvalidJsxComponentInput } from "./internal/jsx-builder.js";
import { unsafeAsElementFor } from "./internal/unsafe.js";

/**
 * Props passed to JSX elements
 *
 * @remarks
 * `JSXProps` extends intrinsic element props with the optional `key` field that
 * the runtime consumes during JSX lowering.
 *
 * @example
 * ```ts
 * const props: JSXProps = { key: "row-1", id: "row" }
 * ```
 *
 * @category JSX Runtime
 * @public
 * @since 1.0.0
 */
export interface JSXProps extends ElementProps {
  readonly key?: ElementKey;
}

/**
 * Valid JSX element type - either an intrinsic string or a Component.Type
 *
 * @remarks
 * This type describes the `type` argument TypeScript passes into `jsx` and
 * `jsxs` after lowering JSX syntax.
 *
 * @example
 * ```ts
 * const type: JSXElementType = "div"
 * ```
 *
 * @category JSX Runtime
 * @public
 * @since 1.0.0
 */
export type JSXElementType<Props = Record<string, unknown>, E = never, R = unknown> =
  | string
  | ComponentType.Type<Props, E, R>;

type ElementFor<Type> =
  Type extends ComponentType.Type<any, any, infer R>
    ? ComponentElementWithRequirements<R>
    : Element;

const recoverInvalidJsxComponentInput = (error: InvalidJsxComponentInput) =>
  Effect.succeed(
    componentElement(
      () =>
        Effect.fail(
          new Component.InvalidComponentError({
            reason: error.reason,
            displayName: error.displayName,
          }),
        ),
      error.key,
    ),
  );

const runJsx = <Props extends Record<string, unknown>, Type extends JSXElementType<Props>>(
  type: Type,
  props: Props | null,
  key?: ElementKey,
): ElementFor<Type> =>
  unsafeAsElementFor<Type>(
    Effect.runSync(
      buildJsx(type, props, key).pipe(
        Effect.catchTag("InvalidJsxComponentInput", recoverInvalidJsxComponentInput),
      ),
    ),
  );

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
 * @remarks
 * `jsx` is the single-child lowering target for the automatic JSX runtime. Most
 * users do not call it directly; the compiler emits calls during transpilation.
 *
 * @example
 * ```ts
 * const element = jsx("div", { id: "root" })
 * ```
 *
 * @category JSX Runtime
 * @public
 * @since 1.0.0
 */
export const jsx = <Props extends Record<string, unknown>, Type extends JSXElementType<Props>>(
  type: Type,
  props: Props | null,
  key?: ElementKey,
): ElementFor<Type> => runJsx(type, props, key);

/**
 * Create a JSX element with static children
 *
 * This is called by the TypeScript compiler for JSX expressions with
 * multiple static children.
 *
 * @remarks
 * `jsxs` is the multiple-children companion to `jsx`. The compiler chooses it
 * when a JSX expression has a static array of children.
 *
 * @example
 * ```ts
 * const element = jsxs("div", { children: ["a", "b"] })
 * ```
 *
 * @category JSX Runtime
 * @public
 * @since 1.0.0
 */
export const jsxs: typeof jsx = runJsx;

/**
 * Fragment component
 *
 * Used for grouping elements without adding extra DOM nodes.
 *
 * @remarks
 * `Fragment` groups children without introducing an extra DOM node.
 *
 * @example
 * ```tsx
 * const view = <Fragment><span>A</span><span>B</span></Fragment>
 * ```
 *
 * @category JSX Runtime
 * @public
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
