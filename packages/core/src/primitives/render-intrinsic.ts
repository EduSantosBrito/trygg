import { Effect, Fiber, Option, Predicate, Scope } from "effect";
import * as Context from "effect/Context";
import { Element, getKey, type ElementProps, type EventHandler } from "./element.js";
import * as Signal from "./signal.js";
import * as Trace from "../trace/index.js";
import {
  applyPropValue,
  clearPropValue,
  equalOrChanged,
  logBlockedSafeUrlAttribute,
  moveRange,
  resolveReconcileTarget,
} from "./render-utils.js";
import * as Head from "./head.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";
import { InvalidEventHandlerError } from "./renderer.js";
import { makeRenderContextTransaction } from "./render-context-transaction.js";
import { makeRenderTransaction } from "./render-transaction.js";

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
  const contextTransaction = makeRenderContextTransaction();
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
  const hoist = Head.makeHeadHoist();
  const hoistAction = yield* hoist.maybeHoist(tag, props);
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
  const renderTransaction = makeRenderTransaction();

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

      if (!equalOrChanged(currentProps, nextProps)) {
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
