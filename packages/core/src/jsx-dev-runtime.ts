/**
 * @since 1.0.0
 * JSX Development Runtime for trygg
 *
 * This module is used in development mode and provides additional debugging
 * information for better error messages and stack traces.
 */
import { jsx, Fragment, Element, type JSXElementType, type ElementKey } from "./jsx-runtime.js";
import type { ComponentElementWithRequirements } from "./primitives/element.js";
import type { Component as ComponentType } from "./primitives/component.js";

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
 * @since 1.0.0
 */
type ElementFor<Type> =
  Type extends ComponentType.Type<any, any, infer R>
    ? ComponentElementWithRequirements<R>
    : Element;

export const jsxDEV = <Props extends Record<string, unknown>, Type extends JSXElementType<Props>>(
  type: Type,
  props: Props | null,
  key?: ElementKey,
  _isStaticChildren?: boolean,
  _source?: JSXSource,
  _self?: unknown,
): ElementFor<Type> => {
  // For now, just delegate to the production jsx
  // In the future, we could store source info for better error messages
  return jsx(type, props, key) as ElementFor<Type>;
};

// Also export jsxs for dev mode (same as jsxDEV)
export const jsxsDEV: typeof jsxDEV = jsxDEV;
