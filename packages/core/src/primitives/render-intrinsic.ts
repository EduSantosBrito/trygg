import { Cause, Effect, Exit, Option, Predicate } from "effect";
import * as Context from "effect/Context";
import { Element, getKey, type ElementProps, type EventHandler } from "./element.js";
import * as Signal from "./signal.js";
import * as Trace from "../trace/index.js";
import {
  applyPropValue,
  clearPropValue,
  isUrlBearingAttributeName,
  logBlockedSafeUrlAttribute,
  moveRange,
  resolveReconcileTarget,
  shallowPropsEqual,
} from "./render-utils.js";
import * as Head from "./head.js";
import type {
  ErrorBoundaryHandler,
  RenderContext,
  RenderPreparation,
  RenderResult,
} from "./renderer.js";
import { InvalidEventHandlerError } from "./renderer.js";
import * as RenderContextTransaction from "./render-context-transaction.js";
import * as RenderTransaction from "./render-transaction.js";
import { cleanupAll, runOwnedRenderFiber } from "./render-cleanup.js";

interface RenderOptions {
  readonly preparation?: RenderPreparation | undefined;
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

const forkEventHandler = <R>(
  snapshot: RenderContext,
  handler: () => Effect.Effect<unknown, unknown, R>,
): void => {
  runOwnedRenderFiber(
    RenderContextTransaction.runEventHandler(snapshot, Effect.suspend(handler)),
    Context.empty(),
    snapshot.scope,
  );
};

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
  preparedValues?: ReadonlyMap<string, unknown>,
) {
  const cleanups: Array<Effect.Effect<void>> = [];
  let propertyValues: Map<string, unknown> | undefined;
  // Keep partial bindings reachable until the complete property set is handed
  // to the renderer. Cleanup failures remain in the failed acquisition's Cause.
  return yield* Effect.gen(function* () {
    const eventSnapshot = {
      ...renderContext,
      services:
        context === null ? renderContext.services : Context.merge(renderContext.services, context),
    };

    for (const [key, value] of Object.entries(props)) {
      if (value === undefined) continue;

      if (key.startsWith("on")) {
        if (!isEventHandler(value)) {
          return yield* new InvalidEventHandlerError({ prop: key });
        }

        const eventName = key.slice(2).toLowerCase();
        const listener = (event: Event) => {
          forkEventHandler(eventSnapshot, () => value(event));
        };
        cleanups.push(Effect.sync(() => node.removeEventListener(eventName, listener)));
        node.addEventListener(eventName, listener);
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
          value_type: Trace.valueType(initialValue),
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
              value_type: Trace.valueType(newValue),
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
        let resolved: unknown;
        if (preparedValues?.has(key)) {
          resolved = preparedValues.get(key);
        } else {
          resolved = yield* value;
          propertyValues ??= new Map(preparedValues);
          propertyValues.set(key, resolved);
        }
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

    return { cleanups, propertyValues: propertyValues ?? preparedValues };
  }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? cleanupAll(cleanups) : Effect.void)));
});

// A static compatibility check reads property values. Do not move accessor
// execution or host value conversion ahead of parent Effects during preparation.
const needsHostConversion = (value: unknown): boolean =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const needsHostPreparation = (element: Element): boolean => {
  if (Predicate.isTagged(element, "Provide")) return needsHostPreparation(element.child);
  if (Predicate.isTagged(element, "Intrinsic")) {
    for (const name in element.props) {
      const descriptor = Object.getOwnPropertyDescriptor(element.props, name);
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) return true;
      const value: unknown = descriptor?.value;
      if (!name.startsWith("on") && needsHostConversion(value)) return true;
    }
    return element.children.some(needsHostPreparation);
  }
  if (Predicate.isTagged(element, "Fragment")) return element.children.some(needsHostPreparation);
  return false;
};

type IntrinsicElement = Extract<Element, { readonly _tag: "Intrinsic" }>;

interface StaticRenderResult extends RenderResult {
  readonly cleanup: Effect.Effect<void>;
}

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
  /** Union of possibly applied properties after a failed native patch. */
  incompleteProps: ElementProps | undefined;
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
 * `Effect` props need a render-time `yield*` to resolve. URL-bearing props can
 * be blocked by the safe-url validator, whose `Trace.emit` log is an Effect, so
 * every attribute owned by that policy disqualifies the element from this path.
 */
const isStaticProps = (props: ElementProps): boolean => {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    // URL-bearing props run the safe-url validator, whose blocked branch logs
    // via Effect (also for signal values, hence checked before the signal case).
    if (isUrlBearingAttributeName(key)) return false;
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
 * `services` overridden by the merged context. Created for the first event
 * binding on a node and shared by that node's remaining event bindings.
 */
const makeEventSnapshot = (
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): RenderContext => ({
  ...renderContext,
  services:
    context === null ? renderContext.services : Context.merge(renderContext.services, context),
});

/**
 * Apply a single synchronously-applicable prop to a node — the per-entry core of
 * {@link applyStaticProps}, factored out as the single source of truth for the
 * sync prop subset. Returns the event snapshot, creating it only when an event
 * binding needs one, so nodes without handlers allocate no event context.
 * `value` is assumed defined and non-URL-bearing (the static fast-path
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
  context: Context.Context<unknown> | null,
  eventSnapshot: RenderContext | undefined,
): RenderContext | undefined => {
  if (key.startsWith("on")) {
    if (!isEventHandler(value)) return eventSnapshot;
    const snapshot = eventSnapshot ?? makeEventSnapshot(renderContext, context);
    const eventName = key.slice(2).toLowerCase();
    const listener = (event: Event) => {
      forkEventHandler(snapshot, () => value(event));
    };
    node.addEventListener(eventName, listener);
    listeners.push({ eventName, listener });
    return snapshot;
  } else if (Signal.isSignal(value)) {
    // Signal attribute binding: mirror `applyProps`' signal branch with the
    // synchronous cores. peek (not get): this binding owns its subscription, so
    // it must not subscribe an enclosing component's render phase. Non-URL-bearing
    // by `isStaticProps`, so `applyPropValue` never blocks (always `none`).
    const signal = value;
    applyPropValue(node, key, Signal.peekValueUnsafe(signal), renderContext.safeUrlConfig);
    const updateEffect = Effect.sync(() => {
      applyPropValue(node, key, Signal.peekValueUnsafe(signal), renderContext.safeUrlConfig);
    });
    const update: Signal.SignalListener = () => updateEffect;
    unsubscribes.push(Signal.subscribeUnsafe(signal, update));
  } else {
    // Guaranteed non-URL-bearing by `isStaticProps`, so the safe-url validator
    // never blocks here — `applyPropValue` always returns `none`.
    applyPropValue(node, key, value, renderContext.safeUrlConfig);
  }
  return eventSnapshot;
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
  let eventSnapshot: RenderContext | undefined;

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    eventSnapshot = applyStaticPropEntry(
      node,
      key,
      value,
      listeners,
      unsubscribes,
      renderContext,
      context,
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
const createStaticBuilt = (element: IntrinsicElement): StaticBuilt => ({
  node: createElement(element.tag),
  element,
  props: element.props.mode !== undefined ? omitMode(element.props) : element.props,
  incompleteProps: undefined,
  listeners: [],
  unsubscribes: [],
  children: [],
  // Incomplete nodes must remain traversable if acquisition aborts.
  subtreeHasUnsubscribes: true,
});

const buildStaticElement = (
  built: StaticBuilt,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): void => {
  applyStaticProps(
    built.node,
    built.props,
    built.listeners,
    built.unsubscribes,
    renderContext,
    context,
  );
  let subtreeHasUnsubscribes = built.unsubscribes.length > 0;
  for (const child of built.element.children) {
    if (Predicate.isTagged(child, "Text")) {
      const textNode = document.createTextNode(child.content);
      built.node.appendChild(textNode);
      built.children.push({ kind: "text", node: textNode });
    } else if (Predicate.isTagged(child, "Intrinsic")) {
      const childBuilt = createStaticBuilt(child);
      // Retain ownership before either property acquisition or insertion can fail.
      built.children.push({ kind: "element", built: childBuilt });
      buildStaticElement(childBuilt, renderContext, context);
      built.node.appendChild(childBuilt.node);
      if (childBuilt.subtreeHasUnsubscribes) subtreeHasUnsubscribes = true;
    }
  }
  built.subtreeHasUnsubscribes = subtreeHasUnsubscribes;
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

const canReconcileStaticBuilt = (built: StaticBuilt, next: IntrinsicElement): boolean => {
  if (next.tag !== built.element.tag || next.key !== built.element.key) return false;
  if (next.children.length !== built.children.length) return false;
  // Matching retained tags/keys proves the non-hoistable, unkeyed-child
  // invariants. Validate each candidate's props during this same tree walk.
  if (!isStaticProps(next.props)) return false;
  for (let index = 0; index < next.children.length; index++) {
    const child = next.children[index];
    const previous = built.children[index];
    if (child === undefined || previous === undefined) return false;
    if (Predicate.isTagged(child, "Text")) {
      if (previous.kind !== "text") return false;
    } else if (Predicate.isTagged(child, "Intrinsic")) {
      if (previous.kind !== "element" || !canReconcileStaticBuilt(previous.built, child))
        return false;
    } else {
      return false;
    }
  }
  return true;
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

  let completed = false;
  // oxlint-disable-next-line effect/no-try-catch -- Native bookkeeping only; finally preserves the defect for the enclosing Effect.sync boundary without catching or translating it.
  try {
    // `flagDirty` tracks whether the teardown-skip flag (`subtreeHasUnsubscribes`)
    // could have changed during this reconcile. It only changes when this node's
    // own unsubscribes are re-derived (the props-changed branch below) or when a
    // child reconcile flips the child's flag. In the common keyed-list reconcile
    // (update10th: text-only change; swap: no change) neither happens, so the
    // recompute at the end is skipped entirely — the flag is invariant.
    let flagDirty = false;

    const nextProps =
      nextElement.props.mode !== undefined ? omitMode(nextElement.props) : nextElement.props;
    if (built.incompleteProps !== undefined || !shallowPropsEqual(built.props, nextProps)) {
      const previousProps = built.incompleteProps ?? built.props;
      let applied = false;
      // oxlint-disable-next-line effect/no-try-catch -- Record partial native writes synchronously; the enclosing Effect.sync retains the original Cause.
      try {
        for (const { eventName, listener } of built.listeners) {
          built.node.removeEventListener(eventName, listener);
        }
        built.listeners = [];
        for (const unsubscribe of built.unsubscribes) unsubscribe();
        built.unsubscribes = [];
        clearRemovedProps(built.node, previousProps, nextProps);
        applyStaticProps(
          built.node,
          nextProps,
          built.listeners,
          built.unsubscribes,
          renderContext,
          context,
        );
        built.props = nextProps;
        built.incompleteProps = undefined;
        applied = true;
      } finally {
        // Native failures propagate to the enclosing Effect.sync Cause boundary.
        // Keep every possibly applied key until a complete patch succeeds, even
        // when rollback also fails. Allocate this union only on the failure path.
        if (!applied) built.incompleteProps = { ...previousProps, ...nextProps };
      }
      flagDirty = true;
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
        if (!reconcileStaticBuilt(childBuilt.built, nextChild, renderContext, context))
          return false;
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
    completed = true;
    return true;
  } finally {
    // A descendant may acquire subscriptions before its native write fails.
    // Keep every ancestor traversable for cleanup if reconciliation aborts.
    if (!completed) built.subtreeHasUnsubscribes = true;
  }
};

/**
 * Wrap a built {@link StaticBuilt} root in the {@link RenderResult} the static
 * fast-path returns: expose the synchronous
 * cleanup/reconcile pair, producing an in-place-reconcilable result for the
 * from-scratch build ({@link buildStaticIntrinsicSync}), which owns insertion.
 */
const makeStaticRenderResult = (
  root: StaticBuilt,
  renderContext: RenderContext,
): StaticRenderResult => {
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
    // oxlint-disable-next-line effect/no-try-catch -- Native detachment must not prevent synchronous subscription release; the enclosing Effect retains its defect.
    try {
      if (detached !== true) root.node.remove();
    } finally {
      cleanupStaticBuilt(root);
    }
  };
  return {
    node: root.node,
    cleanup: Effect.sync(() => cleanupSync()),
    cleanupSync,
    canReconcile: (nextElement, nextContext) => {
      const resolved = resolveReconcileTarget(nextElement, nextContext);
      return (
        Predicate.isTagged(resolved.element, "Intrinsic") &&
        canReconcileStaticBuilt(root, resolved.element)
      );
    },
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
 * Native acquisition failures return an Effect that rolls back the retained
 * partial tree and preserves acquisition and cleanup Causes. Callers must yield
 * this Effect inside their native acquisition mask before continuing or handing
 * off ownership, and release a result if interruption prevents that handoff.
 *
 * @internal
 */
export const buildStaticIntrinsicSync = (
  element: IntrinsicElement,
  parent: Node,
  renderContext: RenderContext,
  context: Context.Context<unknown> | null,
): StaticRenderResult | Effect.Effect<StaticRenderResult> => {
  const root = createStaticBuilt(element);
  // oxlint-disable-next-line effect/no-try-catch -- Native adapter: successful construction stays synchronous; failures enter Effect with rollback and the original defect.
  try {
    buildStaticElement(root, renderContext, context);
    const result = makeStaticRenderResult(root, renderContext);
    parent.appendChild(root.node);
    return result;
  } catch (defect) {
    return Effect.failCause(Cause.die(defect)).pipe(
      Effect.onError(() =>
        cleanupAll([
          Effect.sync(() => root.node.remove()),
          Effect.sync(() => cleanupStaticBuilt(root)),
        ]),
      ),
    );
  }
};

/**
 * Fast path for fully-static intrinsic subtrees: one `Effect.suspend` wrapping
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
  Effect.suspend(() => {
    let acquired: StaticRenderResult | undefined;
    // Bounded native acquisition and rollback must finish before deferred interruption.
    return Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        const result = buildStaticIntrinsicSync(element, parent, renderContext, context);
        if (!Effect.isEffect(result)) acquired = result;
        return Effect.isEffect(result) ? result : Effect.succeed(result);
      }).pipe(
        Effect.catchCause((cause) =>
          // Restore cancellation after rollback and retain the native Cause
          // alongside a deferred interrupt instead of replacing either one.
          Effect.exit(restore(Effect.void)).pipe(
            Effect.flatMap((exit) =>
              Effect.failCause(Exit.isFailure(exit) ? Cause.combine(exit.cause, cause) : cause),
            ),
          ),
        ),
      ),
    ).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) && acquired !== undefined ? acquired.cleanup : Effect.void,
      ),
    );
  });

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
    ? yield* Head.maybeHoist(tag, props)
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

  let rollback: Effect.Effect<void, unknown, R> = Effect.void;
  // Native writes and result bookkeeping finish together; user rendering stays
  // interruptible. Until handoff, every partial acquisition belongs to rollback.
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const node = createElement(tag);
      rollback = Effect.sync(() => node.remove());
      yield* Trace.emit("intrinsic.render", () => ({ element_tag: tag }));

      const domProps = props.mode !== undefined ? omitMode(props) : props;
      const appliedProps =
        Option.isSome(hoistAction) && isHeadHoistAction(hoistAction.value)
          ? hoistAction.value.props
          : domProps;

      let currentProps = appliedProps;
      let currentPropertyValues: ReadonlyMap<string, unknown> | undefined;
      let propCleanups: Array<Effect.Effect<void>> = [];
      const isHeadHoist = Option.isSome(hoistAction) && isHeadHoistAction(hoistAction.value);

      type ChildSlot = {
        readonly key: ReturnType<typeof getKey>;
        readonly startMarker: Comment;
        readonly endMarker: Comment;
        readonly result: RenderResult;
      };

      const hasKeyedChildren = children.some((child) => getKey(child) !== null);
      const childrenAnchor = hasKeyedChildren ? document.createComment("children-end") : null;
      let headAnchor: Comment | undefined;

      const cleanupChildSlot = Effect.fnUntraced(function* (slot: ChildSlot) {
        yield* cleanupAll([
          RenderTransaction.cleanup(slot.result),
          Effect.sync(() => slot.startMarker.remove()),
          Effect.sync(() => slot.endMarker.remove()),
        ]);
      });

      const renderChildSlot = Effect.fnUntraced(function* (
        child: Element,
        childContext: Context.Context<unknown> | null,
        preparation?: RenderPreparation,
      ) {
        let startMarker: Comment | undefined;
        let endMarker: Comment | undefined;
        let acquired: RenderResult | undefined;
        return yield* Effect.uninterruptibleMask((restoreChild) =>
          Effect.gen(function* () {
            const fragment = document.createDocumentFragment();
            const start = document.createComment("child-start");
            startMarker = start;
            fragment.appendChild(start);
            const result = yield* restoreChild(
              deps.renderElement(
                child,
                fragment,
                renderContext,
                childContext,
                preparation === undefined && options.preparation === undefined
                  ? options
                  : { ...options, preparation },
              ),
            );
            acquired = result;
            const end = document.createComment("child-end");
            endMarker = end;
            fragment.appendChild(end);
            if (childrenAnchor === null) node.appendChild(fragment);
            else node.insertBefore(fragment, childrenAnchor);
            return {
              key: getKey(child),
              startMarker: start,
              endMarker: end,
              result,
            } satisfies ChildSlot;
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.exit(restoreChild(Effect.void)).pipe(
                Effect.flatMap((exit) =>
                  Effect.failCause(Exit.isFailure(exit) ? Cause.combine(exit.cause, cause) : cause),
                ),
              ),
            ),
          ),
        ).pipe(
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void;
            const cleanups: Array<Effect.Effect<void, unknown>> = [];
            if (acquired !== undefined) cleanups.push(RenderTransaction.cleanup(acquired));
            const start = startMarker;
            const end = endMarker;
            if (start !== undefined) cleanups.push(Effect.sync(() => start.remove()));
            if (end !== undefined) cleanups.push(Effect.sync(() => end.remove()));
            return cleanupAll(cleanups);
          }),
        );
      });

      const childResults: Array<RenderResult> = [];
      let childSlots: Array<ChildSlot> = [];

      const cleanupProgressiveNode = Effect.suspend(() => {
        const cleanups: Array<Effect.Effect<void, unknown, R>> = [];
        if (hasKeyedChildren) {
          for (const childSlot of childSlots) cleanups.push(cleanupChildSlot(childSlot));
        } else {
          for (const child of childResults) cleanups.push(RenderTransaction.cleanup(child));
        }
        cleanups.push(
          ...propCleanups,
          Effect.sync(() => node.remove()),
        );
        const anchor = headAnchor;
        if (anchor !== undefined) cleanups.push(Effect.sync(() => anchor.remove()));
        return cleanupAll(cleanups);
      });
      rollback = cleanupProgressiveNode;
      const acquiredProps = yield* restore(
        applyProps(
          node,
          currentProps,
          renderContext,
          context,
          deps,
          options.preparation?.propertyValues,
        ),
      );
      propCleanups = acquiredProps.cleanups;
      currentPropertyValues = acquiredProps.propertyValues;
      if (!isHeadHoist) parent.appendChild(node);
      if (childrenAnchor !== null) node.appendChild(childrenAnchor);

      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child === undefined) continue;
        const preparation = options.preparation?.children[index];
        if (hasKeyedChildren) {
          childSlots.push(yield* restore(renderChildSlot(child, context, preparation)));
        } else {
          childResults.push(
            yield* restore(
              deps.renderElement(
                child,
                node,
                renderContext,
                context,
                options.preparation === undefined ? options : { ...options, preparation },
              ),
            ),
          );
        }
      }

      if (Option.isSome(hoistAction) && isHeadHoistAction(hoistAction.value)) {
        if (node instanceof HTMLElement) {
          yield* restore(hoistAction.value.mount(node));
        }
        const anchor = document.createComment(`head:${tag}`);
        headAnchor = anchor;
        parent.appendChild(anchor);

        return {
          node: anchor,
          cleanup: Effect.suspend(() => {
            const cleanups: Array<Effect.Effect<void, unknown, R>> = [];
            if (hasKeyedChildren) {
              for (const childSlot of childSlots) cleanups.push(cleanupChildSlot(childSlot));
            } else {
              for (const child of childResults) cleanups.push(RenderTransaction.cleanup(child));
            }
            cleanups.push(
              ...propCleanups,
              Effect.sync(() => anchor.remove()),
            );
            return cleanupAll(cleanups);
          }),
        } satisfies RenderResult;
      }

      return {
        node,
        cleanup: Effect.suspend(() => {
          // Detach this subtree's root from the document FIRST, as a single
          // synchronous DOM mutation, BEFORE recursing into child/prop cleanup.
          // Child cleanup is an Effect that `yield*`s once per child — every yield is
          // a scheduler boundary where the browser can paint, so cleaning up children
          // while still attached makes a large subtree disappear node-by-node (a
          // 60-line code block visibly tearing down line-by-line under load). Removing
          // `node` up front means every descendant removal happens off-document and is
          // never painted; the outermost intrinsic in any torn-down subtree thus
          // vanishes atomically and the inner `node.remove()`s become no-ops.
          const cleanups: Array<Effect.Effect<void, unknown, R>> = [
            Effect.sync(() => node.remove()),
          ];
          if (hasKeyedChildren) {
            for (const childSlot of childSlots) cleanups.push(cleanupChildSlot(childSlot));
          } else {
            for (const child of childResults) cleanups.push(RenderTransaction.cleanup(child));
          }
          cleanups.push(...propCleanups);
          return cleanupAll(cleanups);
        }),
        get preparation(): RenderPreparation {
          return {
            propertyValues: currentPropertyValues,
            children: hasKeyedChildren
              ? childSlots.map((slot) => slot.result.preparation)
              : childResults.map((child) => child.preparation),
          };
        },
        prepareReconcile: (nextElement: Element, nextContext: Context.Context<unknown> | null) => {
          const resolved = resolveReconcileTarget(nextElement, nextContext);
          const next = resolved.element;
          if (!Predicate.isTagged(next, "Intrinsic") || next.tag !== tag || next.key !== key)
            return;
          const childCount = hasKeyedChildren ? childSlots.length : childResults.length;
          if (next.children.length !== childCount) return;
          // Plan the whole compatible subtree before running any property Effect.
          // Static children already know how to patch; effectful children acquire
          // their own values in parent-before-child order under the caller's Scope.
          const childPlans: Array<ReturnType<NonNullable<RenderResult["prepareReconcile"]>>> = [];
          for (let index = 0; index < childCount; index++) {
            const slot = childSlots[index];
            const child = hasKeyedChildren ? slot?.result : childResults[index];
            const nextChild = next.children[index];
            if (child === undefined || nextChild === undefined) return;
            if (hasKeyedChildren && getKey(nextChild) !== slot?.key) return;
            if (child.canReconcile !== undefined && needsHostPreparation(nextChild)) return;
            if (child.canReconcile?.(nextChild, resolved.context) === true) {
              childPlans.push(undefined);
            } else {
              const plan = child.prepareReconcile?.(nextChild, resolved.context);
              if (plan === undefined) return;
              childPlans.push(plan);
            }
          }
          return Effect.gen(function* () {
            let propertyValues: Map<string, unknown> | undefined;
            const props = next.props.mode !== undefined ? omitMode(next.props) : next.props;
            for (const [name, value] of Object.entries(props)) {
              if (value === undefined) continue;
              if (name.startsWith("on")) {
                if (!isEventHandler(value))
                  return yield* new InvalidEventHandlerError({ prop: name });
              } else {
                let resolvedValue: unknown = value;
                if (!Signal.isSignal(value) && isEffectProp(value)) {
                  resolvedValue = yield* value;
                  propertyValues ??= new Map();
                  propertyValues.set(name, resolvedValue);
                }
                const appliedValue = Signal.isSignal(resolvedValue)
                  ? yield* Signal.peek(resolvedValue)
                  : resolvedValue;
                if (needsHostConversion(appliedValue)) {
                  return {
                    propertyValues,
                    children: [],
                    needsDom: true,
                  } satisfies RenderPreparation;
                }
              }
            }
            const children: Array<RenderPreparation | undefined> = [];
            for (const plan of childPlans) {
              const child = plan === undefined ? undefined : yield* plan;
              children.push(child);
              if (child?.needsDom)
                return { propertyValues, children, needsDom: true } satisfies RenderPreparation;
            }
            return { propertyValues, children };
          });
        },
        reconcile: Effect.fnUntraced(function* (
          nextElement: Element,
          nextContext: Context.Context<unknown> | null,
          preparation?: RenderPreparation,
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

          if (
            preparation?.propertyValues !== undefined ||
            !shallowPropsEqual(currentProps, nextProps)
          ) {
            for (const cleanup of propCleanups) yield* cleanup;
            clearRemovedProps(node, currentProps, nextProps);
            const acquired = yield* applyProps(
              node,
              nextProps,
              renderContext,
              resolvedNextContext,
              deps,
              preparation?.propertyValues,
            );
            propCleanups = acquired.cleanups;
            currentPropertyValues = acquired.propertyValues;
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
              const outcome = yield* RenderTransaction.reconcile({
                boundary: "child",
                previous: childResult,
                preparation: preparation?.children[index],
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
            nextPreparation: RenderPreparation | undefined,
          ) {
            if (slotIndex === undefined || usedIndices.has(slotIndex)) return false;
            const slot = childSlots[slotIndex];
            if (slot === undefined || slot.result.reconcile === undefined) return false;
            const outcome = yield* RenderTransaction.reconcile({
              boundary: "child",
              previous: slot.result,
              preparation: nextPreparation,
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
                ? yield* tryReuse(
                    nextChild,
                    keyedIndices.get(nextKey),
                    preparation?.children[index],
                  )
                : yield* tryReuse(nextChild, index, preparation?.children[index]);
            if (!reused)
              nextSlots.push(
                yield* renderChildSlot(
                  nextChild,
                  resolvedNextContext,
                  preparation?.children[index],
                ),
              );
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
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.exit(restore(Effect.void)).pipe(
          Effect.flatMap((exit) =>
            Effect.failCause(Exit.isFailure(exit) ? Cause.combine(exit.cause, cause) : cause),
          ),
        ),
      ),
    ),
  ).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? rollback : Effect.void)));
});
