/**
 * @since 1.0.0
 * JSX Development Runtime for trygg
 *
 * This module is used in development mode and provides additional debugging
 * information for better error messages and stack traces.
 */
import {
  jsx,
  Fragment,
  Element,
  type JSXProps,
  type JSXElementType,
  type ElementKey,
} from "./jsx-runtime.js";

export { jsx, Fragment, Element };
export type {
  JSXProps,
  ComponentFunction,
  JSXElementType,
  ElementProps,
  ElementKey,
} from "./jsx-runtime.js";

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
export const jsxDEV = <Props extends JSXProps>(
  type: JSXElementType<Props>,
  props: Props | null,
  key?: ElementKey,
  _isStaticChildren?: boolean,
  _source?: JSXSource,
  _self?: unknown,
): Element => {
  // For now, just delegate to the production jsx
  // In the future, we could store source info for better error messages
  return jsx(type, props, key);
};

// Also export jsxs for dev mode (same as jsxDEV)
export const jsxsDEV = jsxDEV;
