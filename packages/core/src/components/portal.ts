/**
 * @since 1.0.0
 * Portal component for rendering children into a different DOM container
 *
 * Portals allow rendering content into a DOM node that exists outside
 * the hierarchy of the parent component. Useful for modals, tooltips,
 * and overlays.
 */
import { portal as portalElement, type Element, normalizeChildren } from "../element.js";

/**
 * Props for the Portal component
 * @since 1.0.0
 */
export interface PortalProps {
  /**
   * Target container - either an HTMLElement or a CSS selector string.
   * If a string, will be resolved via document.querySelector at render time.
   */
  readonly target: HTMLElement | string;
  /**
   * Children to render into the portal target.
   * Accepts any valid JSX children (Elements, strings, numbers, arrays, etc.)
   */
  readonly children?: unknown;
}

/**
 * Portal component
 *
 * Renders children into a DOM node that exists outside the parent's
 * DOM hierarchy. The children maintain their position in the virtual
 * DOM tree (for context, event bubbling, etc.) but render into the
 * specified target container.
 *
 * @example Using a CSS selector
 * ```tsx
 * const Modal = Effect.gen(function* () {
 *   return Portal({
 *     target: "#modal-root",
 *     children: [
 *       <div className="modal">
 *         <h2>Modal Title</h2>
 *         <p>Modal content</p>
 *       </div>
 *     ]
 *   })
 * })
 * ```
 *
 * @example Using an HTMLElement
 * ```tsx
 * const tooltip = Portal({
 *   target: document.body,
 *   children: [<div className="tooltip">Tooltip text</div>]
 * })
 * ```
 *
 * @since 1.0.0
 */
export const Portal = (props: PortalProps): Element => {
  const { target, children } = props;

  return portalElement(target, normalizeChildren(children));
};
