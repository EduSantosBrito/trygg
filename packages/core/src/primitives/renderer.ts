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
import { Cause, Effect, Layer, Option, Predicate, Schema, Scheduler, Scope } from "effect";
import * as Context from "effect/Context";
import { Element, type ElementProps, type ElementWithRequirements } from "./element.js";
import * as Signal from "./signal.js";
import * as Trace from "../trace/index.js";
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
import {
  buildStaticIntrinsic,
  buildStaticIntrinsicSync,
  isStaticIntrinsic,
  renderIntrinsic,
} from "./render-intrinsic.js";
import { renderComponent } from "./render-component.js";
import { renderKeyedList } from "./render-keyed-list.js";
import { renderSignalElement } from "./render-signal-element.js";
import { renderProvide } from "./render-provide.js";
import { renderFragment } from "./render-fragment.js";
import { renderPortal } from "./render-portal.js";
import { renderErrorBoundary } from "./render-error-boundary.js";

export { ComponentAnchorError } from "./render-component.js";
export { PortalTargetNotFoundError } from "./render-portal.js";

type RuntimeRequirements = unknown;

const emptyContext = unsafeWidenContext(Context.empty());

const provideRenderContext = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  _renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): Effect.Effect<A, E, RuntimeRequirements> =>
  context === null ? effect : Effect.provide(effect, context);

// Synchronous fast path used by the keyed-list per-row create/replace driver: a
// fully-static intrinsic row builds inline (direct DOM, no `Effect.sync` +
// run-loop step), mirroring the `renderElement` Intrinsic branch exactly. Returns
// `null` for any element that needs the effectful renderer (signal/component/
// keyed children/head-hoist/etc.), so the caller falls back to `renderElement`.
const renderElementSync = (
  element: Element,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): RenderResult | null =>
  Predicate.isTagged(element, "Intrinsic") && isStaticIntrinsic(element)
    ? buildStaticIntrinsicSync(element, parent, renderContext, context)
    : null;

export class InvalidEventHandlerError extends Schema.TaggedErrorClass<InvalidEventHandlerError>()(
  "InvalidEventHandlerError",
  { prop: Schema.String },
) {
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
  effect: Effect.Effect<A, E, RuntimeRequirements>,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options?: { readonly preventSchedulerYield?: boolean },
): void => {
  const services = mergeRenderServices(renderContext, context);
  const forkServices =
    options?.preventSchedulerYield === true
      ? Context.add(services, Scheduler.PreventSchedulerYield, true)
      : services;

  Effect.runForkWith(forkServices)(effect.pipe(Scope.provide(renderContext.scope)));
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
  readonly cleanup: Effect.Effect<void, unknown, RuntimeRequirements>;
  /**
   * Synchronous cleanup core, present only when teardown is pure synchronous DOM
   * work (the static intrinsic fast-path). Equivalent in effect to running
   * {@link cleanup}, but callable as plain JS so batch teardown paths (keyed-list
   * clear) can dispose many rows in one `Effect.sync` instead of driving one
   * cleanup effect per row through the runtime. Absent ⇒ use {@link cleanup}.
   *
   * Pass `detached: true` when the node was already pulled off-document by a
   * batched range extraction (keyed-list full clear) so the redundant root
   * `.remove()` is skipped; subscription/listener teardown still runs.
   *
   * @internal
   */
  readonly cleanupSync?: (detached?: boolean) => void;
  readonly reconcile?: (
    nextElement: Element,
    nextContext: Context.Context<unknown> | null,
  ) => Effect.Effect<boolean, unknown, RuntimeRequirements>;
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
export class Renderer extends Context.Service<
  Renderer,
  {
    readonly mount: (
      container: HTMLElement,
      element: Element,
    ) => Effect.Effect<void, unknown, Scope.Scope>;
    readonly render: (
      element: Element,
      parent: Node,
    ) => Effect.Effect<RenderResult, unknown, Scope.Scope>;
  }
>()("@trygg/Renderer") {}

/**
 * Render a document-level element (html, head, body).
 * Maps to existing DOM nodes instead of creating new ones.
 * Only called when IsDocumentMount FiberRef is true.
 * @internal
 */
const renderDocumentElement = Effect.fn("renderDocumentElement")(function* (
  tag: string,
  props: ElementProps,
  children: ReadonlyArray<Element>,
  _parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
) {
  // Determine which existing DOM node to map to
  const targetNode =
    tag === "html" ? document.documentElement : tag === "head" ? document.head : document.body;

  // For <head>, children are rendered but hoisted by the Head service.
  // For <html> and <body>, attributes are applied and children are rendered into the target.
  const renderTarget = tag === "head" ? document.head : targetNode;

  yield* Trace.emit("document.render", () => ({
    element_tag: tag,
    target: targetNode.tagName,
  }));

  // Strip framework-specific 'mode' prop before applying
  const { mode: _mode, ...domProps } = props;

  // Apply attributes to the existing node (skip for <head> — no meaningful attrs)
  const appliedAttrs: Array<{ key: string; prev: string | null }> = [];
  const signalCleanups: Array<Effect.Effect<void>> = [];
  if (tag !== "head") {
    for (const [key, value] of Object.entries(domProps)) {
      if (key === "children" || key === "key") continue;
      const attrName = key === "className" ? "class" : key === "htmlFor" ? "for" : key;
      if (Signal.isSignal(value)) {
        // Signal-valued attribute: fine-grained reactivity on document elements
        const prev = targetNode.getAttribute(attrName);
        const initialValue = yield* Signal.get(value);
        const blocked = applyPropValue(targetNode, key, initialValue, renderContext.safeUrlConfig);
        if (Option.isSome(blocked)) {
          yield* logBlockedSafeUrlAttribute(blocked.value);
        }
        appliedAttrs.push({ key: attrName, prev });

        yield* Trace.emit("document.signal.initial", () => ({
          signal_id: value._debugId,
          value: initialValue,
          element_tag: tag,
          trigger: `prop:${key}`,
        }));

        const unsubscribe = yield* Signal.subscribe(value, () =>
          Effect.gen(function* () {
            const newValue = yield* Signal.get(value);
            yield* Trace.emit("document.signal.update", () => ({
              signal_id: value._debugId,
              value: newValue,
              element_tag: tag,
              trigger: `prop:${key}`,
            }));
            const blocked = applyPropValue(targetNode, key, newValue, renderContext.safeUrlConfig);
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
): Effect.Effect<RenderResult, unknown, RuntimeRequirements> => {
  // Dispatch on the element tag with a plain `switch` rather than `Match.value`:
  // `renderElement` is THE per-element hot path (called once per node — per row in
  // a keyed list), and the pipe form allocates and runs a 10-stage matcher on
  // every call. A switch is a jump table with the same lazy semantics (only the
  // matched branch's Effect is constructed) and no per-call matcher allocation.
  switch (element._tag) {
    case "Text": {
      const { content } = element;
      return Effect.sync(() => {
        const node = document.createTextNode(content);
        parent.appendChild(node);
        let currentContent = content;
        return {
          node,
          cleanup: Effect.sync(() => node.remove()),
          reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
            Effect.sync(() => {
              const resolved = resolveReconcileTarget(nextElement, nextContext);
              if (!Element.$is("Text")(resolved.element)) {
                return false;
              }

              if (resolved.element.content !== currentContent) {
                currentContent = resolved.element.content;
                node.textContent = currentContent;
              }

              return true;
            }),
        };
      });
    }

    case "SignalText": {
      const { signal } = element;
      return Effect.gen(function* () {
        // Get initial value and create text node
        const initialValue = yield* Signal.get(signal);
        const node = document.createTextNode(String(initialValue));
        parent.appendChild(node);
        let currentSignal = signal;

        yield* Trace.emit("signalText.initial", () => ({
          signal_id: signal._debugId,
          value: initialValue,
        }));

        // Subscribe to signal changes for fine-grained updates
        // Listener returns Effect which is run inside notifyListeners
        const unsubscribe = yield* Signal.subscribe(signal, () =>
          Effect.gen(function* () {
            const value = yield* Signal.get(signal);
            yield* Trace.emit("signalText.update", () => ({
              signal_id: signal._debugId,
              value: value,
            }));
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
              if (!Element.$is("SignalText")(resolved.element)) {
                return false;
              }

              return resolved.element.signal === currentSignal;
            }),
        };
      });
    }

    case "SignalElement":
      return renderSignalElement(
        element.signal,
        element.onSwap,
        parent,
        renderContext,
        context,
        options,
        {
          renderElement,
          runForkInRenderContext,
        },
      );

    case "Provide":
      return renderProvide(
        element.context,
        element.child,
        parent,
        renderContext,
        context,
        options,
        {
          renderElement,
        },
      );

    case "Intrinsic":
      // Fast path: a sync-buildable subtree (plain/event/signal-attribute props,
      // no signal/effect children, components, keyed children, or head-hoist) is
      // built by a single synchronous pass, skipping the per-element
      // Effect.fnUntraced/makePrimitive/context-read machinery.
      return isStaticIntrinsic(element)
        ? buildStaticIntrinsic(element, parent, renderContext, context)
        : renderIntrinsic(
            element.tag,
            element.props,
            element.children,
            element.key,
            parent,
            renderContext,
            context,
            options,
            {
              renderElement,
              renderDocumentElement,
              runForkInRenderContext,
            },
          );

    case "Component":
      return renderComponent(element, parent, renderContext, context, options, {
        renderElement,
        provideRenderContext,
        runForkInRenderContext,
        resolveReconcileTarget,
        normalizeContext,
      });

    case "Fragment":
      return renderFragment(element.children, parent, renderContext, context, options, {
        renderElement,
      });

    case "Portal":
      return renderPortal(
        element.target,
        element.children,
        parent,
        renderContext,
        context,
        options,
        { renderElement },
      );

    case "KeyedList":
      return renderKeyedList(
        element.source,
        element.renderFn,
        element.keyFn,
        parent,
        renderContext,
        context,
        options,
        {
          provideRenderContext,
          renderElement,
          renderElementSync,
          runForkInRenderContext,
        },
      );

    case "ErrorBoundaryElement":
      return renderErrorBoundary(
        element.child,
        element.fallback,
        element.onError,
        parent,
        renderContext,
        context,
        {
          defaultRenderOptions,
          emptyContext,
          renderElement,
          runForkInRenderContext,
        },
      );

    default: {
      // Exhaustiveness: every Element tag is handled above. If a new variant is
      // added without a branch here, `element` is no longer `never` and this errors.
      const _exhaustive: never = element;
      return _exhaustive;
    }
  }
};

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
const makeBrowserRenderer = Effect.fn("Renderer.browserLayer")(function* () {
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
});

/**
 * The browser `Renderer` layer — the DOM-backed implementation of the
 * {@link RendererService} contract.
 *
 * @remarks
 * Provide this layer to run an app against a real DOM. It wires the
 * DOM-specific renderer used by the higher-level `mount` / `render` helpers; on
 * non-browser platforms provide a different `Renderer` implementation instead.
 *
 * @example
 * ```ts
 * Effect.runFork(
 *   render(container, App).pipe(Effect.provide(browserLayer)),
 * )
 * ```
 *
 * @category Rendering
 * @public
 * @since 1.0.0
 */
export const browserLayer: Layer.Layer<Renderer> = Layer.effect(
  Renderer,
  makeBrowserRenderer().pipe(Effect.annotateLogs({ service: "Renderer" })),
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
  app: Effect.Effect<ElementWithRequirements<never>, E, never>,
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
const isEffectValue = (
  value: unknown,
): value is Effect.Effect<ElementWithRequirements<never>, unknown, never> => Effect.isEffect(value);

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
  app: Effect.Effect<ElementWithRequirements<never>, E, never> | ElementWithRequirements<never>,
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
export const renderDocument = Effect.fn("renderDocument")(function* <E>(
  app: Effect.Effect<ElementWithRequirements<never>, E, never>,
  options?: { readonly manifest?: RoutesManifest },
) {
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
});

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
  app: Effect.Effect<ElementWithRequirements<never>, E, never> | ElementWithRequirements<never>,
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
