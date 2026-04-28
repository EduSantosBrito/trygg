/**
 * Development JSX runtime for trygg.
 *
 * @remarks
 * Owner module for the `jsx-dev-runtime` topic. Tooling targets this entrypoint
 * in development builds so the compiler can pass source-location metadata.
 *
 * @see ./jsx-dev-runtime.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/jsx-dev-runtime
 */
import { jsx, Fragment, Element, type JSXElementType, type ElementKey } from "./jsx-runtime.js";
import * as Component from "./primitives/component.js";
import type { Component as ComponentType } from "./primitives/component.js";
import type { ComponentElementWithRequirements } from "./primitives/element.js";

export { jsx, Fragment, Element };
export type { JSXProps, JSXElementType, ElementProps, ElementKey } from "./jsx-runtime.js";

/**
 * Source location info passed by the compiler in development mode
 */
interface JSXSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * Development JSX function with source info
 *
 * In dev mode, the compiler passes extra arguments for debugging:
 * - isStaticChildren: boolean indicating if children are static
 * - source: file/line/column info
 * - self: the `this` context (usually undefined)
 *
 * @remarks
 * `jsxDEV` mirrors `jsx` but accepts the extra development-only arguments that
 * modern JSX compilers provide for debugging.
 *
 * @example
 * ```ts
 * const element = jsxDEV("div", { id: "root" }, undefined, false)
 * ```
 *
 * @category JSX Development
 * @public
 * @since 1.0.0
 */
export function jsxDEV(
  type: string,
  props: Record<string, unknown> | null,
  key?: ElementKey,
  _isStaticChildren?: boolean,
  _source?: JSXSource,
  _self?: unknown,
): Element;
export function jsxDEV<Props extends Record<string, unknown>, E, R>(
  type: ComponentType.Type<Props, E, R>,
  props: Props | null,
  key?: ElementKey,
  _isStaticChildren?: boolean,
  _source?: JSXSource,
  _self?: unknown,
): ComponentElementWithRequirements<R>;
export function jsxDEV(
  type: JSXElementType,
  props: Record<string, unknown> | null,
  key?: ElementKey,
  _isStaticChildren?: boolean,
  _source?: JSXSource,
  _self?: unknown,
): Element {
  // For now, just delegate to the production jsx
  // In the future, we could store source info for better error messages
  if (typeof type === "string") {
    return jsx(type, props, key);
  }
  if (Component.isEffectComponent(type)) {
    return jsx(type, props, key);
  }
  return jsx(type, props, key);
}

/**
 * Development JSX helper for static child arrays.
 *
 * @remarks
 * `jsxsDEV` is the development-mode companion used when the compiler lowers JSX
 * with multiple static children.
 *
 * @example
 * ```ts
 * const element = jsxsDEV("div", { children: ["a", "b"] }, undefined, true)
 * ```
 *
 * @category JSX Development
 * @public
 * @since 1.0.0
 */
export const jsxsDEV: typeof jsxDEV = jsxDEV;
