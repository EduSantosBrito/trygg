/**
 * DOM rendering and mount entrypoints for trygg.
 *
 * @remarks
 * Owner module for the `Renderer` topic. This module owns the renderer service,
 * browser layer, and the root mount helpers that turn `Element` trees into live
 * DOM.
 *
 * @see ./renderer.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/primitives/renderer
 */
import { Cause, Data, Effect, Exit, Layer, Match, Option, Scope } from "effect";
import * as Context from "effect/Context";
import { Element, isElement, type ElementProps } from "./element.js";
import * as Signal from "./signal.js";
import * as Debug from "../debug/debug.js";
import { setFiberRef } from "../internal/fiber-ref.js";
import { unsafeEraseR, unsafeWidenContext } from "../internal/unsafe.js";
import * as SafeUrl from "../security/safe-url.js";
import { ResourceRegistryLive } from "./resource.js";
import * as Head from "./head.js";
import { browser as platformBrowser } from "../platform/browser.js";
import type { RoutesManifest } from "../router/index.js";
import {
  applyPropValue,
  logBlockedSafeUrlAttribute,
  resolveReconcileTarget,
} from "./render-utils.js";
import { renderIntrinsic } from "./render-intrinsic.js";
import { renderComponent } from "./render-component.js";
import { renderKeyedList } from "./render-keyed-list.js";

export { ComponentAnchorError } from "./render-component.js";

const emptyContext = unsafeWidenContext(Context.empty());

const provideRenderContext = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  _renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): Effect.Effect<A, E, unknown> => (context === null ? effect : Effect.provide(effect, context));

/**
 * Error thrown when a Portal target cannot be found
 * @since 1.0.0
 */
export class PortalTargetNotFoundError extends Data.TaggedError("PortalTargetNotFoundError")<{
  readonly target: HTMLElement | string;
}> {
  override get message() {
    return `Portal target not found: ${this.target}`;
  }
}

export class InvalidEventHandlerError extends Data.TaggedError("InvalidEventHandlerError")<{
  readonly prop: string;
}> {
  override get message() {
    return `Invalid event handler for ${this.prop}: expected function returning Effect`;
  }
}

/**
 * Render context passed through the rendering tree.
 *
 * @remarks
 * `RenderContext` carries the active service map and scope that renderer-owned
 * work must preserve across event handlers and nested renders.
 *
 * @example
 * ```ts
 * const context: RenderContext = { services, scope }
 * ```
 *
 * @category Rendering
 * @public
 * @since 1.0.0
 */
export interface RenderContext {
  readonly services: Context.Context<unknown>;
  readonly scope: Scope.Scope;
  readonly safeUrlConfig: SafeUrl.SafeUrlConfigService;
}

const mergeRenderServices = (
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): Context.Context<unknown> =>
  context === null ? renderContext.services : Context.merge(context, renderContext.services);

const runForkInRenderContext = <A, E>(
  effect: Effect.Effect<A, E, unknown>,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): void => {
  Effect.runForkWith(mergeRenderServices(renderContext, context))(
    effect.pipe(Scope.provide(renderContext.scope)),
  );
};

/**
 * FiberRef to track the current render context.
 *
 * @remarks
 * Renderer internals use `CurrentRenderContext` to read the ambient render
 * scope when wiring event handlers and reactive updates.
 *
 * @internal
 * @since 1.0.0
 */
export const CurrentRenderContext = Context.Reference<RenderContext | null>(
  "trygg/Renderer/CurrentRenderContext",
  {
    defaultValue: () => null,
  },
);

/**
 * Result of rendering an element - contains the DOM node and cleanup effect.
 *
 * @remarks
 * `RenderResult` is the low-level renderer return shape used by mounting and
 * document-render helpers.
 *
 * @example
 * ```ts
 * const result: RenderResult = { node, cleanup: Effect.void }
 * ```
 *
 * @category Rendering
 * @public
 * @since 1.0.0
 */
export interface RenderResult {
  readonly node: Node;
  readonly cleanup: Effect.Effect<void, unknown, unknown>;
  readonly reconcile?: (
    nextElement: Element,
    nextContext: Context.Context<unknown> | null,
  ) => Effect.Effect<boolean, unknown, unknown>;
}

const normalizeContext = (context: Context.Context<unknown> | null): Context.Context<unknown> =>
  context ?? emptyContext;

/**
 * Error boundary handler type.
 * Called when a component or signal element encounters an error during re-render.
 * @since 1.0.0
 */
export type ErrorBoundaryHandler = (cause: Cause.Cause<unknown>) => void;

/**
 * Render options passed through the element tree.
 * @internal
 */
interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

/** Default render options with no error handler */
const defaultRenderOptions: RenderOptions = { errorHandler: null };

/**
 * Renderer service interface
 *
 * @remarks
 * `RendererService` is the low-level contract implemented by `browserLayer` and
 * consumed by helpers like `render`, `mount`, and `mountDocument`.
 *
 * @example
 * ```ts
 * const service: RendererService = yield* Renderer
 * ```
 *
 * @category Rendering
 * @public
 * @since 1.0.0
 */
export interface RendererService {
  /**
   * Mount an Element tree to a DOM container
   */
  readonly mount: (
    container: HTMLElement,
    element: Element,
  ) => Effect.Effect<void, unknown, Scope.Scope>;

  /**
   * Render an Element to a DOM node
   */
  readonly render: (
    element: Element,
    parent: Node,
  ) => Effect.Effect<RenderResult, unknown, Scope.Scope>;
}

/**
 * Renderer service tag
 *
 * @remarks
 * Yield `Renderer` inside Effects when you need direct access to the active
 * renderer implementation instead of the convenience mount helpers.
 *
 * @example
 * ```ts
 * const renderer = yield* Renderer
 * ```
 *
 * @category Rendering
 * @public
 * @since 1.0.0
 */
export class Renderer extends Context.Service<Renderer, RendererService>()("@trygg/Renderer") {}

/**
 * Render a document-level element (html, head, body).
 * Maps to existing DOM nodes instead of creating new ones.
 * Only called when IsDocumentMount FiberRef is true.
 * @internal
 */
const renderDocumentElement = (
  tag: string,
  props: ElementProps,
  children: ReadonlyArray<Element>,
  _parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
): Effect.Effect<RenderResult, unknown, unknown> =>
  Effect.gen(function* () {
    // Determine which existing DOM node to map to
    const targetNode =
      tag === "html" ? document.documentElement : tag === "head" ? document.head : document.body;

    // For <head>, children are rendered but hoisted by the Head service.
    // For <html> and <body>, attributes are applied and children are rendered into the target.
    const renderTarget = tag === "head" ? document.head : targetNode;

    yield* Debug.log({
      event: "render.document",
      element_tag: tag,
      target: targetNode.tagName,
    });

    // Strip framework-specific 'mode' prop before applying
    const { mode: _mode, ...domProps } = props;

    // Apply attributes to the existing node (skip for <head> — no meaningful attrs)
    const appliedAttrs: Array<{ key: string; prev: string | null }> = [];
    const signalCleanups: Array<Effect.Effect<void>> = [];
    if (tag !== "head") {
      for (const key of Object.keys(domProps)) {
        if (key === "children" || key === "key") continue;
        const value = (domProps as Record<string, unknown>)[key];
        const attrName = key === "className" ? "class" : key === "htmlFor" ? "for" : key;
        if (Signal.isSignal(value)) {
          // Signal-valued attribute: fine-grained reactivity on document elements
          const prev = targetNode.getAttribute(attrName);
          const initialValue = yield* Signal.get(value);
          const blocked = applyPropValue(
            targetNode,
            key,
            initialValue,
            renderContext.safeUrlConfig,
          );
          if (Option.isSome(blocked)) {
            yield* logBlockedSafeUrlAttribute(blocked.value);
          }
          appliedAttrs.push({ key: attrName, prev });

          yield* Debug.log({
            event: "render.document.signal.initial",
            signal_id: value._debugId,
            value: initialValue,
            element_tag: tag,
            trigger: `prop:${key}`,
          });

          const unsubscribe = yield* Signal.subscribe(value, () =>
            Effect.gen(function* () {
              const newValue = yield* Signal.get(value);
              yield* Debug.log({
                event: "render.document.signal.update",
                signal_id: value._debugId,
                value: newValue,
                element_tag: tag,
                trigger: `prop:${key}`,
              });
              const blocked = applyPropValue(
                targetNode,
                key,
                newValue,
                renderContext.safeUrlConfig,
              );
              if (Option.isSome(blocked)) {
                yield* logBlockedSafeUrlAttribute(blocked.value);
              }
            }),
          );
          signalCleanups.push(unsubscribe);
        } else if (typeof value === "string") {
          const prev = targetNode.getAttribute(attrName);
          targetNode.setAttribute(attrName, value);
          appliedAttrs.push({ key: attrName, prev });
        }
      }
    }

    // Render children into the target node
    const childResults: Array<RenderResult> = [];
    for (const child of children) {
      const result = yield* renderElement(child, renderTarget, renderContext, context, options);
      childResults.push(result);
    }

    // Anchor comment for positioning (appended to the target)
    const anchor = document.createComment(`doc:${tag}`);
    renderTarget.appendChild(anchor);

    return {
      node: anchor,
      cleanup: Effect.gen(function* () {
        for (const cleanup of signalCleanups) {
          yield* cleanup;
        }
        for (const child of childResults) {
          yield* child.cleanup;
        }
        // Revert applied attributes
        for (const { key, prev } of appliedAttrs) {
          if (prev !== null) {
            targetNode.setAttribute(key, prev);
          } else {
            targetNode.removeAttribute(key);
          }
        }
        anchor.remove();
      }),
    };
  });

/**
 * Render an Element to a DOM node
 * @internal
 */
const renderElement = (
  element: Element,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions = defaultRenderOptions,
): Effect.Effect<RenderResult, unknown, unknown> =>
  Match.value(element).pipe(
    Match.tag("Text", ({ content }) =>
      Effect.sync(() => {
        const node = document.createTextNode(content);
        parent.appendChild(node);
        let currentContent = content;
        return {
          node,
          cleanup: Effect.sync(() => node.remove()),
          reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
            Effect.sync(() => {
              const resolved = resolveReconcileTarget(nextElement, nextContext);
              if (resolved.element._tag !== "Text") {
                return false;
              }

              if (resolved.element.content !== currentContent) {
                currentContent = resolved.element.content;
                node.textContent = currentContent;
              }

              return true;
            }),
        };
      }),
    ),

    Match.tag("SignalText", ({ signal }) =>
      Effect.gen(function* () {
        // Get initial value and create text node
        const initialValue = yield* Signal.get(signal);
        const node = document.createTextNode(String(initialValue));
        parent.appendChild(node);
        let currentSignal = signal;

        yield* Debug.log({
          event: "render.signaltext.initial",
          signal_id: signal._debugId,
          value: initialValue,
        });

        // Subscribe to signal changes for fine-grained updates
        // Listener returns Effect which is run inside notifyListeners
        const unsubscribe = yield* Signal.subscribe(signal, () =>
          Effect.gen(function* () {
            const value = yield* Signal.get(signal);
            yield* Debug.log({
              event: "render.signaltext.update",
              signal_id: signal._debugId,
              value: value,
            });
            node.textContent = String(value);
          }),
        );

        return {
          node,
          cleanup: Effect.gen(function* () {
            yield* unsubscribe;
            node.remove();
          }),
          reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
            Effect.sync(() => {
              const resolved = resolveReconcileTarget(nextElement, nextContext);
              if (resolved.element._tag !== "SignalText") {
                return false;
              }

              return resolved.element.signal === currentSignal;
            }),
        };
      }),
    ),

    Match.tag("SignalElement", ({ signal, onSwap }) =>
      Effect.gen(function* () {
        // Create anchor comment for positioning
        const anchor = document.createComment("signal-element");
        parent.appendChild(anchor);

        // State to track current rendered content
        let currentResult: RenderResult | null = null;
        let currentScope: Scope.Closeable | null = null;
        let isUnmounted = false;
        let swapVersion = 0; // Discard stale renders when multiple swaps race

        // Helper to render Element or convert primitive to Text
        const renderValue = (value: unknown): Element =>
          isElement(value) ? value : Element.Text({ content: String(value) });

        const cleanupCurrent: Effect.Effect<void, unknown, unknown> = Effect.gen(function* () {
          if (currentResult !== null) {
            yield* currentResult.cleanup;
            currentResult = null;
          }
          if (currentScope !== null) {
            const scope = currentScope;
            currentScope = null;
            yield* Scope.close(scope, Exit.void);
          }
        });

        const renderWithScope: (
          value: unknown,
        ) => Effect.Effect<{ result: RenderResult; scope: Scope.Closeable }, unknown, unknown> =
          Effect.fnUntraced(function* (value: unknown) {
            const scope = yield* Scope.fork(yield* Effect.scope);
            const element = renderValue(value);
            const result = yield* renderElement(
              element,
              parent,
              renderContext,
              context,
              options,
            ).pipe(
              Scope.provide(scope),
              Effect.onError(() => Scope.close(scope, Exit.void)),
            );
            return { result, scope };
          });

        // Render initial value
        const initialValue = yield* Signal.get(signal);
        const initialRender = yield* renderWithScope(initialValue);
        currentResult = initialRender.result;
        currentScope = initialRender.scope;
        // Move rendered content before anchor
        parent.insertBefore(currentResult.node, anchor);

        yield* Debug.log({
          event: "render.signalelement.initial",
          signal_id: signal._debugId,
        });

        // Subscribe to signal changes
        // Use sync Effect that forks scoped work (same pattern as Component re-render)
        const unsubscribe = yield* Signal.subscribe(signal, () =>
          Effect.sync(() => {
            if (isUnmounted) return;

            // Increment version to invalidate any in-flight renders
            const myVersion = ++swapVersion;

            runForkInRenderContext(
              Effect.gen(function* () {
                const newValue = yield* Signal.get(signal);

                // Render into a temporary off-DOM fragment to prevent
                // content from becoming visible before version check
                const tempFragment = document.createDocumentFragment();
                const scope = yield* Scope.fork(yield* Effect.scope);
                const element = renderValue(newValue);
                const result = yield* renderElement(
                  element,
                  tempFragment,
                  renderContext,
                  context,
                  options,
                ).pipe(
                  Scope.provide(scope),
                  Effect.onError(() => Scope.close(scope, Exit.void)),
                );

                // Discard if a newer swap started while we were rendering
                if (myVersion !== swapVersion) {
                  yield* result.cleanup;
                  yield* Scope.close(scope, Exit.void);
                  return;
                }

                // Cleanup old content + scope AFTER successful render
                yield* cleanupCurrent;

                currentResult = result;
                currentScope = scope;
                // insertBefore(fragment, ref) moves ALL fragment children
                // before ref in one atomic DOM operation
                const actualParent = anchor.parentNode;
                if (actualParent !== null) {
                  actualParent.insertBefore(tempFragment, anchor);
                }

                // Notify post-swap listeners (e.g. router scroll synchronization)
                if (onSwap !== undefined) {
                  yield* onSwap;
                }

                yield* Debug.log({
                  event: "render.signalelement.swap",
                  signal_id: signal._debugId,
                });
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* () {
                    yield* Debug.log({
                      event: "render.signalelement.swap",
                      trigger: "error",
                      signal_id: signal._debugId,
                      reason: String(cause),
                    });

                    // Check for parent error boundary handler
                    if (options.errorHandler !== null) {
                      // Propagate error to error boundary
                      options.errorHandler(cause);
                    }
                    // Keep old content if no error boundary
                  }),
                ),
              ),
              renderContext,
              context,
            );
          }),
        );

        return {
          node: anchor,
          cleanup: Effect.gen(function* () {
            isUnmounted = true;
            yield* unsubscribe;
            yield* cleanupCurrent;
            anchor.remove();
          }),
        };
      }),
    ),

    Match.tag("Provide", ({ context: providedContext, child }) =>
      Effect.gen(function* () {
        const mergedContext =
          context !== null ? Context.merge(context, providedContext) : providedContext;
        const childResult = yield* renderElement(
          child,
          parent,
          renderContext,
          mergedContext,
          options,
        );

        return {
          get node() {
            return childResult.node;
          },
          cleanup: childResult.cleanup,
          reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
            Effect.gen(function* () {
              if (nextElement._tag !== "Provide" || childResult.reconcile === undefined) {
                return false;
              }

              const nextMergedContext =
                nextContext !== null
                  ? Context.merge(nextContext, nextElement.context)
                  : nextElement.context;

              return yield* childResult.reconcile(nextElement.child, nextMergedContext);
            }),
        } satisfies RenderResult;
      }),
    ),

    Match.tag("Intrinsic", ({ tag, props, children, key }) =>
      renderIntrinsic(tag, props, children, key, parent, renderContext, context, options, {
        renderElement,
        renderDocumentElement,
        runForkInRenderContext,
      }),
    ),

    Match.tag("Component", (component) =>
      renderComponent(component, parent, renderContext, context, options, {
        renderElement,
        provideRenderContext,
        runForkInRenderContext,
        resolveReconcileTarget,
        normalizeContext,
      }),
    ),

    Match.tag("Fragment", ({ children }) =>
      Effect.gen(function* () {
        const fragment = document.createDocumentFragment();
        const childResults: Array<RenderResult> = [];

        for (const child of children) {
          const result = yield* renderElement(child, fragment, renderContext, context, options);
          childResults.push(result);
        }

        parent.appendChild(fragment);

        // Get first child result if available
        const maybeFirstChild = childResults[0];

        if (maybeFirstChild === undefined) {
          // Empty fragment: use a comment as anchor
          const emptyAnchor = document.createComment("fragment");
          parent.appendChild(emptyAnchor);
          return {
            node: emptyAnchor,
            cleanup: Effect.sync(() => emptyAnchor.remove()),
          };
        }

        // Non-empty fragment: use first child's node as anchor
        return {
          node: maybeFirstChild.node,
          cleanup: Effect.gen(function* () {
            for (const child of childResults) {
              yield* child.cleanup;
            }
          }),
        };
      }),
    ),

    Match.tag("Portal", ({ target, children }) =>
      Effect.gen(function* () {
        // Resolve target
        const targetElement = typeof target === "string" ? document.querySelector(target) : target;

        if (!targetElement) {
          return yield* new PortalTargetNotFoundError({ target });
        }

        const normalizedChildren = yield* Element.fromChildren(children);

        // Render children into target
        const childResults: Array<RenderResult> = [];
        for (const child of normalizedChildren) {
          const result = yield* renderElement(
            child,
            targetElement,
            renderContext,
            context,
            options,
          );
          childResults.push(result);
        }

        // Return a comment as anchor in original location
        const portalAnchor = document.createComment("portal");
        parent.appendChild(portalAnchor);

        return {
          node: portalAnchor,
          cleanup: Effect.gen(function* () {
            for (const child of childResults) {
              yield* child.cleanup;
            }
            portalAnchor.remove();
          }),
        };
      }),
    ),

    Match.tag("KeyedList", ({ source, renderFn, keyFn }) =>
      renderKeyedList(source, renderFn, keyFn, parent, renderContext, context, options, {
        provideRenderContext,
        renderElement,
        runForkInRenderContext,
      }),
    ),

    Match.tag("ErrorBoundaryElement", ({ child, fallback, onError }) =>
      Effect.gen(function* () {
        // Create anchor comment for positioning
        const anchor = document.createComment("error-boundary");
        parent.appendChild(anchor);

        // State to track current rendered content
        let currentResult: RenderResult | null = null;
        let currentScope: Scope.Closeable | null = null;
        let isUnmounted = false;
        let hasErrored = false;

        const cleanupRendered = (
          result: RenderResult | null,
          scope: Scope.Closeable | null,
        ): Effect.Effect<void, unknown, unknown> =>
          Effect.gen(function* () {
            if (result !== null) {
              yield* result.cleanup;
            }
            if (scope !== null) {
              yield* Scope.close(scope, Exit.void);
            }
          });

        const cleanupCurrent: Effect.Effect<void, unknown, unknown> = Effect.gen(function* () {
          const result = currentResult;
          const scope = currentScope;
          currentResult = null;
          currentScope = null;
          yield* cleanupRendered(result, scope);
        });

        const insertBeforeAnchor = (node: Node): Effect.Effect<boolean> =>
          Effect.sync(() => {
            const tryInsert = (parentNode: Node | null): boolean => {
              if (parentNode === null) {
                return false;
              }
              try {
                parentNode.insertBefore(node, anchor);
                return true;
              } catch {
                return false;
              }
            };

            const firstParent = anchor.parentNode;
            if (tryInsert(firstParent)) {
              return true;
            }

            const secondParent = anchor.parentNode;
            if (tryInsert(secondParent)) {
              return true;
            }

            return false;
          });

        const mountFallback = (
          fallbackElement: Element,
        ): Effect.Effect<
          { result: RenderResult; scope: Scope.Closeable } | null,
          unknown,
          unknown
        > =>
          Effect.gen(function* () {
            const renderParent = anchor.parentNode;
            if (renderParent === null) {
              return null;
            }

            const fallbackScope = yield* Scope.fork(yield* Effect.scope);
            const fallbackResult = yield* renderElement(
              fallbackElement,
              renderParent,
              renderContext,
              context,
              defaultRenderOptions,
            ).pipe(
              Scope.provide(fallbackScope),
              Effect.onError(() => Scope.close(fallbackScope, Exit.void)),
            );

            const inserted = yield* insertBeforeAnchor(fallbackResult.node);
            if (!inserted) {
              yield* cleanupRendered(fallbackResult, fallbackScope);
              return null;
            }

            return { result: fallbackResult, scope: fallbackScope };
          });

        // Error handler that swaps to fallback
        const errorHandler: ErrorBoundaryHandler = (cause) => {
          if (isUnmounted || hasErrored) return;
          hasErrored = true;

          runForkInRenderContext(
            Effect.gen(function* () {
              yield* Debug.log({
                event: "render.errorboundary.caught",
                reason: String(cause),
              });

              // Call onError callback if provided
              if (onError !== null) {
                yield* Effect.provide(onError(cause), context ?? emptyContext);
              }

              // Compute fallback element
              const fallbackElement = typeof fallback === "function" ? fallback(cause) : fallback;

              // Render + mount fallback before tearing down prior content.
              const mounted = yield* mountFallback(fallbackElement);
              if (mounted === null) {
                return;
              }

              const previousResult = currentResult;
              const previousScope = currentScope;
              currentResult = mounted.result;
              currentScope = mounted.scope;
              yield* cleanupRendered(previousResult, previousScope);

              yield* Debug.log({
                event: "render.errorboundary.fallback",
              });
            }).pipe(
              // Log any errors during fallback rendering
              Effect.tapCause((fallbackCause) =>
                Effect.sync(() => {
                  console.error(
                    "[trygg] ErrorBoundary fallback rendering failed:",
                    Cause.pretty(fallbackCause),
                  );
                }),
              ),
            ),
            renderContext,
            context,
          );
        };

        // Create options with our error handler
        const childOptions: RenderOptions = { errorHandler };

        // Helper to render fallback (for initial render errors)
        // Returns Effect<void, unknown> because fallback rendering could theoretically fail
        const renderFallbackForError = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>) {
          hasErrored = true;

          yield* Debug.log({
            event: "render.errorboundary.caught",
            reason: String(cause),
          });

          // Call onError callback if provided
          if (onError !== null) {
            yield* Effect.provide(onError(cause), context ?? emptyContext);
          }

          // Compute fallback element
          const fallbackElement = typeof fallback === "function" ? fallback(cause) : fallback;

          // Render + mount fallback.
          const mounted = yield* mountFallback(fallbackElement);
          if (mounted === null) {
            return;
          }

          currentResult = mounted.result;
          currentScope = mounted.scope;

          yield* Debug.log({
            event: "render.errorboundary.fallback",
          });
        });

        // Render child with error handler in options - catch BOTH initial and re-render errors
        const childScope = yield* Scope.fork(yield* Effect.scope);
        const childRenderResult = yield* renderElement(
          child,
          parent,
          renderContext,
          context,
          childOptions,
        ).pipe(
          Scope.provide(childScope),
          Effect.onError(() => Scope.close(childScope, Exit.void)),
          Effect.map((result) => ({ success: true as const, result, scope: childScope })),
          Effect.catchCause((cause) =>
            renderFallbackForError(cause).pipe(Effect.map(() => ({ success: false as const }))),
          ),
        );

        if (childRenderResult.success) {
          currentResult = childRenderResult.result;
          currentScope = childRenderResult.scope;
          const inserted = yield* insertBeforeAnchor(currentResult.node);
          if (!inserted) {
            yield* cleanupCurrent;
          }

          yield* Debug.log({
            event: "render.errorboundary.initial",
          });
        }
        // If not success, fallback was already rendered by renderFallbackSync

        return {
          node: anchor,
          cleanup: Effect.gen(function* () {
            isUnmounted = true;
            yield* cleanupCurrent;
            anchor.remove();
          }),
        };
      }),
    ),

    Match.exhaustive,
  );

/**
 * Create the browser Renderer layer
 *
 * This layer provides the Renderer service for DOM rendering.
 *
 * @example
 * ```ts
 * Effect.runFork(
 *   render(container, App).pipe(
 *     Effect.provide(browserLayer)
 *   )
 * )
 * ```
 *
 * @remarks
 * `browserLayer` wires the DOM-specific renderer implementation used by the
 * higher-level mount helpers.
 *
 * @category Rendering
 * @public
 * @since 1.0.0
 */
export const browserLayer: Layer.Layer<Renderer> = Layer.effect(
  Renderer,
  Effect.gen(function* () {
    const services = unsafeWidenContext(yield* Effect.context<never>());

    const mountElement = Effect.fn("Renderer.mount")(function* (
      container: HTMLElement,
      element: Element,
    ) {
      const scope = yield* Effect.scope;
      const headService = yield* Head.makeBrowserHead();

      // Set Head service for head element hoisting
      yield* setFiberRef(Head.CurrentHead, headService);

      const methodServices = unsafeWidenContext(yield* Effect.context<never>());
      const renderServices = Context.merge(services, methodServices);
      const safeUrlConfig = Context.getOrElse(
        renderServices,
        SafeUrl.SafeUrlConfig,
        () => SafeUrl.defaultConfig,
      );

      const renderContext: RenderContext = { services: renderServices, scope, safeUrlConfig };

      // Set up render context after renderer-local FiberRefs are installed
      yield* setFiberRef(CurrentRenderContext, renderContext);

      // Create an anchor comment to mark the mount point
      // This replaces innerHTML="" clearing - we only manage our own nodes
      const mountAnchor = document.createComment("trygg-mount");
      container.appendChild(mountAnchor);

      // Render the element tree - content is inserted before the anchor
      // by the renderElement function (for Component, Fragment, etc.)
      // For elements that append directly, they go after existing content
      const result = yield* Effect.provide(
        renderElement(element, container, renderContext, null),
        renderServices,
      );

      // Move rendered content before the anchor for consistent ordering
      container.insertBefore(result.node, mountAnchor);

      // Register cleanup on scope finalization using acquireRelease pattern
      yield* Effect.addFinalizer(() =>
        Effect.catchCause(
          Effect.provide(
            Effect.gen(function* () {
              yield* result.cleanup;
              mountAnchor.remove();
            }),
            renderServices,
          ),
          () => Effect.void,
        ),
      );
    });

    const renderToParent = Effect.fn("Renderer.render")(function* (element: Element, parent: Node) {
      const scope = yield* Effect.scope;
      const methodServices = unsafeWidenContext(yield* Effect.context<never>());
      const renderServices = Context.merge(services, methodServices);
      const safeUrlConfig = Context.getOrElse(
        renderServices,
        SafeUrl.SafeUrlConfig,
        () => SafeUrl.defaultConfig,
      );
      const renderContext: RenderContext = { services: renderServices, scope, safeUrlConfig };
      return yield* Effect.provide(
        renderElement(element, parent, renderContext, null),
        renderServices,
      );
    });

    return Renderer.of({ mount: mountElement, render: renderToParent });
  }),
);

/**
 * Render an app to the DOM
 *
 * Lower-level render function that returns an Effect. For most cases,
 * use `mount` instead which handles the runtime setup.
 *
 * The app Effect is wrapped in a Component element to enable reactive
 * re-rendering when Signals change.
 *
 * @example
 * ```ts
 * // Composable - use when you need custom layer composition
 * runMain(
 *   render(container, App).pipe(
 *     Effect.scoped,
 *     Effect.provide(browserLayer)
 *   )
 * )
 * ```
 *
 * @since 1.0.0
 */
export const render = Effect.fn("render")(function* <E>(
  container: HTMLElement,
  app: Effect.Effect<Element, E, never>,
) {
  const renderer = yield* Renderer;

  // Wrap the app Effect in a Component element to enable reactive re-rendering
  // This is crucial for Signal-based reactivity to work
  const componentElement = Element.Component({
    run: () => app,
    key: null,
    identity: render,
    inputs: undefined,
  });

  yield* renderer.mount(container, componentElement);

  // Keep the app running forever - cleanup happens when interrupted
  return yield* Effect.never;
});

/**
 * Check if a value is an Effect
 * @internal
 */
const isEffectValue = (value: unknown): value is Effect.Effect<Element, unknown, never> =>
  Effect.isEffect(value);

/**
 * Mount an app to the DOM
 *
 * Main entrypoint for trygg applications. Handles all runtime setup
 * including scope management and the browser renderer layer.
 *
 * Accepts either an Effect<Element> or an Element directly.
 *
 * @example
 * ```tsx
 * // Component as Effect
 * const Counter = Effect.gen(function* () {
 *   const count = yield* Signal.make(0)
 *   return <div>Count: {count}</div>
 * })
 *
 * mount(document.getElementById("root")!, Counter)
 *
 * // With DevMode
 * mount(document.getElementById("root")!, <>
 *   <Counter />
 *   <DevMode />
 * </>)
 *
 * // With custom layers
 * mount(
 *   document.getElementById("root")!,
 *   Counter.pipe(Effect.provide(ThemeLayer))
 * )
 * ```
 *
 * @remarks
 * `mount` is the default browser entrypoint. It accepts either a ready
 * `Element` or an `Effect` that produces one, then installs the browser runtime,
 * router layer, and resource registry needed by a full app.
 *
 * @category Rendering
 * @public
 * @since 1.0.0
 */
export const mount = <E>(
  container: HTMLElement,
  app: Effect.Effect<Element, E, never> | Element,
): void => {
  // Normalize to Effect
  const appEffect = isEffectValue(app) ? app : Effect.succeed(app);

  // Dynamic import to avoid bundling platform-browser for non-browser usage
  Promise.all([
    import("@effect/platform-browser/BrowserRuntime"),
    import("../router/index.js"),
  ]).then(([{ runMain }, Router]) => {
    const routerLayer = Router.browserLayer.pipe(Layer.provide(platformBrowser));
    const appServicesLayer = Layer.mergeAll(routerLayer, ResourceRegistryLive);
    const appLayer = browserLayer.pipe(Layer.provideMerge(appServicesLayer));
    runMain(
      unsafeEraseR(render(container, appEffect).pipe(Effect.scoped, Effect.provide(appLayer))),
    );
  });
};

/**
 * Render an app as the document owner (root layout pattern).
 *
 * Lower-level function for document-level rendering. The root layout
 * renders `<html>`, `<head>`, `<body>` — these map to existing DOM nodes
 * instead of creating new elements.
 *
 * @example
 * ```tsx
 * const RootLayout = Component.gen(function* () {
 *   return (
 *     <html lang="en">
 *       <head>
 *         <title>My App</title>
 *         <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 *       </head>
 *       <body class="antialiased">
 *         <Router.Outlet />
 *       </body>
 *     </html>
 *   )
 * })
 *
 * mountDocument(<RootLayout />)
 * ```
 *
 * @remarks
 * `renderDocument` is the composable Effect form for document ownership. Use it
 * when you need to provide custom layers or manage the runtime yourself.
 *
 * @category Rendering
 * @public
 * @since 1.0.0
 */
export const renderDocument = <E>(
  app: Effect.Effect<Element, E, never>,
  options?: { readonly manifest?: RoutesManifest },
): Effect.Effect<never, E | unknown, Renderer | Scope.Scope> =>
  Effect.gen(function* () {
    const renderer = yield* Renderer;

    yield* Head.enableDocumentMount;

    // Set routes manifest if provided (enables <Router.Outlet /> without props)
    if (options?.manifest !== undefined) {
      const Router = yield* Effect.promise(() => import("../router/index.js"));
      yield* setFiberRef(Router.CurrentRoutesManifest, Option.some(options.manifest));
    }

    // Wrap the app Effect in a Component element for reactive re-rendering
    const componentElement = Element.Component({
      run: () => app,
      key: null,
      identity: renderDocument,
      inputs: undefined,
    });

    // Render into document.body — the root layout's <html>/<body> will map to existing DOM
    yield* renderer.mount(document.body, componentElement);

    // Keep the app running forever - cleanup happens when interrupted
    return yield* Effect.never;
  }) as Effect.Effect<never, E | unknown, Renderer | Scope.Scope>;

/**
 * Mount an app as the document owner.
 *
 * Like `mount` but for apps where the root layout renders the full
 * `<html>` boilerplate (Next.js pattern). The `<html>`, `<head>`, and
 * `<body>` elements map to existing DOM nodes instead of creating new ones.
 *
 * @example
 * ```tsx
 * const RootLayout = Component.gen(function* () {
 *   return (
 *     <html lang="en">
 *       <head>
 *         <title>My App</title>
 *       </head>
 *       <body>
 *         <main><Router.Outlet /></main>
 *       </body>
 *     </html>
 *   )
 * })
 *
 * mountDocument(<RootLayout />)
 * ```
 *
 * @remarks
 * `mountDocument` mirrors `mount` for root layouts that render `<html>`,
 * `<head>`, and `<body>` into the existing browser document.
 *
 * @category Rendering
 * @public
 * @since 1.0.0
 */
export const mountDocument = <E>(
  app: Effect.Effect<Element, E, never> | Element,
  options?: { readonly manifest?: RoutesManifest },
): void => {
  const appEffect = isEffectValue(app) ? app : Effect.succeed(app);

  Promise.all([
    import("@effect/platform-browser/BrowserRuntime"),
    import("../router/index.js"),
  ]).then(([{ runMain }, Router]) => {
    const routerLayer = Router.browserLayer.pipe(Layer.provide(platformBrowser));
    const appServicesLayer = Layer.mergeAll(routerLayer, ResourceRegistryLive);
    const appLayer = browserLayer.pipe(Layer.provideMerge(appServicesLayer));
    runMain(
      unsafeEraseR(
        renderDocument(appEffect, options).pipe(Effect.scoped, Effect.provide(appLayer)),
      ),
    );
  });
};
