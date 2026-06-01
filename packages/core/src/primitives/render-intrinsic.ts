import { Effect, Fiber, Option, Predicate, Scope } from "effect";
import * as Context from "effect/Context";
import { Element, getKey, type ElementProps, type EventHandler } from "./element.js";
import * as Signal from "./signal.js";
import * as Trace from "../trace/index.js";
import {
  applyPropValue,
  clearPropValue,
  logBlockedSafeUrlAttribute,
  moveRange,
  resolveReconcileTarget,
  shallowPropsEqual,
} from "./render-utils.js";
import * as Head from "./head.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";
import { InvalidEventHandlerError } from "./renderer.js";
import { sharedRenderContextTransaction } from "./render-context-transaction.js";
import { sharedRenderTransaction } from "./render-transaction.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderIntrinsicDeps<E, R> {
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, E, R>;
  readonly renderDocumentElement: (
    tag: string,
    props: ElementProps,
    children: ReadonlyArray<Element>,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, E, R>;
  readonly runForkInRenderContext: <E2, R2>(
    effect: Effect.Effect<void, E2, R2>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => void;
}

type HeadHoistAction = Extract<Head.HoistAction, { readonly _tag: "head" }>;
type DocumentHoistAction = Extract<Head.HoistAction, { readonly _tag: "document" }>;

const isHeadHoistAction = (action: Head.HoistAction): action is HeadHoistAction =>
  Predicate.isTagged(action, "head");

const isDocumentHoistAction = (action: Head.HoistAction): action is DocumentHoistAction =>
  Predicate.isTagged(action, "document");

const isEventHandler = (value: unknown): value is EventHandler => typeof value === "function";

const isEffectProp = (value: unknown): value is Effect.Effect<unknown> => Effect.isEffect(value);

const omitMode = (props: ElementProps): ElementProps => {
  const { mode: _mode, ...domProps } = props;
  return domProps;
};

const SVG_TAGS = new Set([
  "svg",
  "path",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "rect",
  "g",
  "defs",
  "use",
  "text",
  "tspan",
  "image",
  "clipPath",
  "mask",
  "pattern",
  "linearGradient",
  "radialGradient",
  "stop",
  "symbol",
  "marker",
  "foreignObject",
]);

const createElement = (tag: string): globalThis.Element =>
  SVG_TAGS.has(tag)
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);

const clearRemovedProps = (
  node: globalThis.Element,
  currentProps: ElementProps,
  nextProps: ElementProps,
): void => {
  const nextEntries = Object.entries(nextProps);

  for (const [key] of Object.entries(currentProps)) {
    const hasDefinedNextValue = nextEntries.some(
      ([nextKey, nextValue]) => nextKey === key && nextValue !== undefined,
    );
    if (!hasDefinedNextValue) clearPropValue(node, key);
  }
};

const applyProps = Effect.fnUntraced(function* <E, R>(
  node: globalThis.Element,
  props: ElementProps,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  _deps: RenderIntrinsicDeps<E, R>,
) {
  const cleanups: Array<Effect.Effect<void>> = [];
  const contextTransaction = sharedRenderContextTransaction;
  const eventSnapshot = {
    ...renderContext,
    services:
      context === null ? renderContext.services : Context.merge(context, renderContext.services),
  };

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;

    if (key.startsWith("on")) {
      if (!isEventHandler(value)) {
        return yield* new InvalidEventHandlerError({ prop: key });
      }

      const eventName = key.slice(2).toLowerCase();
      const listener = (event: Event) => {
        const fiber = Effect.runForkWith(Context.empty())(
          contextTransaction.runEventHandler(eventSnapshot, value(event)),
        );
        Effect.runForkWith(Context.empty())(
          Scope.addFinalizer(eventSnapshot.scope, Fiber.interrupt(fiber)),
        );
      };
      node.addEventListener(eventName, listener);
      cleanups.push(Effect.sync(() => node.removeEventListener(eventName, listener)));
    } else if (Signal.isSignal(value)) {
      // peek (not get): this attribute binding owns its own subscription via
      // Signal.subscribe(value) below. Signal.get would subscribe the enclosing
      // component's render phase, re-rendering the whole component on every
      // attribute change instead of updating this attribute in place.
      const initialValue = yield* Signal.peek(value);
      const blocked = applyPropValue(node, key, initialValue, renderContext.safeUrlConfig);
      if (Option.isSome(blocked)) {
        yield* logBlockedSafeUrlAttribute(blocked.value);
      }

      yield* Trace.emit("signalText.initial", () => ({
        signal_id: value._debugId,
        value: initialValue,
        element_tag: node.tagName.toLowerCase(),
        trigger: `prop:${key}`,
      }));

      const unsubscribe = yield* Signal.subscribe(value, () =>
        Effect.gen(function* () {
          // peek (not get): subscription already owned; never re-subscribe an
          // ambient render phase when reading the updated value.
          const newValue = yield* Signal.peek(value);
          yield* Trace.emit("signalText.update", () => ({
            signal_id: value._debugId,
            value: newValue,
            element_tag: node.tagName.toLowerCase(),
            trigger: `prop:${key}`,
          }));
          const blocked = applyPropValue(node, key, newValue, renderContext.safeUrlConfig);
          if (Option.isSome(blocked)) {
            yield* logBlockedSafeUrlAttribute(blocked.value);
          }
        }),
      );
      cleanups.push(unsubscribe);
    } else if (isEffectProp(value)) {
      const resolved = yield* value;
      if (Signal.isSignal(resolved)) {
        // peek (not get): binding owns its subscription below; do not subscribe
        // the enclosing component's render phase to this resolved signal.
        const initialValue = yield* Signal.peek(resolved);
        const blocked = applyPropValue(node, key, initialValue, renderContext.safeUrlConfig);
        if (Option.isSome(blocked)) {
          yield* logBlockedSafeUrlAttribute(blocked.value);
        }

        const unsubscribe = yield* Signal.subscribe(resolved, () =>
          Effect.gen(function* () {
            // peek (not get): subscription already owned; never re-subscribe an
            // ambient render phase when reading the updated value.
            const newValue = yield* Signal.peek(resolved);
            const blocked = applyPropValue(node, key, newValue, renderContext.safeUrlConfig);
            if (Option.isSome(blocked)) {
              yield* logBlockedSafeUrlAttribute(blocked.value);
            }
          }),
        );
        cleanups.push(unsubscribe);
      } else {
        const blocked = applyPropValue(node, key, resolved, renderContext.safeUrlConfig);
        if (Option.isSome(blocked)) {
          yield* logBlockedSafeUrlAttribute(blocked.value);
        }
      }
    } else {
      const blocked = applyPropValue(node, key, value, renderContext.safeUrlConfig);
      if (Option.isSome(blocked)) {
        yield* logBlockedSafeUrlAttribute(blocked.value);
      }
    }
  }

  return cleanups;
});

type IntrinsicElement = Extract<Element, { readonly _tag: "Intrinsic" }>;

interface StaticEventBinding {
  readonly eventName: string;
  readonly listener: EventListener;
}

/**
 * A synchronously-built static subtree, retained so it can later reconcile in
 * place (update text/props, preserve node identity) without re-entering the
 * Effect renderer. Mirrors, for the static subset, the state `renderIntrinsic`
 * closes over: the current source element, the applied (mode-omitted) props, the
 * live event-listener bindings, and the per-child built records.
 */
interface StaticBuilt {
  readonly node: globalThis.Element;
  element: IntrinsicElement;
  props: ElementProps;
  listeners: Array<StaticEventBinding>;
  /** Synchronous unsubscribes for this node's signal-attribute bindings. */
  unsubscribes: Array<() => void>;
  readonly children: Array<StaticChild>;
  /**
   * True when this node or any descendant element holds signal-attribute
   * unsubscribes. Lets {@link cleanupStaticBuilt} skip the teardown walk entirely
   * for fully-static subtrees (the keyed-list row common case), where the only
   * cleanup work — dropping DOM event listeners — is handled for free by the
   * browser when the discarded node is collected. Recomputed on every reconcile
   * (props re-application can add/remove signal-attribute unsubscribes), so it is
   * mutable rather than readonly.
   */
  subtreeHasUnsubscribes: boolean;
}

type StaticChild =
  | { readonly kind: "text"; readonly node: Text }
  | { readonly kind: "element"; readonly built: StaticBuilt };

/**
 * Are every prop on this element applicable synchronously (no `yield*`)?
 *
 * Synchronously-applicable props are plain values (`applyPropValue`, pure DOM
 * writes), event handlers (`addEventListener`, also pure), and signal attribute
 * bindings — a signal's initial value is read with `Signal.peekValueUnsafe` and
 * its subscription installed with `Signal.subscribeUnsafe`, both synchronous
 * (the Effect `Signal.peek`/`Signal.subscribe` only wrap those with tracing).
 * `Effect` props need a render-time `yield*` to resolve; `href`/`src` can be
 * blocked by the safe-url validator, whose `Trace.emit` log is an Effect. Those
 * two disqualify the element from the synchronous fast path.
 */
const isStaticProps = (props: ElementProps): boolean => {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    // href/src run the safe-url validator, whose blocked branch logs via Effect
    // (true for plain *and* signal values, hence checked before the signal case).
    if (key === "href" || key === "src") return false;
    if (key.startsWith("on")) {
      // Non-function `on*` is an InvalidEventHandlerError — leave it to the Effect
      // path so the error is raised faithfully instead of silently fast-pathed.
      if (!isEventHandler(value)) return false;
      continue;
    }
    // Signal attribute binding: subscription installs synchronously below.
    if (Signal.isSignal(value)) continue;
    if (isEffectProp(value)) return false;
  }
  return true;
};

/**
 * Can this whole subtree be built with a single synchronous pass — no `yield*`?
 *
 * True iff the element is a plain (non-hoistable) intrinsic whose props are all
 * synchronously-applicable (see {@link isStaticProps} — plain values, event
 * handlers, signal *attribute* bindings) and whose every child is either static
 * `Text` or a recursively-sync-buildable, **unkeyed** intrinsic. Signal/Effect
 * *children*, components, fragments, keyed children, head-hoist tags, etc. each
 * require the Effect renderer and force the normal path. The element's *own* key
 * is not inspected here: a keyed element is still sync-buildable because its
 * parent wraps it in child-slot markers (see `renderChildSlot`); only *children*
 * must be unkeyed so the parent's plain non-keyed child handling stays valid.
 *
 * @internal
 */
export const isStaticIntrinsic = (element: Element): boolean => {
  if (!Predicate.isTagged(element, "Intrinsic")) return false;
  if (Head.isHoistCandidate(element.tag)) return false;
  if (!isStaticProps(element.props)) return false;
  for (const child of element.children) {
    if (Predicate.isTagged(child, "Text")) continue;
    if (!Predicate.isTagged(child, "Intrinsic")) return false;
    if (child.key !== null) return false;
    if (!isStaticIntrinsic(child)) return false;
  }
  return true;
};

/**
 * The render-context snapshot an event listener closes over. `runEventHandler`
 * reads only `scope` (owns the in-flight handler fiber's finalizer) and
 * `services` (what the handler runs under), but the transaction types the
 * parameter as a full `RenderContext`, so the snapshot stays a full spread with
 * `services` overridden by the merged context. Built once per build/clone unit
 * and reused across that unit's nodes rather than re-merged per node.
 */
const makeEventSnapshot = (
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): RenderContext => ({
  ...renderContext,
  services:
    context === null ? renderContext.services : Context.merge(context, renderContext.services),
});

/**
 * Apply a single synchronously-applicable prop to a node — the per-entry core of
 * {@link applyStaticProps}, factored out as the single source of truth for the
 * sync prop subset. The caller passes the once-per-unit
 * `contextTransaction`/`eventSnapshot` so they are not recomputed per node.
 * `value` is assumed defined and non-(href|src) (the static fast-path
 * invariants); event handlers are assumed functions and signals real signals
 * (verified by `isStaticProps` before this is reached).
 */
const applyStaticPropEntry = (
  node: globalThis.Element,
  key: string,
  value: unknown,
  listeners: Array<StaticEventBinding>,
  unsubscribes: Array<() => void>,
  renderContext: RenderContext,
  contextTransaction: typeof sharedRenderContextTransaction,
  eventSnapshot: RenderContext,
): void => {
  if (key.startsWith("on")) {
    if (!isEventHandler(value)) return;
    const eventName = key.slice(2).toLowerCase();
    const listener = (event: Event) => {
      const fiber = Effect.runForkWith(Context.empty())(
        contextTransaction.runEventHandler(eventSnapshot, value(event)),
      );
      Effect.runForkWith(Context.empty())(
        Scope.addFinalizer(eventSnapshot.scope, Fiber.interrupt(fiber)),
      );
    };
    node.addEventListener(eventName, listener);
    listeners.push({ eventName, listener });
  } else if (Signal.isSignal(value)) {
    // Signal attribute binding: mirror `applyProps`' signal branch with the
    // synchronous cores. peek (not get): this binding owns its subscription, so
    // it must not subscribe an enclosing component's render phase. Non-(href|src)
    // by `isStaticProps`, so `applyPropValue` never blocks (always `none`).
    const signal = value;
    applyPropValue(node, key, Signal.peekValueUnsafe(signal), renderContext.safeUrlConfig);
    const updateEffect = Effect.sync(() => {
      applyPropValue(node, key, Signal.peekValueUnsafe(signal), renderContext.safeUrlConfig);
    });
    const update: Signal.SignalListener = () => updateEffect;
    unsubscribes.push(Signal.subscribeUnsafe(signal, update));
  } else {
    // Guaranteed non-(href|src) by `isStaticProps`, so the safe-url validator
    // never blocks here — `applyPropValue` always returns `none`.
    applyPropValue(node, key, value, renderContext.safeUrlConfig);
  }
};

/**
 * Apply synchronously-applicable props to a node, recording event-listener
 * bindings and signal-subscription unsubscribes so they can be torn down on
 * cleanup/reconcile. Shared by build and reconcile so both apply props
 * identically (single source of truth for the sync subset of `applyProps`).
 */
const applyStaticProps = (
  node: globalThis.Element,
  props: ElementProps,
  listeners: Array<StaticEventBinding>,
  unsubscribes: Array<() => void>,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): void => {
  const contextTransaction = sharedRenderContextTransaction;
  const eventSnapshot = makeEventSnapshot(renderContext, context);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    applyStaticPropEntry(
      node,
      key,
      value,
      listeners,
      unsubscribes,
      renderContext,
      contextTransaction,
      eventSnapshot,
    );
  }
};

/**
 * Synchronously build a verified-static intrinsic subtree, mirroring
 * `renderIntrinsic` + `applyProps` for the static subset. Returns the retained
 * {@link StaticBuilt} record (node + props + listeners + child records) so the
 * subtree can later reconcile in place. Children are appended directly — no
 * Effect dispatch, no per-child markers.
 */
const buildStaticElement = (
  element: IntrinsicElement,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): StaticBuilt => {
  const node = createElement(element.tag);
  const props = element.props.mode !== undefined ? omitMode(element.props) : element.props;
  const listeners: Array<StaticEventBinding> = [];
  const unsubscribes: Array<() => void> = [];
  applyStaticProps(node, props, listeners, unsubscribes, renderContext, context);

  // Track whether this subtree carries any signal-attribute unsubscribes so
  // teardown can early-out; the per-child check is a single boolean OR (no
  // allocation, no native call) and never touches the create hot path measurably.
  let subtreeHasUnsubscribes = unsubscribes.length > 0;
  const children: Array<StaticChild> = [];
  for (const child of element.children) {
    if (Predicate.isTagged(child, "Text")) {
      const textNode = document.createTextNode(child.content);
      node.appendChild(textNode);
      children.push({ kind: "text", node: textNode });
    } else if (Predicate.isTagged(child, "Intrinsic")) {
      // Verified static intrinsic by `isStaticIntrinsic`.
      const childBuilt = buildStaticElement(child, renderContext, context);
      node.appendChild(childBuilt.node);
      children.push({ kind: "element", built: childBuilt });
      if (childBuilt.subtreeHasUnsubscribes) subtreeHasUnsubscribes = true;
    }
  }

  return { node, element, props, listeners, unsubscribes, children, subtreeHasUnsubscribes };
};

/**
 * Tear down a built static subtree on removal (the node is being discarded, NOT
 * reconciled — the reconcile path swaps listeners via its own inline loop).
 *
 * We deliberately do NOT `removeEventListener` here: the node is detached and
 * dropped, so the browser reclaims its DOM event listeners when it collects the
 * node — exactly what vanilla/Solid rely on. Explicitly unbinding each listener
 * is redundant native work (it dominated the clear1k window for 1k rows). Only
 * signal-attribute unsubscribes hold external refs (the signal's subscriber set)
 * and MUST run; `subtreeHasUnsubscribes` lets a fully-static subtree — the keyed
 * row common case — skip the walk entirely.
 */
const cleanupStaticBuilt = (built: StaticBuilt): void => {
  if (!built.subtreeHasUnsubscribes) return;
  for (const unsubscribe of built.unsubscribes) unsubscribe();
  for (const child of built.children) {
    if (child.kind === "element") cleanupStaticBuilt(child.built);
  }
};

/**
 * Reconcile a built static subtree against the next (already verified-static)
 * element in place, preserving node identity. Updates changed text content,
 * re-applies changed props (tearing down + re-binding event listeners, matching
 * `renderIntrinsic`'s reconcile which re-applies whenever `shallowPropsEqual` is
 * false). Returns `false` on any structural divergence (different tag/key, child
 * count, or child kind) so the caller falls back to a replace.
 */
const reconcileStaticBuilt = (
  built: StaticBuilt,
  nextElement: IntrinsicElement,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): boolean => {
  if (nextElement.tag !== built.element.tag) return false;
  if (nextElement.key !== built.element.key) return false;

  // `flagDirty` tracks whether the teardown-skip flag (`subtreeHasUnsubscribes`)
  // could have changed during this reconcile. It only changes when this node's
  // own unsubscribes are re-derived (the props-changed branch below) or when a
  // child reconcile flips the child's flag. In the common keyed-list reconcile
  // (update10th: text-only change; swap: no change) neither happens, so the
  // recompute at the end is skipped entirely — the flag is invariant.
  let flagDirty = false;

  const nextProps =
    nextElement.props.mode !== undefined ? omitMode(nextElement.props) : nextElement.props;
  if (!shallowPropsEqual(built.props, nextProps)) {
    for (const { eventName, listener } of built.listeners) {
      built.node.removeEventListener(eventName, listener);
    }
    built.listeners = [];
    for (const unsubscribe of built.unsubscribes) unsubscribe();
    built.unsubscribes = [];
    clearRemovedProps(built.node, built.props, nextProps);
    applyStaticProps(
      built.node,
      nextProps,
      built.listeners,
      built.unsubscribes,
      renderContext,
      context,
    );
    built.props = nextProps;
    flagDirty = true; // own unsubscribes may have been added/removed
  }

  const nextChildren = nextElement.children;
  if (nextChildren.length !== built.children.length) return false;
  for (let index = 0; index < nextChildren.length; index++) {
    const nextChild = nextChildren[index];
    const childBuilt = built.children[index];
    if (nextChild === undefined || childBuilt === undefined) return false;

    if (Predicate.isTagged(nextChild, "Text")) {
      if (childBuilt.kind !== "text") return false;
      if (childBuilt.node.data !== nextChild.content) childBuilt.node.data = nextChild.content;
    } else if (Predicate.isTagged(nextChild, "Intrinsic")) {
      if (childBuilt.kind !== "element") return false;
      if (nextChild.key !== null) return false;
      const childFlagBefore = childBuilt.built.subtreeHasUnsubscribes;
      if (!reconcileStaticBuilt(childBuilt.built, nextChild, renderContext, context)) return false;
      if (childBuilt.built.subtreeHasUnsubscribes !== childFlagBefore) flagDirty = true;
    } else {
      return false;
    }
  }

  // Re-derive the teardown-skip flag only when something above could have
  // changed it. A stale `false` would skip a live unsubscribe (leak); a stale
  // `true` only costs a redundant teardown walk — but since we recompute exactly
  // when an input changed, the value stays exact. Skipping this scan on the
  // unchanged path is the hot-path win (update10th / swap touch nothing here).
  if (flagDirty) {
    let subtreeHasUnsubscribes = built.unsubscribes.length > 0;
    if (!subtreeHasUnsubscribes) {
      for (const child of built.children) {
        if (child.kind === "element" && child.built.subtreeHasUnsubscribes) {
          subtreeHasUnsubscribes = true;
          break;
        }
      }
    }
    built.subtreeHasUnsubscribes = subtreeHasUnsubscribes;
  }

  built.element = nextElement;
  return true;
};

/**
 * Wrap a built {@link StaticBuilt} root in the {@link RenderResult} the static
 * fast-path returns: append the root to its parent and expose the synchronous
 * cleanup/reconcile pair, producing an in-place-reconcilable result for the
 * from-scratch build ({@link buildStaticIntrinsicSync}).
 */
const makeStaticRenderResult = (
  root: StaticBuilt,
  parent: Node,
  renderContext: RenderContext,
): RenderResult => {
  parent.appendChild(root.node);
  // Detach the root first (single DOM mutation), then drop listeners — same
  // ordering rationale as the Effect path's cleanup. Shared by both the Effect
  // `cleanup` and the synchronous `cleanupSync` fast-path core.
  //
  // `detached === true` signals the caller already pulled this node off-document
  // as part of a batched range extraction (the keyed-list full-clear path): the
  // root .remove() would then only re-detach the node inside the throwaway
  // fragment, so skip it. Listener/subscription teardown via cleanupStaticBuilt
  // still runs (and itself early-outs for fully-static subtrees).
  const cleanupSync = (detached?: boolean): void => {
    if (detached !== true) root.node.remove();
    cleanupStaticBuilt(root);
  };
  return {
    node: root.node,
    cleanup: Effect.sync(() => cleanupSync()),
    cleanupSync,
    reconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) =>
      Effect.sync(() => {
        const resolved = resolveReconcileTarget(nextElement, nextContext);
        if (!Predicate.isTagged(resolved.element, "Intrinsic")) return false;
        // Only reconcile static→static; a next subtree that introduces a
        // signal/component/etc. must replace so the Effect renderer takes over.
        if (!isStaticIntrinsic(resolved.element)) return false;
        return reconcileStaticBuilt(root, resolved.element, renderContext, resolved.context);
      }),
  } satisfies RenderResult;
};

/**
 * Synchronous core of the fully-static intrinsic fast-path: builds the entire
 * subtree with direct DOM calls and returns a {@link RenderResult} as plain JS —
 * no enclosing `Effect.sync`, no run-loop step. Callers that already run inside a
 * synchronous frame (the keyed-list per-row create/replace driver) compose this
 * directly, avoiding a per-row `Effect.sync` primitive allocation + dispatch.
 * The returned cleanup and reconcile are still synchronous (`Effect.sync`):
 * cleanup detaches the root then drops every descendant listener; reconcile
 * updates text/props in place when the next element is still fully static, else
 * returns `false` to fall back to a replace.
 *
 * @internal
 */
export const buildStaticIntrinsicSync = (
  element: IntrinsicElement,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): RenderResult =>
  makeStaticRenderResult(
    buildStaticElement(element, renderContext, context),
    parent,
    renderContext,
  );

/**
 * Fast path for fully-static intrinsic subtrees: one `Effect.sync` wrapping
 * {@link buildStaticIntrinsicSync}, bypassing the per-element
 * `Effect.fnUntraced`/`makePrimitive`/context-read machinery the Effect renderer
 * pays for each node. Used by the effectful `renderElement` dispatch; the
 * keyed-list create path calls the synchronous core directly instead.
 *
 * @internal
 */
export const buildStaticIntrinsic = (
  element: IntrinsicElement,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): Effect.Effect<RenderResult> =>
  Effect.sync(() => buildStaticIntrinsicSync(element, parent, renderContext, context));

export const renderIntrinsic = Effect.fnUntraced(function* <E, R>(
  tag: string,
  props: ElementProps,
  children: ReadonlyArray<Element>,
  key: ReturnType<typeof getKey>,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderIntrinsicDeps<E, R>,
) {
  // Fast path: only head-hoistable / document-shell tags can ever produce a
  // hoist action. For every plain element (`<div>`/`<tr>`/`<td>`/…) skip the
  // hoist closure allocation and its `Effect.gen` (two fiber-ref reads + option
  // alloc) entirely — `maybeHoist` would provably return `none` for them.
  const hoistAction: Option.Option<Head.HoistAction> = Head.isHoistCandidate(tag)
    ? yield* Head.makeHeadHoist().maybeHoist(tag, props)
    : Option.none();
  if (Option.isSome(hoistAction) && isDocumentHoistAction(hoistAction.value)) {
    return yield* deps.renderDocumentElement(
      tag,
      hoistAction.value.props,
      children,
      parent,
      renderContext,
      context,
      options,
    );
  }

  const node = createElement(tag);
  const renderTransaction = sharedRenderTransaction;

  yield* Trace.emit("intrinsic.render", () => ({ element_tag: tag }));

  const domProps = props.mode !== undefined ? omitMode(props) : props;
  const appliedProps =
    Option.isSome(hoistAction) && isHeadHoistAction(hoistAction.value)
      ? hoistAction.value.props
      : domProps;

  let currentProps = appliedProps;
  let propCleanups = yield* applyProps(node, currentProps, renderContext, context, deps);
  const isHeadHoist = Option.isSome(hoistAction) && isHeadHoistAction(hoistAction.value);
  if (!isHeadHoist) parent.appendChild(node);

  type ChildSlot = {
    readonly key: ReturnType<typeof getKey>;
    readonly startMarker: Comment;
    readonly endMarker: Comment;
    readonly result: RenderResult;
  };

  const hasKeyedChildren = children.some((child) => getKey(child) !== null);
  const childrenAnchor = hasKeyedChildren ? document.createComment("children-end") : null;
  if (childrenAnchor !== null) node.appendChild(childrenAnchor);

  const cleanupChildSlot = Effect.fnUntraced(function* (slot: ChildSlot) {
    yield* renderTransaction.cleanup(slot.result);
    slot.startMarker.remove();
    slot.endMarker.remove();
  });

  const renderChildSlot = Effect.fnUntraced(function* (
    child: Element,
    childContext: Context.Context<unknown> | null,
  ) {
    const fragment = document.createDocumentFragment();
    const startMarker = document.createComment("child-start");
    fragment.appendChild(startMarker);
    const result = yield* deps.renderElement(child, fragment, renderContext, childContext, options);
    const endMarker = document.createComment("child-end");
    fragment.appendChild(endMarker);
    if (childrenAnchor === null) {
      node.appendChild(fragment);
    } else {
      node.insertBefore(fragment, childrenAnchor);
    }

    return { key: getKey(child), startMarker, endMarker, result } satisfies ChildSlot;
  });

  const childResults: Array<RenderResult> = [];
  let childSlots: Array<ChildSlot> = [];

  const cleanupProgressiveNode = Effect.gen(function* () {
    if (hasKeyedChildren) {
      for (const childSlot of childSlots) yield* cleanupChildSlot(childSlot);
    } else {
      for (const child of childResults) yield* renderTransaction.cleanup(child);
    }
    for (const cleanup of propCleanups) yield* cleanup;
    node.remove();
  }).pipe(Effect.catchCause(() => Effect.void));

  if (hasKeyedChildren) {
    for (const child of children) {
      childSlots.push(
        yield* renderChildSlot(child, context).pipe(Effect.onError(() => cleanupProgressiveNode)),
      );
    }
  } else {
    for (const child of children) {
      childResults.push(
        yield* deps
          .renderElement(child, node, renderContext, context, options)
          .pipe(Effect.onError(() => cleanupProgressiveNode)),
      );
    }
  }

  if (Option.isSome(hoistAction) && isHeadHoistAction(hoistAction.value)) {
    if (node instanceof HTMLElement) {
      yield* hoistAction.value.mount(node);
    }
    const anchor = document.createComment(`head:${tag}`);
    parent.appendChild(anchor);

    return {
      node: anchor,
      cleanup: Effect.gen(function* () {
        if (hasKeyedChildren) {
          for (const childSlot of childSlots) yield* cleanupChildSlot(childSlot);
        } else {
          for (const child of childResults) yield* renderTransaction.cleanup(child);
        }
        for (const cleanup of propCleanups) yield* cleanup;
        anchor.remove();
      }),
    } satisfies RenderResult;
  }

  return {
    node,
    cleanup: Effect.gen(function* () {
      // Detach this subtree's root from the document FIRST, as a single
      // synchronous DOM mutation, BEFORE recursing into child/prop cleanup.
      // Child cleanup is an Effect that `yield*`s once per child — every yield is
      // a scheduler boundary where the browser can paint, so cleaning up children
      // while still attached makes a large subtree disappear node-by-node (a
      // 60-line code block visibly tearing down line-by-line under load). Removing
      // `node` up front means every descendant removal happens off-document and is
      // never painted; the outermost intrinsic in any torn-down subtree thus
      // vanishes atomically and the inner `node.remove()`s become no-ops.
      node.remove();
      if (hasKeyedChildren) {
        for (const childSlot of childSlots) yield* cleanupChildSlot(childSlot);
      } else {
        for (const child of childResults) yield* renderTransaction.cleanup(child);
      }
      for (const cleanup of propCleanups) yield* cleanup;
    }),
    reconcile: Effect.fnUntraced(function* (
      nextElement: Element,
      nextContext: Context.Context<unknown> | null,
    ) {
      const resolved = resolveReconcileTarget(nextElement, nextContext);
      const resolvedNextElement = resolved.element;
      const resolvedNextContext = resolved.context;

      if (!Predicate.isTagged(resolvedNextElement, "Intrinsic")) return false;
      if (resolvedNextElement.tag !== tag || resolvedNextElement.key !== key) return false;

      const nextProps =
        resolvedNextElement.props.mode !== undefined
          ? omitMode(resolvedNextElement.props)
          : resolvedNextElement.props;

      if (!shallowPropsEqual(currentProps, nextProps)) {
        for (const cleanup of propCleanups) yield* cleanup;
        clearRemovedProps(node, currentProps, nextProps);
        propCleanups = yield* applyProps(node, nextProps, renderContext, resolvedNextContext, deps);
        currentProps = nextProps;
      }

      if (!hasKeyedChildren) {
        if (resolvedNextElement.children.length !== childResults.length) return false;

        for (let index = 0; index < childResults.length; index++) {
          const childResult = childResults[index];
          const nextChild = resolvedNextElement.children[index];
          if (
            childResult === undefined ||
            nextChild === undefined ||
            childResult.reconcile === undefined
          ) {
            return false;
          }
          const outcome = yield* renderTransaction.reconcile({
            previous: childResult,
            nextElement: nextChild,
            nextContext: resolvedNextContext,
            context: renderContext,
          });
          if (!Predicate.isTagged(outcome, "Reconciled")) return false;
        }

        return true;
      }

      if (childrenAnchor === null) return false;

      const keyedIndices = new Map<string | number, number>();
      childSlots.forEach((slot, index) => {
        if (slot.key !== null && !keyedIndices.has(slot.key)) keyedIndices.set(slot.key, index);
      });

      const usedIndices = new Set<number>();
      const nextSlots: Array<ChildSlot> = [];

      const tryReuse = Effect.fnUntraced(function* (
        nextChild: Element,
        slotIndex: number | undefined,
      ) {
        if (slotIndex === undefined || usedIndices.has(slotIndex)) return false;
        const slot = childSlots[slotIndex];
        if (slot === undefined || slot.result.reconcile === undefined) return false;
        const outcome = yield* renderTransaction.reconcile({
          previous: slot.result,
          nextElement: nextChild,
          nextContext: resolvedNextContext,
          context: renderContext,
        });
        if (!Predicate.isTagged(outcome, "Reconciled")) return false;
        usedIndices.add(slotIndex);
        nextSlots.push(slot);
        return true;
      });

      for (let index = 0; index < resolvedNextElement.children.length; index++) {
        const nextChild = resolvedNextElement.children[index];
        if (nextChild === undefined) continue;

        const nextKey = getKey(nextChild);
        const reused =
          nextKey !== null
            ? yield* tryReuse(nextChild, keyedIndices.get(nextKey))
            : yield* tryReuse(nextChild, index);
        if (!reused) nextSlots.push(yield* renderChildSlot(nextChild, resolvedNextContext));
      }

      let beforeRef: Node = childrenAnchor;
      for (let index = nextSlots.length - 1; index >= 0; index--) {
        const slot = nextSlots[index];
        if (slot === undefined) continue;
        moveRange(slot.startMarker, slot.endMarker, beforeRef);
        beforeRef = slot.startMarker;
      }

      for (let index = 0; index < childSlots.length; index++) {
        const slot = childSlots[index];
        if (slot !== undefined && !usedIndices.has(index)) yield* cleanupChildSlot(slot);
      }

      childSlots = nextSlots;
      return true;
    }),
  } satisfies RenderResult;
});
