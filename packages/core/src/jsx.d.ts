/**
 * @since 1.0.0
 * JSX Type Definitions for trygg
 *
 * This module provides TypeScript type definitions for JSX elements.
 */
import type {
  ElementKey,
  IntrinsicElements as CoreIntrinsicElements,
} from "./primitives/element.js";

export namespace JSX {
  /**
   * The type returned by JSX expressions
   */
  export type Element = import("./primitives/element.js").Element;

  /**
   * Props that can be passed to intrinsic elements
   */
  export interface IntrinsicAttributes {
    readonly key?: ElementKey;
  }

  /**
   * Intrinsic elements - maps tag names to their prop types
   */
  export interface IntrinsicElements extends CoreIntrinsicElements {}

  /**
   * Element children type
   */
  export type ElementChildrenAttribute = {
    children: {};
  };
}

// Re-export JSX namespace for use with jsxImportSource
export { JSX };

declare global {
  namespace JSX {
    type Element = import("./primitives/element.js").Element;

    interface IntrinsicAttributes {
      readonly key?: import("./primitives/element.js").ElementKey;
    }

    interface IntrinsicElements extends CoreIntrinsicElements {}

    interface ElementChildrenAttribute {
      children: {};
    }
  }
}
