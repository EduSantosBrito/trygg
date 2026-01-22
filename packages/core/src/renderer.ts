/**
 * @since 1.0.0
 * Renderer service for effect-ui
 *
 * Handles mounting Element trees to the DOM.
 */
import {
  Cause,
  Context,
  Data,
  Effect,
  Exit,
  FiberRef,
  Layer,
  Match,
  Option,
  Runtime,
  Scope,
} from "effect";
import {
  Element,
  isElement,
  normalizeChild,
  type ElementProps,
  type EventHandler,
} from "./element.js";
import * as Signal from "./signal.js";
import * as Debug from "./debug/debug.js";
import * as Metrics from "./debug/metrics.js";
import * as Router from "./router/index.js";
import * as SafeUrl from "./security/safe-url.js";

/**
 * Type guard to check if a value is an EventHandler (function or Effect)
 * This asserts the type at the boundary where we iterate over props
 * @internal
 */
const isEventHandler = (value: unknown): value is EventHandler =>
  typeof value === "function" || Effect.isEffect(value);

const emptyContext = Context.unsafeMake<unknown>(new Map());

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

/**
 * Render context passed through the rendering tree
 * @since 1.0.0
 */
export interface RenderContext {
  readonly runtime: Runtime.Runtime<never>;
  readonly scope: Scope.Scope;
}

/**
 * FiberRef to track the current render context
 * @since 1.0.0
 */
export const CurrentRenderContext: FiberRef.FiberRef<RenderContext | null> =
  FiberRef.unsafeMake<RenderContext | null>(null);

/**
 * Result of rendering an element - contains the DOM node and cleanup effect
 * @since 1.0.0
 */
export interface RenderResult {
  readonly node: Node;
  readonly cleanup: Effect.Effect<void>;
}

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
 * @since 1.0.0
 */
export class Renderer extends Context.Tag("@effect-ui/Renderer")<Renderer, RendererService>() {}

/**
 * Apply a single prop value to a DOM element
 * @internal
 */
const applyPropValue = (node: HTMLElement, key: string, value: unknown): void => {
  if (key === "style" && typeof value === "object" && value !== null) {
    Object.assign(node.style, value);
  } else if (key === "className") {
    node.className = String(value);
  } else if (key === "htmlFor") {
    node.setAttribute("for", String(value));
  } else if (key === "checked" && node instanceof HTMLInputElement) {
    node.checked = Boolean(value);
  } else if (
    key === "value" &&
    (node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement)
  ) {
    // Skip updating value on focused inputs to prevent overwriting user input
    // during fast typing. The DOM input already has the correct value from
    // user keystrokes; setting value would reset it to a stale signal state.
    const isFocused = document.activeElement === node;
    if (!isFocused) {
      node.value = String(value);
    }
  } else if (key === "disabled") {
    if (value) {
      node.setAttribute("disabled", "");
    } else {
      node.removeAttribute("disabled");
    }
  } else if (key === "hidden") {
    if (value) {
      node.setAttribute("hidden", "");
    } else {
      node.removeAttribute("hidden");
    }
  } else if (key.startsWith("data-") || key.startsWith("aria-")) {
    node.setAttribute(key, String(value));
  } else if (key === "href" || key === "src") {
    // Validate href/src for security - only allow safe URL schemes
    const url = String(value);
    const validated = SafeUrl.validateSync(url);
    if (Option.isSome(validated)) {
      node.setAttribute(key, validated.value);
    } else {
      // Unsafe URL - emit warning and skip attribute
      // Note: This is sync path, so we use console.warn directly
      // Debug.log is Effect-based and would need runtime context
      const config = SafeUrl.getConfig();
      console.warn(
        `[effect-ui] Blocked unsafe ${key}="${url}". ` +
          `Allowed schemes: ${config.allowedSchemes.join(", ")}. ` +
          `See SafeUrl.allowSchemes() to add custom schemes.`,
      );
    }
  } else if (key !== "children" && key !== "key" && typeof value !== "function") {
    // Generic attribute
    if (typeof value === "boolean") {
      if (value) {
        node.setAttribute(key, "");
      } else {
        node.removeAttribute(key);
      }
    } else {
      node.setAttribute(key, String(value));
    }
  }
};

/**
 * Apply props to a DOM element, with fine-grained Signal support
 * @internal
 */
const applyProps = Effect.fn("applyProps")(function* (
  node: HTMLElement,
  props: ElementProps,
  runtime: Runtime.Runtime<never>,
) {
  const cleanups: Array<() => void> = [];

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;

    if (key.startsWith("on") && isEventHandler(value)) {
      // Event handler: wrap in runtime execution
      const eventName = key.slice(2).toLowerCase();
      const handler = value;
      const listener = (event: Event) => {
        // Support both function handlers and plain Effects
        const effect = typeof handler === "function" ? handler(event) : handler;
        Runtime.runFork(runtime)(effect);
      };
      node.addEventListener(eventName, listener);
      cleanups.push(() => node.removeEventListener(eventName, listener));
    } else if (Signal.isSignal(value)) {
      // Signal prop: fine-grained reactivity!
      // Read initial value and subscribe for updates
      const initialValue = yield* Signal.get(value);
      applyPropValue(node, key, initialValue);

      yield* Debug.log({
        event: "render.signaltext.initial",
        signal_id: value._debugId,
        value: initialValue,
        element_tag: node.tagName.toLowerCase(),
        trigger: `prop:${key}`,
      });

      // Subscribe to signal changes - update DOM directly
      // Listener returns Effect which is run inside notifyListeners
      const unsubscribe = yield* Signal.subscribe(value, () =>
        Effect.gen(function* () {
          const newValue = yield* Signal.get(value);
          yield* Debug.log({
            event: "render.signaltext.update",
            signal_id: value._debugId,
            value: newValue,
            element_tag: node.tagName.toLowerCase(),
            trigger: `prop:${key}`,
          });
          applyPropValue(node, key, newValue);
        }),
      );
      // unsubscribe is an Effect, wrap in sync runner for cleanup array
      cleanups.push(() => Runtime.runSync(runtime)(unsubscribe));
    } else {
      // Static prop value
      applyPropValue(node, key, value);
    }
  }

  return cleanups;
});

/**
 * Render an Element to a DOM node
 * @internal
 */
const renderElement = (
  element: Element,
  parent: Node,
  runtime: Runtime.Runtime<never>,
  context: Context.Context<unknown> | null,
  options: RenderOptions = defaultRenderOptions,
): Effect.Effect<RenderResult, unknown, Scope.Scope> =>
  Match.value(element).pipe(
    Match.tag("Text", ({ content }) =>
      Effect.sync(() => {
        const node = document.createTextNode(content);
        parent.appendChild(node);
        return {
          node,
          cleanup: Effect.sync(() => node.remove()),
        };
      }),
    ),

    Match.tag("SignalText", ({ signal }) =>
      Effect.gen(function* () {
        // Get initial value and create text node
        const initialValue = yield* Signal.get(signal);
        const node = document.createTextNode(String(initialValue));
        parent.appendChild(node);

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
        };
      }),
    ),

    Match.tag("SignalElement", ({ signal }) =>
      Effect.gen(function* () {
        // Create anchor comment for positioning
        const anchor = document.createComment("signal-element");
        parent.appendChild(anchor);

        // State to track current rendered content
        let currentResult: RenderResult | null = null;
        let currentScope: Scope.CloseableScope | null = null;
        let isUnmounted = false;

        // Helper to render Element or convert primitive to Text
        const renderValue = (value: unknown): Element =>
          isElement(value) ? value : Element.Text({ content: String(value) });

        const cleanupCurrent: Effect.Effect<void> = Effect.gen(function* () {
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
        ) => Effect.Effect<{ result: RenderResult; scope: Scope.CloseableScope }, unknown, never> =
          Effect.fnUntraced(function* (value: unknown) {
            const scope = yield* Scope.make();
            const element = renderValue(value);
            const result = yield* renderElement(element, parent, runtime, context, options).pipe(
              Effect.provideService(Scope.Scope, scope),
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

            Runtime.runFork(runtime)(
              Effect.gen(function* () {
                const newValue = yield* Signal.get(signal);

                // Render new content FIRST (before cleanup) so we can keep old on error
                const nextRender = yield* renderWithScope(newValue);

                // Cleanup old content + scope AFTER successful render
                yield* cleanupCurrent;

                currentResult = nextRender.result;
                currentScope = nextRender.scope;
                parent.insertBefore(currentResult.node, anchor);

                yield* Debug.log({
                  event: "render.signalelement.swap",
                  signal_id: signal._debugId,
                });
              }).pipe(
                Effect.catchAllCause((cause) =>
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
      renderElement(child, parent, runtime, providedContext, options),
    ),

    Match.tag("Intrinsic", ({ tag, props, children }) =>
      Effect.gen(function* () {
        const node = document.createElement(tag);

        yield* Debug.log({
          event: "render.intrinsic",
          element_tag: tag,
        });

        // Apply props and get cleanup functions
        const propCleanups = yield* applyProps(node, props, runtime);

        // Render children
        const childResults: Array<RenderResult> = [];
        for (const child of children) {
          const result = yield* renderElement(child, node, runtime, context, options);
          childResults.push(result);
        }

        parent.appendChild(node);

        return {
          node,
          cleanup: Effect.gen(function* () {
            // Clean up children first
            for (const child of childResults) {
              yield* child.cleanup;
            }
            // Clean up props (event listeners)
            for (const cleanup of propCleanups) {
              cleanup();
            }
            // Remove node
            node.remove();
          }),
        };
      }),
    ),

    Match.tag("Component", ({ run }) =>
      Effect.gen(function* () {
        // Create the effect from the thunk
        const effect = run();
        const effectWithContext = Effect.provide(effect, context ?? emptyContext);

        // Create a placeholder comment as anchor for this component
        const anchor = document.createComment("component");
        parent.appendChild(anchor);

        // State for reactive re-rendering
        let currentResult: RenderResult | null = null;
        let currentRenderScope: Scope.CloseableScope | null = null;
        let isRerendering = false;
        let isUnmounted = false;
        let pendingRerender = false; // Track if signal changed during re-render
        let renderCount = 0;

        // Component lifetime scope (persists across re-renders)
        const componentScope = yield* Scope.make();

        // Create render phase for this component (persists across re-renders)
        const renderPhase = yield* Signal.makeRenderPhase;

        const rendererScope = yield* Effect.scope;

        // Track active subscription cleanups (each is an Effect that unsubscribes)
        let subscriptionCleanups: Array<Effect.Effect<void>> = [];

        const cleanupCurrent: Effect.Effect<void> = Effect.gen(function* () {
          if (currentResult !== null) {
            yield* currentResult.cleanup;
            currentResult = null;
          }
          if (currentRenderScope !== null) {
            const scope = currentRenderScope;
            currentRenderScope = null;
            yield* Scope.close(scope, Exit.void);
          }
        });

        const runComponentEffect: () => Effect.Effect<
          { element: Element; scope: Scope.CloseableScope },
          unknown,
          never
        > = Effect.fnUntraced(function* () {
          const renderScope = yield* Scope.make();
          const element = yield* Effect.locally(
            Effect.locally(
              Effect.locally(effectWithContext, Signal.CurrentRenderPhase, renderPhase),
              Signal.CurrentComponentScope,
              componentScope,
            ),
            Signal.CurrentRenderScope,
            renderScope,
          ).pipe(Effect.onError(() => Scope.close(renderScope, Exit.void)));
          return { element, scope: renderScope };
        });

        // Helper to render and position content before the anchor
        // IMPORTANT: Use anchor.parentNode instead of captured parent because
        // when Component is inside a Fragment, the initial parent is a DocumentFragment
        // which becomes empty after appendChild. The anchor moves to the real parent.
        const renderAndPosition = Effect.fnUntraced(function* (childElement: Element) {
          // Get the actual parent from the anchor's current location
          const actualParent = anchor.parentNode;
          if (actualParent === null) {
            throw new Error("Component anchor has no parent - component may have been unmounted");
          }
          const result = yield* renderElement(
            childElement,
            actualParent,
            runtime,
            context,
            options,
          );
          // Move rendered content before the anchor
          actualParent.insertBefore(result.node, anchor);
          return result;
        });

        // Forward declaration for recursive scheduling
        let scheduleRerender: () => void;

        // Function to perform the actual re-render
        const doRerender = (): void => {
          if (isUnmounted) {
            isRerendering = false;
            pendingRerender = false;
            return;
          }

          renderCount++;
          // Note: This is in a sync context (queueMicrotask), so we log inside the runFork effect
          // The Debug.log below is triggered from within the Effect.gen that follows

          // Re-render
          const rerenderEffect = Effect.gen(function* () {
            // Track re-render duration
            const rerenderStart = performance.now();

            // Reset render phase for re-render
            yield* Signal.resetRenderPhase(renderPhase);

            // Re-execute the component effect with render phase context
            // NOTE: Render BEFORE cleanup so we can keep old content on error
            const nextRender = yield* runComponentEffect();
            const nextResult = yield* renderAndPosition(normalizeChild(nextRender.element)).pipe(
              Effect.onError(() => Scope.close(nextRender.scope, Exit.void)),
            );

            // Clean up old render + scope AFTER successful render
            yield* cleanupCurrent;

            currentRenderScope = nextRender.scope;
            currentResult = nextResult;
            const rerenderDuration = performance.now() - rerenderStart;

            // Record render metrics for re-render
            yield* Metrics.recordComponentRender;
            yield* Metrics.recordRenderDuration(rerenderDuration);

            // Check if another re-render was requested during this render
            const needsAnotherRender = pendingRerender;
            isRerendering = false;
            pendingRerender = false;

            // Re-subscribe to signals (may be different set after re-render)
            yield* subscribeToSignals(renderPhase.accessed);

            // If a signal changed during re-render, schedule another re-render
            if (needsAnotherRender) {
              scheduleRerender();
            }
          }).pipe(
            Effect.catchAllCause((cause) =>
              Effect.gen(function* () {
                yield* Debug.log({
                  event: "render.component.rerender",
                  trigger: "error",
                  reason: String(cause),
                });

                // Check for parent error boundary handler
                if (options.errorHandler !== null) {
                  // Propagate error to error boundary - it will render fallback
                  options.errorHandler(cause);
                } else {
                  // No error boundary - keep old content and re-subscribe for retry
                  yield* subscribeToSignals(renderPhase.accessed);
                }

                isRerendering = false;
                pendingRerender = false;
              }),
            ),
            Effect.provideService(Scope.Scope, rendererScope),
          );

          Runtime.runFork(runtime)(rerenderEffect);
        };

        // Schedule a re-render via microtask
        // Note: scheduleRerender is sync because it's called from signal listeners
        // and must complete synchronously. Logging happens in the rerender Effect.
        scheduleRerender = () => {
          if (isUnmounted) return;

          if (isRerendering) {
            // Mark that we need another re-render after the current one completes
            pendingRerender = true;
            return;
          }

          isRerendering = true;
          queueMicrotask(doRerender);
        };

        // Function to subscribe to accessed signals
        // Returns Effects for unsubscribing
        const subscribeToSignals: (signals: Set<Signal.Signal<unknown>>) => Effect.Effect<void> =
          Effect.fnUntraced(function* (signals: Set<Signal.Signal<unknown>>) {
            // Clear old subscriptions
            const oldCleanups = subscriptionCleanups;
            for (const cleanup of oldCleanups) {
              yield* cleanup;
            }
            subscriptionCleanups = [];

            if (signals.size === 0) return;

            for (const signal of signals) {
              // Subscribe with Effect-based listener that triggers sync rerender
              const unsubscribe = yield* Signal.subscribe(signal, () =>
                Effect.sync(scheduleRerender),
              );
              subscriptionCleanups.push(unsubscribe);
            }
          });

        // Execute the component effect with render phase context and track duration
        const renderStart = performance.now();
        const initialRender = yield* runComponentEffect();

        // Render and position the content
        const initialResult = yield* renderAndPosition(normalizeChild(initialRender.element)).pipe(
          Effect.onError(() => Scope.close(initialRender.scope, Exit.void)),
        );
        currentRenderScope = initialRender.scope;
        currentResult = initialResult;
        const renderDuration = performance.now() - renderStart;
        renderCount++;

        yield* Debug.log({
          event: "render.component.initial",
          accessed_signals: renderPhase.accessed.size,
          duration_ms: renderDuration,
        });

        // Record render metrics
        yield* Metrics.recordComponentRender;
        yield* Metrics.recordRenderDuration(renderDuration);

        // Subscribe to accessed signals for reactivity
        yield* subscribeToSignals(renderPhase.accessed);

        return {
          node: anchor,
          cleanup: Effect.gen(function* () {
            isUnmounted = true;
            // Clean up signal subscriptions
            for (const cleanup of subscriptionCleanups) {
              yield* cleanup;
            }
            subscriptionCleanups = [];
            // Clean up rendered content + render scope
            yield* cleanupCurrent;
            yield* Scope.close(componentScope, Exit.void);
            anchor.remove();
          }),
        };
      }),
    ),

    Match.tag("Fragment", ({ children }) =>
      Effect.gen(function* () {
        const fragment = document.createDocumentFragment();
        const childResults: Array<RenderResult> = [];

        for (const child of children) {
          const result = yield* renderElement(child, fragment, runtime, context, options);
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

        // Render children into target
        const childResults: Array<RenderResult> = [];
        for (const child of children) {
          const result = yield* renderElement(child, targetElement, runtime, context, options);
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
      Effect.gen(function* () {
        // Create anchor comment for the list
        const anchor = document.createComment("keyed-list");
        const listParent = parent;
        listParent.appendChild(anchor);

        // Track item states by key
        type ItemState = {
          renderPhase: Signal.RenderPhase;
          result: RenderResult;
          node: Node;
          item: unknown;
          /** Map from signal debugId to unsubscribe Effect */
          subscriptions: Map<string, Effect.Effect<void>>;
        };
        const itemStates = new Map<string | number, ItemState>();
        const keyOrder: Array<string | number> = [];
        let isUnmounted = false;

        /**
         * Compute Longest Increasing Subsequence indices.
         * Returns indices in the input array that form the LIS.
         * Used to determine which nodes don't need to move during reorder.
         * @internal
         */
        const computeLIS = (arr: ReadonlyArray<number>): ReadonlyArray<number> => {
          const n = arr.length;
          if (n === 0) return [];

          // dp[i] = smallest ending value for IS of length i+1
          const dp: Array<number> = [];
          // parent[i] = index of previous element in LIS ending at i
          const parent: Array<number> = Array.from({ length: n }, () => -1);
          // pos[i] = index in arr where dp[i] came from
          const pos: Array<number> = [];

          for (let i = 0; i < n; i++) {
            const val = arr[i];
            if (val === undefined) continue;

            // Binary search for position
            let lo = 0;
            let hi = dp.length;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              const dpMid = dp[mid];
              if (dpMid !== undefined && dpMid < val) {
                lo = mid + 1;
              } else {
                hi = mid;
              }
            }

            dp[lo] = val;
            pos[lo] = i;
            parent[i] = lo > 0 ? (pos[lo - 1] ?? -1) : -1;
          }

          // Reconstruct LIS
          const lisIndices: Array<number> = [];
          let k = pos[dp.length - 1];
          while (k !== undefined && k !== -1) {
            lisIndices.push(k);
            k = parent[k];
          }
          lisIndices.reverse();
          return lisIndices;
        };

        // Helper to render a single item with a stable render phase
        const renderItem = Effect.fn("renderItem")(function* (
          item: unknown,
          index: number,
          existingPhase: Signal.RenderPhase | null,
        ) {
          // Use existing phase or create new one
          const renderPhase = existingPhase ?? (yield* Signal.makeRenderPhase);

          if (existingPhase !== null) {
            // Reset for re-render
            yield* Signal.resetRenderPhase(renderPhase);
          }

          // Execute render function with render phase context and parent context
          const renderEffect = Effect.provide(renderFn(item, index), context ?? emptyContext);

          const element = yield* Effect.locally(
            renderEffect,
            Signal.CurrentRenderPhase,
            renderPhase,
          );

          // Render the element with parent context
          const result = yield* renderElement(
            normalizeChild(element),
            listParent,
            runtime,
            context,
            options,
          );

          return { renderPhase, result };
        });

        /**
         * Diff subscriptions: unsubscribe from removed signals, subscribe to new ones.
         * Reuses existing subscriptions for signals that are still accessed.
         * @internal
         */
        const diffSubscriptions: (
          key: string | number,
          state: ItemState,
          newAccessed: Set<Signal.Signal<unknown>>,
          scheduleRerender: () => Effect.Effect<void>,
        ) => Effect.Effect<void> = Effect.fnUntraced(function* (
          key: string | number,
          state: ItemState,
          newAccessed: Set<Signal.Signal<unknown>>,
          scheduleRerender: () => Effect.Effect<void>,
        ) {
          const oldSubs = state.subscriptions;
          const newSubs = new Map<string, Effect.Effect<void>>();

          // Build set of new signal IDs
          const newSignalIds = new Set<string>();
          for (const signal of newAccessed) {
            newSignalIds.add(signal._debugId);
          }

          // Unsubscribe from signals no longer accessed
          for (const [signalId, unsubscribe] of oldSubs) {
            if (!newSignalIds.has(signalId)) {
              yield* unsubscribe;
              yield* Debug.log({
                event: "render.keyedlist.subscription.remove",
                key,
                signal_id: signalId,
              });
            }
          }

          // Subscribe to new signals, reuse existing subscriptions
          for (const signal of newAccessed) {
            const existingUnsub = oldSubs.get(signal._debugId);
            if (existingUnsub !== undefined) {
              // Reuse existing subscription
              newSubs.set(signal._debugId, existingUnsub);
            } else {
              // New subscription needed
              const unsubscribe = yield* Signal.subscribe(signal, scheduleRerender);
              newSubs.set(signal._debugId, unsubscribe);
              yield* Debug.log({
                event: "render.keyedlist.subscription.add",
                key,
                signal_id: signal._debugId,
              });
            }
          }

          state.subscriptions = newSubs;
        });

        // Function to update the list
        // Note: updateList is sync because it's called from signal listener,
        // but it immediately forks an Effect for the actual work.
        const updateList = (): void => {
          if (isUnmounted) return;

          Runtime.runFork(runtime)(
            Effect.scoped(
              Effect.gen(function* () {
                yield* Debug.log({
                  event: "render.keyedlist.update",
                  current_keys: keyOrder.length,
                });

                // Get current items from source signal
                const items = yield* Signal.get(source);

                // Compute new keys
                const newKeys = items.map((item, i) => keyFn(item, i));
                const newKeySet = new Set(newKeys);

                // Build map of old key -> old index for LIS calculation
                const oldKeyToIndex = new Map<string | number, number>();
                for (let i = 0; i < keyOrder.length; i++) {
                  const key = keyOrder[i];
                  if (key !== undefined) {
                    oldKeyToIndex.set(key, i);
                  }
                }

                // Remove items that are no longer in the list
                for (const key of keyOrder) {
                  if (!newKeySet.has(key)) {
                    const state = itemStates.get(key);
                    if (state) {
                      // Clean up subscriptions
                      for (const [, unsubscribe] of state.subscriptions) {
                        yield* unsubscribe;
                      }
                      // Clean up rendered content
                      yield* state.result.cleanup;
                      itemStates.delete(key);
                      yield* Debug.log({
                        event: "render.keyedlist.item.remove",
                        key,
                      });
                    }
                  }
                }

                // Compute old indices for existing items in new order
                // -1 means new item (not in old list)
                const oldIndicesInNewOrder: Array<number> = [];
                for (const key of newKeys) {
                  if (key === undefined) continue;
                  const oldIndex = oldKeyToIndex.get(key);
                  oldIndicesInNewOrder.push(oldIndex ?? -1);
                }

                // Filter to only existing items (non-negative indices) for LIS
                const existingIndices = oldIndicesInNewOrder.filter((i) => i >= 0);
                const lisIndices = new Set(computeLIS(existingIndices));

                // Track which existing items (by their old index) are in LIS
                const stableOldIndices = new Set<number>();
                let lisIdx = 0;
                for (const oldIdx of existingIndices) {
                  if (lisIndices.has(lisIdx)) {
                    stableOldIndices.add(oldIdx);
                  }
                  lisIdx++;
                }

                // Render new items and collect all states in new order
                const newItemStates: Array<{
                  key: string | number;
                  state: ItemState;
                  isNew: boolean;
                  needsMove: boolean;
                }> = [];

                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  const key = newKeys[i];

                  if (key === undefined) continue;

                  const existingState = itemStates.get(key);
                  const oldIndex = oldKeyToIndex.get(key);

                  if (existingState !== undefined && oldIndex !== undefined) {
                    // Item exists - update stored item reference
                    existingState.item = item;
                    // Check if this item needs to move (not in LIS)
                    const needsMove = !stableOldIndices.has(oldIndex);
                    newItemStates.push({ key, state: existingState, isNew: false, needsMove });
                  } else {
                    // New item - create new state
                    const { renderPhase, result } = yield* renderItem(item, i, null);

                    const state: ItemState = {
                      renderPhase,
                      result,
                      node: result.node,
                      item,
                      subscriptions: new Map(),
                    };

                    // Set up subscriptions for this item's accessed signals
                    // scheduleItemRerender returns an Effect that triggers rerender
                    const scheduleItemRerender = (): Effect.Effect<void> =>
                      Effect.sync(() => {
                        if (isUnmounted) return;
                        const currentState = itemStates.get(key);
                        if (currentState === undefined) return;

                        Runtime.runFork(runtime)(
                          Effect.scoped(
                            Effect.gen(function* () {
                              // Re-render with same phase (preserves signals)
                              const { result: newResult } = yield* renderItem(
                                currentState.item,
                                i,
                                currentState.renderPhase,
                              );

                              // Replace old node with new
                              currentState.result.node.parentNode?.replaceChild(
                                newResult.node,
                                currentState.result.node,
                              );

                              // Clean up old render
                              yield* currentState.result.cleanup;

                              // Update state
                              currentState.result = newResult;
                              currentState.node = newResult.node;

                              // Diff subscriptions (reuse stable ones)
                              yield* diffSubscriptions(
                                key,
                                currentState,
                                currentState.renderPhase.accessed,
                                scheduleItemRerender,
                              );
                            }),
                          ),
                        );
                      });

                    // Initial subscription setup
                    yield* diffSubscriptions(
                      key,
                      state,
                      renderPhase.accessed,
                      scheduleItemRerender,
                    );

                    itemStates.set(key, state);
                    newItemStates.push({ key, state, isNew: true, needsMove: false });
                    yield* Debug.log({
                      event: "render.keyedlist.item.add",
                      key,
                    });
                  }
                }

                // Reorder DOM nodes using minimal moves (LIS optimization)
                // Process from end to start, keeping track of next sibling reference
                // Nodes in LIS stay in place; only move nodes not in LIS
                let moveCount = 0;
                let nextSibling: Node = anchor;

                // Iterate in reverse to build correct order
                for (let i = newItemStates.length - 1; i >= 0; i--) {
                  const entry = newItemStates[i];
                  if (entry === undefined) continue;
                  const { state, isNew, needsMove } = entry;

                  if (isNew || needsMove) {
                    // Insert/move this node before the next sibling
                    listParent.insertBefore(state.node, nextSibling);
                    moveCount++;
                  }
                  // Update next sibling reference for the next iteration
                  nextSibling = state.node;
                }

                yield* Debug.log({
                  event: "render.keyedlist.reorder",
                  total_items: newItemStates.length,
                  moves: moveCount,
                  stable_nodes: newItemStates.length - moveCount,
                });

                // Update key order
                keyOrder.length = 0;
                for (const key of newKeys) {
                  if (key !== undefined) {
                    keyOrder.push(key);
                  }
                }
              }),
            ),
          );
        };

        // Initial render
        yield* Effect.sync(updateList);

        // Subscribe to source signal changes
        // updateList returns void but is wrapped in sync Effect by the listener
        const unsubscribeSource = yield* Signal.subscribe(source, () => Effect.sync(updateList));

        return {
          node: anchor,
          cleanup: Effect.gen(function* () {
            isUnmounted = true;
            yield* unsubscribeSource;

            // Clean up all items
            for (const [, state] of itemStates) {
              for (const [, unsubscribe] of state.subscriptions) {
                yield* unsubscribe;
              }
              yield* state.result.cleanup;
            }
            itemStates.clear();
            anchor.remove();
          }),
        };
      }),
    ),

    Match.tag("ErrorBoundaryElement", ({ child, fallback, onError }) =>
      Effect.gen(function* () {
        // Create anchor comment for positioning
        const anchor = document.createComment("error-boundary");
        parent.appendChild(anchor);

        // State to track current rendered content
        let currentResult: RenderResult | null = null;
        let currentScope: Scope.CloseableScope | null = null;
        let isUnmounted = false;
        let hasErrored = false;

        const cleanupCurrent: Effect.Effect<void> = Effect.gen(function* () {
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

        // Error handler that swaps to fallback
        const errorHandler: ErrorBoundaryHandler = (cause) => {
          if (isUnmounted || hasErrored) return;
          hasErrored = true;

          Runtime.runFork(runtime)(
            Effect.gen(function* () {
              yield* Debug.log({
                event: "render.errorboundary.caught",
                reason: String(cause),
              });

              // Call onError callback if provided
              if (onError !== null) {
                yield* Effect.provide(onError(Cause.squash(cause)), context ?? emptyContext);
              }

              // Compute fallback element
              const fallbackElement =
                typeof fallback === "function" ? fallback(Cause.squash(cause)) : fallback;

              // Render fallback with a new scope (no error handler - don't catch fallback errors)
              const fallbackScope = yield* Scope.make();
              const fallbackResult = yield* renderElement(
                fallbackElement,
                parent,
                runtime,
                context,
                defaultRenderOptions,
              ).pipe(
                Effect.provideService(Scope.Scope, fallbackScope),
                Effect.onError(() => Scope.close(fallbackScope, Exit.void)),
              );

              // Clean up old content
              yield* cleanupCurrent;

              // Install fallback
              currentResult = fallbackResult;
              currentScope = fallbackScope;
              parent.insertBefore(currentResult.node, anchor);

              yield* Debug.log({
                event: "render.errorboundary.fallback",
              });
            }).pipe(
              // Log any errors during fallback rendering
              Effect.tapErrorCause((fallbackCause) =>
                Effect.sync(() => {
                  // eslint-disable-next-line no-console
                  console.error(
                    "[effect-ui] ErrorBoundary fallback rendering failed:",
                    Cause.pretty(fallbackCause),
                  );
                }),
              ),
            ),
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
            yield* Effect.provide(onError(Cause.squash(cause)), context ?? emptyContext);
          }

          // Compute fallback element
          const fallbackElement =
            typeof fallback === "function" ? fallback(Cause.squash(cause)) : fallback;

          // Render fallback with a new scope (no error handler - don't catch fallback errors)
          const fallbackScope = yield* Scope.make();
          const fallbackResult = yield* renderElement(
            fallbackElement,
            parent,
            runtime,
            context,
            defaultRenderOptions,
          ).pipe(
            Effect.provideService(Scope.Scope, fallbackScope),
            Effect.onError(() => Scope.close(fallbackScope, Exit.void)),
          );

          // Clean up old content (should be nothing on initial render)
          yield* cleanupCurrent;

          // Install fallback
          currentResult = fallbackResult;
          currentScope = fallbackScope;
          parent.insertBefore(currentResult.node, anchor);

          yield* Debug.log({
            event: "render.errorboundary.fallback",
          });
        });

        // Render child with error handler in options - catch BOTH initial and re-render errors
        const childScope = yield* Scope.make();
        const childRenderResult = yield* renderElement(
          child,
          parent,
          runtime,
          context,
          childOptions,
        ).pipe(
          Effect.provideService(Scope.Scope, childScope),
          Effect.onError(() => Scope.close(childScope, Exit.void)),
          Effect.map((result) => ({ success: true as const, result, scope: childScope })),
          Effect.catchAllCause((cause) =>
            renderFallbackForError(cause).pipe(Effect.map(() => ({ success: false as const }))),
          ),
        );

        if (childRenderResult.success) {
          currentResult = childRenderResult.result;
          currentScope = childRenderResult.scope;
          parent.insertBefore(currentResult.node, anchor);

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
 * @since 1.0.0
 */
export const browserLayer: Layer.Layer<Renderer> = Layer.effect(
  Renderer,
  Effect.gen(function* () {
    const mountElement = Effect.fn("Renderer.mount")(function* (
      container: HTMLElement,
      element: Element,
    ) {
      const runtime = yield* Effect.runtime<never>();
      const scope = yield* Effect.scope;

      // Set up render context
      yield* FiberRef.set(CurrentRenderContext, { runtime, scope });

      // Create an anchor comment to mark the mount point
      // This replaces innerHTML="" clearing - we only manage our own nodes
      const mountAnchor = document.createComment("effect-ui-mount");
      container.appendChild(mountAnchor);

      // Render the element tree - content is inserted before the anchor
      // by the renderElement function (for Component, Fragment, etc.)
      // For elements that append directly, they go after existing content
      const result = yield* renderElement(element, container, runtime, null);

      // Move rendered content before the anchor for consistent ordering
      container.insertBefore(result.node, mountAnchor);

      // Register cleanup on scope finalization using acquireRelease pattern
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* result.cleanup;
          mountAnchor.remove();
        }),
      );
    });

    const renderToParent = Effect.fn("Renderer.render")(function* (element: Element, parent: Node) {
      const runtime = yield* Effect.runtime<never>();
      return yield* renderElement(element, parent, runtime, null);
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
  typeof value === "object" && value !== null && Effect.EffectTypeId in value;

/**
 * Mount an app to the DOM
 *
 * Main entrypoint for effect-ui applications. Handles all runtime setup
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
 * @since 1.0.0
 */
export const mount = <E>(
  container: HTMLElement,
  app: Effect.Effect<Element, E, never> | Element,
): void => {
  // Normalize to Effect
  const appEffect = isEffectValue(app) ? app : Effect.succeed(app);

  // Merge Renderer and Router layers - Router is included by default
  const appLayer = Layer.merge(browserLayer, Router.browserLayer);

  // Dynamic import to avoid bundling platform-browser for non-browser usage
  import("@effect/platform-browser/BrowserRuntime").then(({ runMain }) => {
    runMain(render(container, appEffect).pipe(Effect.scoped, Effect.provide(appLayer)));
  });
};
