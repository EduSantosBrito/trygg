/**
 * @since 1.0.0
 * Renderer service for effect-ui
 *
 * Handles mounting Element trees to the DOM.
 */
import {
  Context,
  Data,
  Deferred,
  Effect,
  Fiber,
  FiberRef,
  Layer,
  Match,
  Runtime,
  Scope
} from "effect"
import { Element, type ElementProps, type EventHandler } from "./Element.js"
import * as Signal from "./Signal.js"
import * as Debug from "./debug.js"
import * as Router from "./router/index.js"

/**
 * Type guard to check if a value is an EventHandler
 * This asserts the type at the boundary where we iterate over props
 * @internal
 */
const isEventHandler = (value: unknown): value is EventHandler =>
  typeof value === "function"

/**
 * Error thrown when a Portal target cannot be found
 * @since 1.0.0
 */
export class PortalTargetNotFoundError extends Data.TaggedError(
  "PortalTargetNotFoundError"
)<{
  readonly target: HTMLElement | string
}> {
  override get message() {
    return `Portal target not found: ${this.target}`
  }
}

/**
 * Render context passed through the rendering tree
 * @since 1.0.0
 */
export interface RenderContext {
  readonly runtime: Runtime.Runtime<never>
  readonly scope: Scope.Scope
}

/**
 * FiberRef to track the current render context
 * @since 1.0.0
 */
export const CurrentRenderContext: FiberRef.FiberRef<RenderContext | null> =
  FiberRef.unsafeMake<RenderContext | null>(null)

/**
 * Result of rendering an element - contains the DOM node and cleanup effect
 * @since 1.0.0
 */
export interface RenderResult {
  readonly node: Node
  readonly cleanup: Effect.Effect<void>
}

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
    element: Element
  ) => Effect.Effect<void, unknown, Scope.Scope>

  /**
   * Render an Element to a DOM node
   */
  readonly render: (
    element: Element,
    parent: Node
  ) => Effect.Effect<RenderResult, unknown, Scope.Scope>
}

/**
 * Renderer service tag
 * @since 1.0.0
 */
export class Renderer extends Context.Tag("@effect-ui/Renderer")<
  Renderer,
  RendererService
>() {}

/**
 * Apply a single prop value to a DOM element
 * @internal
 */
const applyPropValue = (
  node: HTMLElement,
  key: string,
  value: unknown
): void => {
  if (key === "style" && typeof value === "object" && value !== null) {
    Object.assign(node.style, value)
  } else if (key === "className") {
    node.className = String(value)
  } else if (key === "htmlFor") {
    node.setAttribute("for", String(value))
  } else if (key === "checked" && node instanceof HTMLInputElement) {
    node.checked = Boolean(value)
  } else if (
    key === "value" &&
    (node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement)
  ) {
    // Skip updating value on focused inputs to prevent overwriting user input
    // during fast typing. The DOM input already has the correct value from
    // user keystrokes; setting value would reset it to a stale signal state.
    const isFocused = document.activeElement === node
    if (!isFocused) {
      node.value = String(value)
    }
  } else if (key === "disabled") {
    if (value) {
      node.setAttribute("disabled", "")
    } else {
      node.removeAttribute("disabled")
    }
  } else if (key === "hidden") {
    if (value) {
      node.setAttribute("hidden", "")
    } else {
      node.removeAttribute("hidden")
    }
  } else if (key.startsWith("data-") || key.startsWith("aria-")) {
    node.setAttribute(key, String(value))
  } else if (key !== "children" && key !== "key" && typeof value !== "function") {
    // Generic attribute
    if (typeof value === "boolean") {
      if (value) {
        node.setAttribute(key, "")
      } else {
        node.removeAttribute(key)
      }
    } else {
      node.setAttribute(key, String(value))
    }
  }
}

/**
 * Apply props to a DOM element, with fine-grained Signal support
 * @internal
 */
const applyProps = Effect.fn("applyProps")(function* (
  node: HTMLElement,
  props: ElementProps,
  runtime: Runtime.Runtime<never>
) {
  const cleanups: Array<() => void> = []

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue

    if (key.startsWith("on") && isEventHandler(value)) {
      // Event handler: wrap in runtime execution
      const eventName = key.slice(2).toLowerCase()
      const handler = value
      const listener = (event: Event) => {
        const effect = handler(event)
        Runtime.runFork(runtime)(effect)
      }
      node.addEventListener(eventName, listener)
      cleanups.push(() => node.removeEventListener(eventName, listener))
    } else if (Signal.isSignal(value)) {
      // Signal prop: fine-grained reactivity!
      // Read initial value and subscribe for updates
      const initialValue = yield* Signal.get(value)
      applyPropValue(node, key, initialValue)
      
      Debug.log({
        event: "render.signaltext.initial",
        signal_id: value._debugId,
        value: initialValue,
        element_tag: node.tagName.toLowerCase(),
        trigger: `prop:${key}`
      })
      
      // Subscribe to signal changes - update DOM directly
      // Using Runtime.runSync with captured runtime for sync callbacks
      const unsubscribe = Signal.subscribe(value, () => {
        Runtime.runSync(runtime)(
          Effect.gen(function* () {
            const newValue = yield* Signal.get(value)
            Debug.log({
              event: "render.signaltext.update",
              signal_id: value._debugId,
              value: newValue,
              element_tag: node.tagName.toLowerCase(),
              trigger: `prop:${key}`
            })
            applyPropValue(node, key, newValue)
          })
        )
      })
      cleanups.push(unsubscribe)
    } else {
      // Static prop value
      applyPropValue(node, key, value)
    }
  }

  return cleanups
})

/**
 * Render an Element to a DOM node
 * @internal
 */
const renderElement = (
  element: Element,
  parent: Node,
  runtime: Runtime.Runtime<never>
): Effect.Effect<RenderResult, unknown, Scope.Scope> =>
  Match.value(element).pipe(
    Match.tag("Text", ({ content }) =>
      Effect.sync(() => {
        const node = document.createTextNode(content)
        parent.appendChild(node)
        return {
          node,
          cleanup: Effect.sync(() => node.remove())
        }
      })
    ),

    Match.tag("SignalText", ({ signal }) =>
      Effect.gen(function* () {
        // Get initial value and create text node
        const initialValue = yield* Signal.get(signal)
        const node = document.createTextNode(String(initialValue))
        parent.appendChild(node)

        Debug.log({
          event: "render.signaltext.initial",
          signal_id: signal._debugId,
          value: initialValue
        })

        // Subscribe to signal changes for fine-grained updates
        // Using Runtime.runSync with captured runtime for sync callbacks
        const unsubscribe = Signal.subscribe(signal, () => {
          Runtime.runSync(runtime)(
            Effect.gen(function* () {
              const value = yield* Signal.get(signal)
              Debug.log({
                event: "render.signaltext.update",
                signal_id: signal._debugId,
                value: value
              })
              node.textContent = String(value)
            })
          )
        })

        return {
          node,
          cleanup: Effect.sync(() => {
            unsubscribe()
            node.remove()
          })
        }
      })
    ),

    Match.tag("Intrinsic", ({ tag, props, children }) =>
      Effect.gen(function* () {
        const node = document.createElement(tag)
        
        Debug.log({
          event: "render.intrinsic",
          element_tag: tag
        })

        // Apply props and get cleanup functions
        const propCleanups = yield* applyProps(node, props, runtime)

        // Render children
        const childResults: Array<RenderResult> = []
        for (const child of children) {
          const result = yield* renderElement(child, node, runtime)
          childResults.push(result)
        }

        parent.appendChild(node)

        return {
          node,
          cleanup: Effect.gen(function* () {
            // Clean up children first
            for (const child of childResults) {
              yield* child.cleanup
            }
            // Clean up props (event listeners)
            for (const cleanup of propCleanups) {
              cleanup()
            }
            // Remove node
            node.remove()
          })
        }
      })
    ),

    Match.tag("Component", ({ run }) =>
      Effect.gen(function* () {
        // Create the effect from the thunk
        const effect = run()
        
        // Create a placeholder comment as anchor for this component
        const anchor = document.createComment("component")
        parent.appendChild(anchor)

        // State for reactive re-rendering
        let currentResult: RenderResult | null = null
        let isRerendering = false
        let isUnmounted = false
        let pendingRerender = false  // Track if signal changed during re-render
        let renderCount = 0

        // Create render phase for this component (persists across re-renders)
        const renderPhase = yield* Signal.makeRenderPhase

        // Track active subscription cleanups
        let subscriptionCleanups: Array<() => void> = []

        // Helper to render and position content before the anchor
        // IMPORTANT: Use anchor.parentNode instead of captured parent because
        // when Component is inside a Fragment, the initial parent is a DocumentFragment
        // which becomes empty after appendChild. The anchor moves to the real parent.
        const renderAndPosition = Effect.fnUntraced(function* (
          childElement: Element
        ) {
          // Get the actual parent from the anchor's current location
          const actualParent = anchor.parentNode
          if (actualParent === null) {
            throw new Error("Component anchor has no parent - component may have been unmounted")
          }
          const result = yield* renderElement(childElement, actualParent, runtime)
          // Move rendered content before the anchor
          actualParent.insertBefore(result.node, anchor)
          return result
        })

        // Forward declaration for recursive scheduling
        let scheduleRerender: () => void

        // Function to perform the actual re-render
        const doRerender = (): void => {
          if (isUnmounted) {
            isRerendering = false
            pendingRerender = false
            return
          }

          renderCount++
          Debug.log({
            event: "render.component.rerender",
            trigger: "signal change",
            accessed_signals: renderPhase.accessed.size
          })

          // Re-render
          Runtime.runFork(runtime)(
            Effect.scoped(
              Effect.gen(function* () {
                // Clean up old render
                if (currentResult !== null) {
                  yield* currentResult.cleanup
                  currentResult = null
                }

                // Reset render phase for re-render
                yield* Signal.resetRenderPhase(renderPhase)

                // Re-execute the component effect with render phase context
                const newChildElement = yield* Effect.locally(
                  effect,
                  Signal.CurrentRenderPhase,
                  renderPhase
                )

                // Render and position new content
                currentResult = yield* renderAndPosition(newChildElement)
                
                // Check if another re-render was requested during this render
                const needsAnotherRender = pendingRerender
                isRerendering = false
                pendingRerender = false

                // Re-subscribe to signals (may be different set after re-render)
                yield* subscribeToSignals(renderPhase.accessed)

                // If a signal changed during re-render, schedule another re-render
                if (needsAnotherRender) {
                  scheduleRerender()
                }
              })
            ).pipe(
              Effect.tapErrorCause((cause) => 
                Effect.sync(() => {
                  Debug.log({
                    event: "render.component.rerender",
                    trigger: "error",
                    reason: String(cause)
                  })
                  isRerendering = false
                  pendingRerender = false
                })
              )
            )
          )
        }

        // Schedule a re-render via microtask
        scheduleRerender = () => {
          if (isUnmounted) return
          
          Debug.log({
            event: "render.schedule",
            is_rerendering: isRerendering,
            pending_rerender: pendingRerender,
            accessed_signals: renderPhase.accessed.size
          })
          
          if (isRerendering) {
            // Mark that we need another re-render after the current one completes
            pendingRerender = true
            return
          }
          
          isRerendering = true
          queueMicrotask(doRerender)
        }

        // Function to subscribe to accessed signals using sync callbacks
        const subscribeToSignals = (
          signals: Set<Signal.Signal<unknown>>
        ): Effect.Effect<void> =>
          Effect.sync(() => {
            // Clear old subscriptions
            const oldCleanups = subscriptionCleanups
            for (const cleanup of oldCleanups) {
              cleanup()
            }
            subscriptionCleanups = []

            if (signals.size === 0) return

            for (const signal of signals) {
              // Use sync callback subscription
              const unsubscribe = Signal.subscribe(signal, scheduleRerender)
              subscriptionCleanups.push(unsubscribe)
            }
          })

        // Execute the component effect with render phase context
        const childElement = yield* Effect.locally(
          effect,
          Signal.CurrentRenderPhase,
          renderPhase
        )

        // Render and position the content
        currentResult = yield* renderAndPosition(childElement)
        renderCount++
        
        Debug.log({
          event: "render.component.initial",
          accessed_signals: renderPhase.accessed.size
        })

        // Subscribe to accessed signals for reactivity
        yield* subscribeToSignals(renderPhase.accessed)

        return {
          node: anchor,
          cleanup: Effect.gen(function* () {
            isUnmounted = true
            // Clean up signal subscriptions
            for (const cleanup of subscriptionCleanups) {
              cleanup()
            }
            subscriptionCleanups = []
            // Clean up rendered content
            if (currentResult !== null) {
              yield* currentResult.cleanup
            }
            anchor.remove()
          })
        }
      })
    ),

    Match.tag("Fragment", ({ children }) =>
      Effect.gen(function* () {
        const fragment = document.createDocumentFragment()
        const childResults: Array<RenderResult> = []

        for (const child of children) {
          const result = yield* renderElement(child, fragment, runtime)
          childResults.push(result)
        }

        parent.appendChild(fragment)

        // Get first child result if available
        const maybeFirstChild = childResults[0]

        if (maybeFirstChild === undefined) {
          // Empty fragment: use a comment as anchor
          const emptyAnchor = document.createComment("fragment")
          parent.appendChild(emptyAnchor)
          return {
            node: emptyAnchor,
            cleanup: Effect.sync(() => emptyAnchor.remove())
          }
        }

        // Non-empty fragment: use first child's node as anchor
        return {
          node: maybeFirstChild.node,
          cleanup: Effect.gen(function* () {
            for (const child of childResults) {
              yield* child.cleanup
            }
          })
        }
      })
    ),

    Match.tag("Suspense", ({ deferred, fallback }) =>
      Effect.gen(function* () {
        // Create placeholder comment and keep parent reference
        const placeholder = document.createComment("suspense")
        const suspenseParent = parent
        suspenseParent.appendChild(placeholder)

        // Render fallback initially
        let currentResult = yield* renderElement(fallback, suspenseParent, runtime)

        // Fork a daemon fiber to wait for the deferred and swap content.
        // Using forkDaemon instead of forkScoped because the parent re-render
        // scope closes when re-render completes, which would interrupt the fiber
        // before the Deferred resolves. forkDaemon lets the fiber run independently.
        const waitFiber = yield* Effect.forkDaemon(
          Effect.scoped(
            Effect.gen(function* () {
              // Wait for the async content
              const resolvedElement = yield* Deferred.await(deferred)

              // Clean up fallback
              yield* currentResult.cleanup

              // Render resolved content (deferred resolves to Element)
              currentResult = yield* renderElement(
                resolvedElement,
                suspenseParent,
                runtime
              )
            })
          )
        )

        return {
          node: placeholder,
          cleanup: Effect.gen(function* () {
            // Interrupt the wait fiber if still running (cleanup before resolve)
            yield* Fiber.interrupt(waitFiber)
            yield* currentResult.cleanup
            placeholder.remove()
          })
        }
      })
    ),

    Match.tag("Portal", ({ target, children }) =>
      Effect.gen(function* () {
        // Resolve target
        const targetElement =
          typeof target === "string" ? document.querySelector(target) : target

        if (!targetElement) {
          return yield* new PortalTargetNotFoundError({ target })
        }

        // Render children into target
        const childResults: Array<RenderResult> = []
        for (const child of children) {
          const result = yield* renderElement(child, targetElement, runtime)
          childResults.push(result)
        }

        // Return a comment as anchor in original location
        const portalAnchor = document.createComment("portal")
        parent.appendChild(portalAnchor)

        return {
          node: portalAnchor,
          cleanup: Effect.gen(function* () {
            for (const child of childResults) {
              yield* child.cleanup
            }
            portalAnchor.remove()
          })
        }
      })
    ),

    Match.tag("KeyedList", ({ source, renderFn, keyFn }) =>
      Effect.gen(function* () {
        // Create anchor comment for the list
        const anchor = document.createComment("keyed-list")
        const listParent = parent
        listParent.appendChild(anchor)

        // Track item states by key: { renderPhase, result, node, index }
        type ItemState = {
          renderPhase: Signal.RenderPhase
          result: RenderResult
          node: Node
          item: unknown
          subscriptionCleanups: Array<() => void>
        }
        const itemStates = new Map<string | number, ItemState>()
        const keyOrder: Array<string | number> = []
        let isUnmounted = false

        // Helper to render a single item with a stable render phase
        const renderItem = Effect.fn("renderItem")(function* (
          item: unknown,
          index: number,
          existingPhase: Signal.RenderPhase | null
        ) {
          // Use existing phase or create new one
          const renderPhase = existingPhase ?? (yield* Signal.makeRenderPhase)
          
          if (existingPhase !== null) {
            // Reset for re-render
            yield* Signal.resetRenderPhase(renderPhase)
          }

          // Execute render function with render phase context
          const element = yield* Effect.locally(
            renderFn(item, index),
            Signal.CurrentRenderPhase,
            renderPhase
          )

          // Render the element
          const result = yield* renderElement(element, listParent, runtime)
          
          return { renderPhase, result }
        })

        // Function to update the list
        const updateList = (): void => {
          if (isUnmounted) return

          Debug.log({
            event: "render.keyedlist.update",
            current_keys: keyOrder.length
          })

          Runtime.runFork(runtime)(
            Effect.scoped(
              Effect.gen(function* () {
                // Get current items from source signal
                const items = yield* Signal.get(source)
                
                // Compute new keys
                const newKeys = items.map((item, i) => keyFn(item, i))
                const newKeySet = new Set(newKeys)
                
                // Remove items that are no longer in the list
                for (const key of keyOrder) {
                  if (!newKeySet.has(key)) {
                    const state = itemStates.get(key)
                    if (state) {
                      // Clean up subscriptions
                      for (const cleanup of state.subscriptionCleanups) {
                        cleanup()
                      }
                      // Clean up rendered content
                      yield* state.result.cleanup
                      itemStates.delete(key)
                    }
                  }
                }

                // Track new order for DOM positioning
                const newItemStates: Array<{ key: string | number; state: ItemState; isNew: boolean }> = []

                // Render new/update existing items
                for (let i = 0; i < items.length; i++) {
                  const item = items[i]
                  const key = newKeys[i]
                  
                  if (key === undefined) continue
                  
                  const existingState = itemStates.get(key)
                  
                  if (existingState !== undefined) {
                    // Item exists - check if item data changed
                    // For now, we keep the existing render (item identity preserved)
                    // Update the stored item reference
                    existingState.item = item
                    newItemStates.push({ key, state: existingState, isNew: false })
                  } else {
                    // New item - create new state
                    const { renderPhase, result } = yield* renderItem(item, i, null)
                    
                    // Set up subscriptions for this item's accessed signals
                    const subscriptionCleanups: Array<() => void> = []
                    for (const signal of renderPhase.accessed) {
                      const unsubscribe = Signal.subscribe(signal, () => {
                        // Re-render just this item when its signals change
                        if (isUnmounted) return
                        const currentState = itemStates.get(key)
                        if (currentState === undefined) return
                        
                        Runtime.runFork(runtime)(
                          Effect.scoped(
                            Effect.gen(function* () {
                              // Clean up old subscriptions
                              for (const cleanup of currentState.subscriptionCleanups) {
                                cleanup()
                              }
                              
                              // Re-render with same phase (preserves signals)
                              const { result: newResult } = yield* renderItem(
                                currentState.item,
                                i,
                                currentState.renderPhase
                              )
                              
                              // Replace old node with new
                              currentState.result.node.parentNode?.replaceChild(
                                newResult.node,
                                currentState.result.node
                              )
                              
                              // Clean up old render
                              yield* currentState.result.cleanup
                              
                              // Update state
                              currentState.result = newResult
                              currentState.node = newResult.node
                              
                              // Set up new subscriptions
                              currentState.subscriptionCleanups = []
                              for (const sig of currentState.renderPhase.accessed) {
                                const unsub = Signal.subscribe(sig, () => {
                                  // Trigger re-render (recursive, but that's ok)
                                  const state = itemStates.get(key)
                                  if (state) {
                                    // Just mark as needing update - will be handled by same mechanism
                                  }
                                })
                                currentState.subscriptionCleanups.push(unsub)
                              }
                            })
                          )
                        )
                      })
                      subscriptionCleanups.push(unsubscribe)
                    }
                    
                    const state: ItemState = {
                      renderPhase,
                      result,
                      node: result.node,
                      item,
                      subscriptionCleanups
                    }
                    itemStates.set(key, state)
                    newItemStates.push({ key, state, isNew: true })
                  }
                }

                // Reorder DOM nodes to match new order
                // Insert each node before the anchor, in order
                for (const { state } of newItemStates) {
                  listParent.insertBefore(state.node, anchor)
                }

                // Update key order
                keyOrder.length = 0
                for (const key of newKeys) {
                  if (key !== undefined) {
                    keyOrder.push(key)
                  }
                }
              })
            )
          )
        }

        // Initial render
        yield* Effect.sync(updateList)

        // Subscribe to source signal changes
        const unsubscribeSource = Signal.subscribe(source, updateList)

        return {
          node: anchor,
          cleanup: Effect.gen(function* () {
            isUnmounted = true
            unsubscribeSource()
            
            // Clean up all items
            for (const [, state] of itemStates) {
              for (const cleanup of state.subscriptionCleanups) {
                cleanup()
              }
              yield* state.result.cleanup
            }
            itemStates.clear()
            anchor.remove()
          })
        }
      })
    ),

    Match.exhaustive
  )

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
    const mountElement = Effect.fn("Renderer.mount")(
      function* (container: HTMLElement, element: Element) {
        const runtime = yield* Effect.runtime<never>()
        const scope = yield* Effect.scope

        // Set up render context
        yield* FiberRef.set(CurrentRenderContext, { runtime, scope })

        // Clear container
        container.innerHTML = ""

        // Render the element tree
        const result = yield* renderElement(element, container, runtime)

        // Register cleanup on scope finalization
        yield* Effect.addFinalizer(() => result.cleanup)
      }
    )

    const renderToParent = Effect.fn("Renderer.render")(
      function* (element: Element, parent: Node) {
        const runtime = yield* Effect.runtime<never>()
        return yield* renderElement(element, parent, runtime)
      }
    )

    return Renderer.of({ mount: mountElement, render: renderToParent })
  })
)

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
  app: Effect.Effect<Element, E, never>
) {
  const renderer = yield* Renderer
  
  // Wrap the app Effect in a Component element to enable reactive re-rendering
  // This is crucial for Signal-based reactivity to work
  const componentElement = Element.Component({
    run: () => app,
    key: null
  })
  
  yield* renderer.mount(container, componentElement)
  
  // Keep the app running forever - cleanup happens when interrupted
  return yield* Effect.never
})

/**
 * Check if a value is an Effect
 * @internal
 */
const isEffectValue = (value: unknown): value is Effect.Effect<Element, unknown, never> =>
  typeof value === "object" &&
  value !== null &&
  Effect.EffectTypeId in value

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
  app: Effect.Effect<Element, E, never> | Element
): void => {
  // Normalize to Effect
  const appEffect = isEffectValue(app) ? app : Effect.succeed(app)
  
  // Merge Renderer and Router layers - Router is included by default
  const appLayer = Layer.merge(browserLayer, Router.browserLayer)
  
  // Dynamic import to avoid bundling platform-browser for non-browser usage
  import("@effect/platform-browser/BrowserRuntime").then(({ runMain }) => {
    runMain(
      render(container, appEffect).pipe(
        Effect.scoped,
        Effect.provide(appLayer)
      )
    )
  })
}
