import { Cause, Effect, Exit, Fiber, Schema, Scope, Tracer } from "effect";
import * as Context from "effect/Context";
import { Element } from "./element.js";
import * as Signal from "./signal.js";
import * as Trace from "../trace/index.js";
import { moveRange } from "./render-utils.js";
import type {
  ErrorBoundaryHandler,
  RenderContext,
  RenderPreparation,
  RenderResult,
} from "./renderer.js";
import * as RenderTransaction from "./render-transaction.js";
import { unsafeWidenContext } from "../internal/unsafe.js";
import { cleanupAll } from "./render-cleanup.js";
import * as Profiling from "./render-profiling.js";

interface RenderOptions {
  readonly preparation?: RenderPreparation | undefined;
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderKeyedListDeps<E, R> {
  readonly captureRowServices: (
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => Context.Context<Exclude<NoInfer<R>, Scope.Scope>>;
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, E, R>;
  readonly renderElementSync: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => RenderResult | Effect.Effect<RenderResult> | null;
  readonly runForkInRenderContext: <E2, R2>(
    effect: Effect.Effect<void, E2, R2>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options?: { readonly preventSchedulerYield?: boolean },
  ) => void;
}

export class KeyedListDuplicateKeyError extends Schema.TaggedError<KeyedListDuplicateKeyError>()(
  "KeyedListDuplicateKeyError",
  {
    key: Schema.Union([Schema.String, Schema.Number]),
  },
) {}

class KeyedListRollbackError extends Schema.TaggedError<KeyedListRollbackError>()(
  "KeyedListRollbackError",
  {
    key: Schema.Union([Schema.String, Schema.Number]),
  },
) {}

export const computeLIS = (arr: ReadonlyArray<number>): ReadonlyArray<number> => {
  const n = arr.length;
  if (n === 0) return [];

  const dp: Array<number> = [];
  const parent: Array<number> = Array.from({ length: n }, () => -1);
  const pos: Array<number> = [];

  for (let i = 0; i < n; i++) {
    const val = arr[i];
    if (val === undefined) continue;

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

  const lisIndices: Array<number> = [];
  let k = pos[dp.length - 1];
  while (k !== undefined && k !== -1) {
    lisIndices.push(k);
    k = parent[k];
  }
  lisIndices.reverse();
  return lisIndices;
};

export const renderKeyedList = Effect.fn("renderKeyedList")(function* <T, E, R>(
  source: Signal.Signal<ReadonlyArray<T>>,
  renderFn: (item: T, index: number) => Effect.Effect<unknown, E, R>,
  keyFn: (item: T, index: number) => string | number,
  parent: Node,
  runtime: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderKeyedListDeps<E, R>,
) {
  const rowServices = deps.captureRowServices(runtime, context);
  const profiling = Context.get(rowServices, Profiling.Enabled);
  // During profiling, nested row spans belong to the active render phase, not
  // the mount span captured with the list services. Leave the default path intact.
  const rowRenderServices = profiling
    ? Context.omit(Tracer.ParentSpan)(unsafeWidenContext(rowServices))
    : unsafeWidenContext(rowServices);
  const profilePrepare = Profiling.phase(profiling, "trygg.keyedList.prepare");
  const profileRender = Profiling.phase(profiling, "trygg.keyedList.render");
  const profileProperties = Profiling.phase(profiling, "trygg.keyedList.properties");
  const profileReconcile = Profiling.phase(profiling, "trygg.keyedList.reconcile");
  const profileCleanup = Profiling.phase(profiling, "trygg.keyedList.cleanup");
  // Workers outlive the notifier. Independent roots avoid children of a stale mount span.
  const profileGranular = Profiling.phase(profiling, "trygg.keyedList.granular", true);
  const profileUpdate = Profiling.phase(profiling, "trygg.keyedList.update", true);
  // Create anchor comment for the list
  const anchor = document.createComment("keyed-list");
  parent.appendChild(anchor);
  // Track item states by key
  type ItemState = {
    renderPhase: Signal.RenderPhase;
    /** Last committed normalized element, used to roll back pre-commit reconciliation. */
    element: Element;
    result: RenderResult;
    /** Comment marking start of this item's DOM range */
    startMarker: Comment;
    /** Comment marking end of this item's DOM range (always after content) */
    endMarker: Comment;
    item: T;
    /** Current index in the list (updated on reorder) */
    currentIndex: number;
    /** Whether a re-render is in progress */
    isRerendering: boolean;
    rerenderFiber: Fiber.Fiber<unknown, unknown> | null;
    /** Latest dependency notification; retained only until resumed or retired. */
    pendingRerenderContext: Context.Context<unknown> | null;
    /** Map from signal debugId to unsubscribe Effect */
    subscriptions: Map<string, Effect.Effect<void>>;
    /** Scope that owns render-function signals and child component scopes for this keyed item */
    scope: Scope.Closeable;
    /** Trigger item rerender while preserving scope */
    scheduleRerender: () => Effect.Effect<void>;
  };
  type BuiltItemDom = {
    readonly result: RenderResult;
    readonly startMarker: Comment;
    readonly endMarker: Comment;
  };
  type RerenderOutcome =
    | { readonly kind: "reconciled" }
    | { readonly kind: "replaced"; readonly built: BuiltItemDom };
  const rerenderReconciled: RerenderOutcome = { kind: "reconciled" };
  const rerenderReplaced = (built: BuiltItemDom): RerenderOutcome => ({
    kind: "replaced",
    built,
  });
  const itemStates = new Map<string | number, ItemState>();
  const keyOrder: Array<string | number> = [];
  const listScope = yield* Scope.fork(yield* Effect.scope);
  const updateScope = yield* Scope.fork(listScope);
  const listContext: RenderContext = { ...runtime, scope: listScope };
  const updateContext: RenderContext = { ...listContext, scope: updateScope };
  let isUnmounted = false;
  let isUpdating = false;
  let pendingUpdate = false;
  let pendingUpdateContext: Context.Context<unknown> | null = null;
  const pendingRerenderKeys = new Set<string | number>();

  const handleUpdateCause = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>) {
    if (Cause.hasDies(cause) || Cause.hasInterrupts(cause) || options.errorHandler === null) {
      return yield* Effect.failCause(cause);
    }
    options.errorHandler(cause);
  });

  const stopRerender = Effect.fnUntraced(function* (state: ItemState) {
    const fiber = state.rerenderFiber;
    if (fiber === null) return;
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    // Supersession owns interruption, but does not erase failed finalization.
    if (
      Exit.isFailure(exit) &&
      exit.cause.reasons.some((reason) => !Cause.isInterruptReason(reason))
    ) {
      return yield* Effect.failCause(exit.cause);
    }
  });

  const itemRenderContext = (scope: Scope.Scope): RenderContext => ({ ...listContext, scope });

  const resumeItemRerender = (state: ItemState): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (isUnmounted) {
        state.pendingRerenderContext = null;
        return Effect.void;
      }
      if (isUpdating || state.isRerendering) return Effect.void;
      const nextContext = state.pendingRerenderContext;
      state.pendingRerenderContext = null;
      return nextContext === null
        ? Effect.void
        : Effect.provide(state.scheduleRerender(), nextContext);
    });

  // Runs the user render function for `item` under `renderPhase` and returns the
  // normalized element WITHOUT building DOM or providing a scope. Shared by the
  // create/replace path (`renderItem`) and the in-place reconcile fast-path
  // (`scheduleItemRerender`) so the render function executes exactly once per
  // (re)render. The phase wraps only the user render — `renderElement`/reconcile
  // observe the default (null) phase — so `renderPhase.accessed` (and thus the
  // item's subscription set) is unchanged from rendering inline.
  // `Effect.fnUntraced` (no span) — the idiomatic way to express a generator-based
  // Effect helper; the create/re-render fibers `yield*` it like any other Effect.
  const runRenderFn = Effect.fnUntraced(function* (
    item: T,
    index: number,
    renderPhase: Signal.RenderPhase,
  ) {
    const renderEffect = Effect.provide(renderFn(item, index), rowRenderServices);
    const element = yield* Effect.provideService(
      renderEffect,
      Signal.CurrentRenderPhase,
      renderPhase,
    );
    // Fast path: a render function almost always returns an already-normalized
    // `Element` (the common JSX case), which `fromUnknownSync` resolves without
    // spinning a fiber; only a `Signal`-valued result (null) needs the effectful
    // `fromUnknown`.
    const syncNormalized = Element.fromUnknownSync(element);
    return syncNormalized !== null ? syncNormalized : yield* Element.fromUnknown(element);
  });

  // Builds the DOM range [startMarker, content, endMarker] for an already-
  // normalized element, appending it to the list parent. Does NOT provide the item
  // scope — the caller wraps the whole render unit in one `Scope.provide(itemScope)`
  // so the create path stays a single per-row fiber-context clone.
  // `Effect.fnUntraced` (no span) — idiomatic generator Effect helper.
  const buildItemDom = Effect.fnUntraced(function* (
    normalizedElement: Element,
    parentOverride?: Node,
    renderContext: RenderContext = runtime,
    preparation?: RenderPreparation,
  ) {
    let acquiredResult: RenderResult | undefined;
    let acquiredStart: Comment | undefined;
    let acquiredEnd: Comment | undefined;
    // Complete native acquisition/rollback before interruption, while effectful
    // component rendering retains its normal cancellation behavior.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const listParent = parentOverride ?? anchor.parentNode ?? parent;

        // Insert start marker before rendering so content appears after it
        const startMarker = document.createComment("item-start");
        acquiredStart = startMarker;
        listParent.appendChild(startMarker);

        // Synchronous fast path: a fully-static row subtree builds inline, skipping a
        // per-row `renderElement` Effect dispatch (one `Effect.sync` primitive
        // allocation + one run-loop step saved for every row of the create/replace/
        // append cluster). `renderElementSync` returns `null` for rows that need the
        // effectful renderer (signal/component/keyed children), which fall back to the
        // original `yield* renderElement` path.
        const syncResult = deps.renderElementSync(
          normalizedElement,
          listParent,
          renderContext,
          context,
        );
        const result =
          syncResult === null
            ? yield* restore(
                deps.renderElement(
                  normalizedElement,
                  listParent,
                  renderContext,
                  context,
                  preparation === undefined ? options : { ...options, preparation },
                ),
              )
            : Effect.isEffect(syncResult)
              ? yield* syncResult.pipe(
                  Effect.catchCause((cause) =>
                    Effect.exit(restore(Effect.void)).pipe(
                      Effect.flatMap((exit) =>
                        Effect.failCause(
                          Exit.isFailure(exit) ? Cause.combine(exit.cause, cause) : cause,
                        ),
                      ),
                    ),
                  ),
                )
              : syncResult;

        // Insert end marker after content - ensures moveRange captures full Fragment range
        acquiredResult = result;
        const endMarker = document.createComment("item-end");
        acquiredEnd = endMarker;
        listParent.appendChild(endMarker);

        return { result, startMarker, endMarker };
      }),
    ).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) return Effect.void;
        const cleanups: Array<Effect.Effect<void, unknown>> = [];
        if (acquiredResult !== undefined) cleanups.push(RenderTransaction.cleanup(acquiredResult));
        if (acquiredStart !== undefined) {
          const marker = acquiredStart;
          cleanups.push(Effect.sync(() => marker.remove()));
        }
        if (acquiredEnd !== undefined) {
          const marker = acquiredEnd;
          cleanups.push(Effect.sync(() => marker.remove()));
        }
        return cleanupAll(cleanups);
      }),
    );
  });

  // Prepare within the caller's item Scope. Source updates and granular row
  // workers each own their failure cleanup and keep one Scope.provide boundary.
  const prepareItem = Effect.fnUntraced(function* (
    item: T,
    index: number,
    renderPhase: Signal.RenderPhase,
    itemScope: Scope.Closeable,
    parentOverride?: Node,
    previousDom?: BuiltItemDom,
  ) {
    const normalizedElement = yield* profileRender(runRenderFn(item, index, renderPhase));
    let preparation: RenderPreparation | undefined;
    if (previousDom !== undefined && previousDom.result.reconcile !== undefined) {
      const staticCompatible =
        previousDom.result.canReconcile?.(normalizedElement, context) === true;
      const plan = staticCompatible
        ? undefined
        : previousDom.result.prepareReconcile?.(normalizedElement, context);
      if (staticCompatible || plan !== undefined) {
        preparation = plan === undefined ? undefined : yield* profileProperties(plan);
        if (!preparation?.needsDom)
          return {
            renderPhase,
            element: normalizedElement,
            result: previousDom.result,
            startMarker: previousDom.startMarker,
            endMarker: previousDom.endMarker,
            usesExistingDom: true,
            preparation,
          };
      }
    }
    const { result, startMarker, endMarker } = yield* buildItemDom(
      normalizedElement,
      parentOverride,
      itemRenderContext(itemScope),
      preparation,
    );
    return {
      renderPhase,
      element: normalizedElement,
      result,
      startMarker,
      endMarker,
      usesExistingDom: false,
      preparation: undefined,
    };
  }, profilePrepare);

  // Prepare a single item with a stable render phase. Compatible results lend
  // their DOM after property acquisition; other cases build a detached candidate.
  // The row Effect and its scoped acquisition still execute exactly once.
  // Scope installation and failed acquisition belong to this source-update
  // caller; granular workers provide their own combined preparation boundary.
  const renderItem = Effect.fnUntraced(function* (
    item: T,
    index: number,
    existingPhase: Signal.RenderPhase | null,
    itemScope: Scope.Closeable,
    parentOverride?: Node,
    previousDom?: BuiltItemDom,
  ) {
    // Use existing phase or create new one
    const renderPhase = existingPhase ?? Signal.makeRenderPhaseUnsafe();

    if (existingPhase !== null) {
      // Reset for re-render
      yield* Signal.resetRenderPhase(renderPhase);
    }

    // One outer `Scope.provide(itemScope)` covers both the user render and the
    // subsequent `renderElement`, eliminating the redundant second `Scope.provide`
    // (one fewer per-row fiber-context Map clone). The phase stays render-only:
    // `runRenderFn`'s inner `provideService(CurrentRenderPhase, renderPhase)` wraps
    // only the user render and restores the prior context before `buildItemDom`
    // runs, so `renderElement` observes the default (null) phase — keeping
    // `renderPhase.accessed` (and thus the item's subscription set) unchanged.
    return yield* prepareItem(
      item,
      index,
      renderPhase,
      itemScope,
      parentOverride,
      previousDom,
    ).pipe(
      Scope.provide(itemScope),
      // Close the forked item scope if the render fails (the only failure-prone
      // work — `runRenderFn` + `buildItemDom` — lives inside prepareItem; the
      // preceding phase setup is synchronous/infallible). Preserve the render
      // Exit so exit-sensitive finalizers can distinguish fail/die/interrupt.
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Scope.close(itemScope, Exit.asVoid(exit)) : Effect.void,
      ),
    );
  });

  const currentStatesInDomOrder = (): Array<ItemState> => {
    const states: Array<ItemState> = [];
    const seen = new Set<ItemState>();

    for (const key of keyOrder) {
      const state = itemStates.get(key);
      if (state !== undefined) {
        states.push(state);
        seen.add(state);
      }
    }

    for (const state of itemStates.values()) {
      if (!seen.has(state)) {
        states.push(state);
      }
    }

    return states;
  };

  // Detach the whole contiguous marker..node range off-document in ONE pass and
  // report whether it ran. Returns `true` when the range was extracted (so the
  // caller can skip the now-redundant per-row .remove() calls), `false` when the
  // range could not be formed (markers no longer share the list parent) and the
  // caller must fall back to per-row removal.
  const detachContiguousItemRange = (
    states: ReadonlyArray<Pick<ItemState, "startMarker" | "endMarker">>,
  ): boolean => {
    const listParent = anchor.parentNode;
    if (listParent === null || states.length === 0) return false;

    for (const state of states) {
      if (
        state.startMarker.parentNode !== listParent ||
        state.endMarker.parentNode !== listParent
      ) {
        return false;
      }
    }

    const firstState = states[0];
    const lastState = states[states.length - 1];
    if (firstState === undefined || lastState === undefined) return false;

    const range = document.createRange();
    range.setStartBefore(firstState.startMarker);
    range.setEndAfter(lastState.endMarker);
    // extractContents (not deleteContents): the goal is to pull the whole range
    // off the live list parent in ONE pass WITHOUT a per-row live removal — per-row
    // removal of <tr>s from a connected <tbody> is the super-linear-in-the-layout-
    // engine path the "batches full clear before per-row cleanup touches a live
    // table" perf contract guards against. extractContents reparents the range into
    // a throwaway fragment without touching the live parent per child; the fragment
    // is discarded. Crucially, callers then SKIP the per-row .remove()/marker.remove
    // entirely (see the full-clear teardown) — those nodes are already off-document
    // inside the discarded fragment — so the fragment never pays a second per-row
    // detach. Per-row cleanup still runs via the retained StaticBuilt refs.
    range.extractContents();
    range.detach();
    return true;
  };

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
    if (oldSubs.size === newAccessed.size) {
      if (oldSubs.size === 0) return;
      const previousIds = oldSubs.keys();
      let unchanged = true;
      for (const signal of newAccessed) {
        if (previousIds.next().value !== signal._debugId) {
          unchanged = false;
          break;
        }
      }
      // Keep both subscription identity and release order when the graph is stable.
      if (unchanged) return;
    }
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
        yield* Trace.emit("keyedList.subscription.remove", () => ({ key, signal_id: signalId }));
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
        yield* Trace.emit("keyedList.subscription.add", () => ({
          key,
          signal_id: signal._debugId,
        }));
      }
    }

    state.subscriptions = newSubs;
  });

  // Function to update the list
  // Note: updateList is sync because it's called from signal listener,
  // but it immediately forks an Effect for the actual work.
  function updateList(forkContext: Context.Context<unknown> | null = null): void {
    if (isUnmounted) return;

    if (isUpdating) {
      pendingUpdate = true;
      pendingUpdateContext = forkContext;
      return;
    }

    isUpdating = true;

    const stagedParent = document.createDocumentFragment();
    type StagedItem = {
      readonly preparation?: RenderPreparation | undefined;
      readonly key: string | number;
      readonly scope: Scope.Closeable;
      readonly renderPhase: Signal.RenderPhase;
      readonly element: Element;
      result: RenderResult;
      startMarker: Comment;
      endMarker: Comment;
      usesExistingDom: boolean;
      retainResult: boolean;
      retainScope: boolean;
      resultCleaned: boolean;
      scopeClosed: boolean;
    };
    const stagedItems: Array<StagedItem> = [];
    let committed = false;

    const cleanupStagedItems = Effect.suspend(() => {
      const cleanups: Array<Effect.Effect<void, unknown, R>> = [];
      for (const staged of stagedItems) {
        if (!staged.retainResult && !staged.resultCleaned) {
          staged.resultCleaned = true;
          cleanups.push(
            RenderTransaction.cleanup(staged.result),
            Effect.sync(() => staged.startMarker.remove()),
            Effect.sync(() => staged.endMarker.remove()),
          );
        }
        if (!staged.retainScope && !staged.scopeClosed) {
          staged.scopeClosed = true;
          cleanups.push(Scope.close(staged.scope, Exit.void));
        }
      }
      cleanups.push(Effect.sync(() => stagedParent.replaceChildren()));
      return cleanupAll(cleanups);
    });

    const updateEffect = Effect.scoped(
      Effect.gen(function* () {
        yield* Trace.emit("keyedList.update", () => ({ current_keys: keyOrder.length }));

        yield* Trace.emit("keyedList.state", () => ({
          phase: "start",
          key_order: [...keyOrder],
        }));

        if (isUnmounted || anchor.parentNode === null) {
          return;
        }

        // Get current items from source signal. peek (not get): the keyed list
        // owns its own subscription via Signal.subscribe(source) below. Using
        // Signal.get here would *also* add `source` to the enclosing component's
        // render phase (whichever phase is current when the initial updateList
        // runs), subscribing that component to the source. The component would
        // then re-render — and a component re-render whose body produces fresh
        // SignalElement/keyed-list children cannot reconcile, so it falls back to
        // a full REPLACE that tears down and rebuilds the entire shared subtree
        // on every source change, instead of this in-place list diff.
        const items = yield* Signal.peek(source);

        // Compute new keys
        const newKeys = items.map((item, i) => keyFn(item, i));
        const newKeySet = new Set(newKeys);
        if (newKeySet.size !== newKeys.length) {
          const seen = new Set<string | number>();
          for (const key of newKeys) {
            if (seen.has(key)) {
              return yield* new KeyedListDuplicateKeyError({ key });
            }
            seen.add(key);
          }
        }

        yield* Trace.emit("keyedList.state", () => ({
          phase: "computed",
          key_order: [...keyOrder],
          new_keys: newKeys,
        }));

        // Build map of old key -> old index for LIS calculation
        const oldKeyToIndex = new Map<string | number, number>();
        for (let i = 0; i < keyOrder.length; i++) {
          const key = keyOrder[i];
          if (key !== undefined) {
            oldKeyToIndex.set(key, i);
            if (!newKeySet.has(key)) {
              const state = itemStates.get(key);
              if (state !== undefined && state.rerenderFiber !== null) yield* stopRerender(state);
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
          needsRerender: boolean;
          nextItem: T;
          nextIndex: number;
          staged: StagedItem | null;
          commitKind: "unchanged" | "reconciled" | "replaced";
        }> = [];

        for (const [i, item] of items.entries()) {
          const key = newKeys[i];

          if (key === undefined) continue;

          const existingState = itemStates.get(key);
          const oldIndex = oldKeyToIndex.get(key);

          if (existingState !== undefined && oldIndex !== undefined) {
            // Key identity preserves the row, not stale item/index render inputs.
            const needsRerender =
              !Object.is(existingState.item, item) || existingState.currentIndex !== i;
            // Check if this item needs to move (not in LIS)
            const needsMove = !stableOldIndices.has(oldIndex);
            let staged: StagedItem | null = null;
            if (needsRerender) {
              if (existingState.rerenderFiber !== null) yield* stopRerender(existingState);
              const stagingScope = Scope.forkUnsafe(existingState.scope);
              const stagingPhase = Signal.makeRenderPhaseUnsafe();
              stagingPhase.signals.push(...existingState.renderPhase.signals);
              const rendered = yield* renderItem(
                item,
                i,
                stagingPhase,
                stagingScope,
                stagedParent,
                existingState,
              );
              staged = {
                key,
                scope: stagingScope,
                renderPhase: rendered.renderPhase,
                element: rendered.element,
                result: rendered.result,
                startMarker: rendered.startMarker,
                endMarker: rendered.endMarker,
                usesExistingDom: rendered.usesExistingDom,
                preparation: rendered.preparation,
                retainResult: rendered.usesExistingDom,
                retainScope: false,
                resultCleaned: false,
                scopeClosed: false,
              };
              stagedItems.push(staged);
            }
            newItemStates.push({
              key,
              state: existingState,
              isNew: false,
              needsMove,
              needsRerender,
              nextItem: item,
              nextIndex: i,
              staged,
              commitKind: "unchanged",
            });
          } else {
            // New item - create new state. Fork the item scope synchronously
            // (Scope.fork === sync(() => Scope.forkUnsafe(...)); forking unsafely
            // here skips one run-loop Effect.sync step per row with identical
            // parent/child finalizer wiring). The create-path error boundary below
            // still closes + detaches it on failure.
            const itemScope = Scope.forkUnsafe(listScope);
            const { renderPhase, element, result, startMarker, endMarker } = yield* renderItem(
              item,
              i,
              null,
              itemScope,
              stagedParent,
            );

            // Set up subscriptions for this item's accessed signals.
            // scheduleItemRerender returns lightweight Effect.sync to avoid blocking
            // signal notification chain. Actual re-render forks via Runtime.runFork.
            // Batching via isRerendering/pendingRerender coalesces rapid updates.
            const scheduleItemRerender: () => Effect.Effect<void> = Effect.fnUntraced(function* () {
              const forkContext = unsafeWidenContext(yield* Effect.context<never>());
              const currentState = yield* Effect.sync(() => {
                if (isUnmounted) return null;
                const state = itemStates.get(key);
                if (state === undefined) return null;

                // The source update owns publication until its preparations and
                // cleanup finish. Resume dependencies against committed inputs.
                if (isUpdating) {
                  state.pendingRerenderContext = forkContext;
                  pendingRerenderKeys.add(key);
                  return null;
                }
                // Coalesce rapid signal changes - mark pending if already rerendering
                if (state.isRerendering) {
                  state.pendingRerenderContext = forkContext;
                  return null;
                }
                state.isRerendering = true;
                return state;
              });
              if (currentState === null) return;

              yield* Effect.sync(() =>
                deps.runForkInRenderContext(
                  Effect.scoped(
                    Effect.gen(function* () {
                      const rerenderFiber = yield* Effect.withFiber(Effect.succeed);
                      currentState.rerenderFiber = rerenderFiber;
                      // Preserve row Signals while preparing the next element and
                      // property values once. Compatible rows patch their retained
                      // nodes; structural replacement consumes the same preparation.
                      // Keep the committed snapshot for rollback until publication.
                      const oldStartMarker = currentState.startMarker;
                      const oldEndMarker = currentState.endMarker;
                      const oldResult = currentState.result;
                      const oldElement = currentState.element;
                      let oldPreparation: RenderPreparation | undefined;
                      let attemptedReconcile = false;
                      const stagingScope = Scope.forkUnsafe(currentState.scope);
                      const stagingPhase = Signal.makeRenderPhaseUnsafe();
                      stagingPhase.signals.push(...currentState.renderPhase.signals);
                      const stagedParent = document.createDocumentFragment();

                      // Track new nodes for cleanup on error (set only on the replace
                      // fallback; the reconcile path creates no new DOM).
                      let newResult: RenderResult | null = null;
                      let newStartMarker: Comment | null = null;
                      let newEndMarker: Comment | null = null;
                      let nextElement: Element | null = null;
                      let committed = false;

                      yield* Effect.gen(function* () {
                        oldPreparation = oldResult.preparation;
                        const reconcile = oldResult.reconcile;
                        const outcome = yield* Effect.gen(function* () {
                          yield* Signal.resetRenderPhase(stagingPhase);
                          // Preparation and publication share this Scope; the
                          // worker's onExit owns rollback and failed acquisition.
                          const rendered = yield* prepareItem(
                            currentState.item,
                            currentState.currentIndex,
                            stagingPhase,
                            stagingScope,
                            stagedParent,
                            {
                              result: oldResult,
                              startMarker: oldStartMarker,
                              endMarker: oldEndMarker,
                            },
                          );
                          nextElement = rendered.element;
                          if (!rendered.usesExistingDom) {
                            newResult = rendered.result;
                            newStartMarker = rendered.startMarker;
                            newEndMarker = rendered.endMarker;
                          }
                          if (reconcile !== undefined) {
                            attemptedReconcile = true;
                            const patched = yield* profileReconcile(
                              reconcile(
                                rendered.element,
                                context,
                                rendered.preparation ?? rendered.result.preparation,
                              ),
                            );
                            if (patched) return rerenderReconciled;
                          }
                          if (!rendered.usesExistingDom) return rerenderReplaced(rendered);
                          const built = yield* buildItemDom(
                            rendered.element,
                            stagedParent,
                            itemRenderContext(stagingScope),
                            rendered.preparation,
                          );
                          newResult = built.result;
                          newStartMarker = built.startMarker;
                          newEndMarker = built.endMarker;
                          return rerenderReplaced(built);
                        }).pipe(Scope.provide(stagingScope));

                        yield* Effect.uninterruptible(
                          Effect.gen(function* () {
                            if (
                              outcome.kind === "replaced" &&
                              newResult !== null &&
                              newStartMarker !== null &&
                              newEndMarker !== null
                            ) {
                              moveRange(newStartMarker, newEndMarker, oldStartMarker);
                              currentState.result = newResult;
                              currentState.startMarker = newStartMarker;
                              currentState.endMarker = newEndMarker;
                            }
                            currentState.renderPhase = stagingPhase;
                            if (nextElement !== null) currentState.element = nextElement;

                            committed = true;

                            const postCommit: Array<Effect.Effect<void, unknown, R>> = [
                              diffSubscriptions(
                                key,
                                currentState,
                                stagingPhase.accessed,
                                scheduleItemRerender,
                              ),
                              Trace.emit("keyedList.item.rerender", () => ({ key })),
                            ];
                            if (outcome.kind === "replaced") {
                              postCommit.push(
                                Effect.sync(() => {
                                  detachContiguousItemRange([
                                    { startMarker: oldStartMarker, endMarker: oldEndMarker },
                                  ]);
                                }),
                                RenderTransaction.cleanup(oldResult),
                                Effect.sync(() => oldStartMarker.remove()),
                                Effect.sync(() => oldEndMarker.remove()),
                              );
                            }
                            if (outcome.kind === "reconciled" && newResult !== null) {
                              postCommit.push(
                                RenderTransaction.cleanup(newResult),
                                Effect.sync(() => newStartMarker?.remove()),
                                Effect.sync(() => newEndMarker?.remove()),
                              );
                            }
                            yield* profileCleanup(cleanupAll(postCommit));
                          }),
                        );
                      }).pipe(
                        Effect.onExit((exit) => {
                          if (Exit.isSuccess(exit)) return Effect.void;
                          return Effect.gen(function* () {
                            if (committed) {
                              yield* Trace.emit("keyedList.item.rerender.error", () => ({
                                key,
                                cause_type: Trace.causeValueType(exit.cause),
                              }));
                              return;
                            }
                            // Finalization also runs for interruption. Restore
                            // old bindings before releasing staged acquisitions.
                            const rollback = Effect.gen(function* () {
                              if (!attemptedReconcile || oldResult.reconcile === undefined) return;
                              const restored = yield* oldResult
                                .reconcile(oldElement, context, oldPreparation)
                                .pipe(Scope.provide(currentState.scope));
                              if (!restored)
                                return yield* Effect.failCause(
                                  Cause.die(new KeyedListRollbackError({ key })),
                                );
                            });
                            const cleanupExit = yield* Effect.exit(
                              profileCleanup(
                                cleanupAll([
                                  rollback,
                                  newResult !== null
                                    ? RenderTransaction.cleanup(newResult)
                                    : Effect.void,
                                  Effect.sync(() => newStartMarker?.remove()),
                                  Effect.sync(() => newEndMarker?.remove()),
                                  Scope.close(stagingScope, Exit.asVoid(exit)),
                                ]),
                              ),
                            );
                            const reportedCause = Exit.isFailure(cleanupExit)
                              ? Cause.combine(exit.cause, cleanupExit.cause)
                              : exit.cause;
                            yield* Trace.emit("keyedList.item.rerender.error", () => ({
                              key,
                              cause_type: Trace.causeValueType(reportedCause),
                            }));
                            if (Exit.isFailure(cleanupExit))
                              return yield* Effect.failCause(cleanupExit.cause);
                          });
                        }),
                        Effect.catchCause((cause) =>
                          committed ? Effect.failCause(cause) : handleUpdateCause(cause),
                        ),
                        Effect.ensuring(
                          Effect.suspend(() => {
                            if (currentState.rerenderFiber === rerenderFiber)
                              currentState.rerenderFiber = null;
                            currentState.isRerendering = false;
                            return resumeItemRerender(currentState);
                          }),
                        ),
                      );
                    }),
                  ).pipe(profileGranular),
                  {
                    ...itemRenderContext(currentState.scope),
                    // Compose once: list services win, while Scope and operation
                    // annotations remain with the owner and triggering worker.
                    services: Context.merge(forkContext, rowServices),
                  },
                  null,
                ),
              );
            });

            const state: ItemState = {
              renderPhase,
              element,
              result,
              startMarker,
              endMarker,
              item,
              currentIndex: i,
              isRerendering: false,
              rerenderFiber: null,
              pendingRerenderContext: null,
              subscriptions: new Map(),
              scope: itemScope,
              scheduleRerender: scheduleItemRerender,
            };
            const staged: StagedItem = {
              key,
              scope: itemScope,
              renderPhase,
              element,
              result,
              startMarker,
              endMarker,
              usesExistingDom: false,
              retainResult: false,
              retainScope: false,
              resultCleaned: false,
              scopeClosed: false,
            };
            stagedItems.push(staged);
            newItemStates.push({
              key,
              state,
              isNew: true,
              needsMove: false,
              needsRerender: false,
              nextItem: item,
              nextIndex: i,
              staged,
              commitKind: "replaced",
            });
          }
        }

        // Validate every changed existing row before touching the committed
        // structure. Reconciliation itself can mutate live nodes, so retain the
        // last committed element and restore every attempted row if a later one
        // fails. Replacement candidates remain detached until commit.
        const attemptedReconciles: Array<{
          readonly entry: (typeof newItemStates)[number];
          readonly preparation: RenderPreparation | undefined;
        }> = [];
        const rollbackAttemptedReconciles = Effect.fnUntraced(function* () {
          let rollbackCause: Cause.Cause<unknown> | null = null;
          for (let index = attemptedReconciles.length - 1; index >= 0; index--) {
            const attempted = attemptedReconciles[index];
            if (attempted === undefined) continue;
            const { entry, preparation } = attempted;
            if (entry.state.result.reconcile === undefined) continue;

            const rollbackExit = yield* Effect.exit(
              entry.state.result
                .reconcile(entry.state.element, context, preparation)
                .pipe(Scope.provide(entry.state.scope)),
            );
            const cause = Exit.isFailure(rollbackExit)
              ? rollbackExit.cause
              : rollbackExit.value
                ? null
                : Cause.die(new KeyedListRollbackError({ key: entry.key }));
            if (cause !== null) {
              rollbackCause = rollbackCause === null ? cause : Cause.combine(rollbackCause, cause);
            }
          }
          if (rollbackCause !== null) return yield* Effect.failCause(rollbackCause);
        });

        for (const entry of newItemStates) {
          if (!entry.needsRerender || entry.isNew || entry.staged === null) continue;
          const reconcile = entry.state.result.reconcile;
          if (reconcile === undefined) {
            entry.commitKind = "replaced";
            continue;
          }

          attemptedReconciles.push({ entry, preparation: entry.state.result.preparation });
          const staged = entry.staged;
          const reconcileExit = yield* Effect.exit(
            Effect.gen(function* () {
              const matched = yield* reconcile(
                staged.element,
                context,
                staged.preparation ?? staged.result.preparation,
              ).pipe(Scope.provide(entry.state.scope));
              // A preflight is a hint, not permission to ignore a later divergence.
              // Build under the already-owned preparation scope without rerunning user code.
              if (!matched && staged.usesExistingDom) {
                const built = yield* buildItemDom(
                  staged.element,
                  stagedParent,
                  itemRenderContext(staged.scope),
                  staged.preparation,
                ).pipe(Scope.provide(staged.scope));
                staged.result = built.result;
                staged.startMarker = built.startMarker;
                staged.endMarker = built.endMarker;
                staged.usesExistingDom = false;
                staged.retainResult = false;
              }
              return matched;
            }),
          );
          if (Exit.isFailure(reconcileExit)) {
            const rollbackExit = yield* Effect.exit(rollbackAttemptedReconciles());
            return yield* Effect.failCause(
              Exit.isFailure(rollbackExit)
                ? Cause.combine(reconcileExit.cause, rollbackExit.cause)
                : reconcileExit.cause,
            );
          }
          entry.commitKind = reconcileExit.value ? "reconciled" : "replaced";
        }

        // Nothing structural happens until every new and changed row has rendered
        // under staged ownership. A failure above restores attempted reconciliation
        // and leaves DOM order, committed item inputs, and keyed scopes intact.
        const removedItems: Array<{
          readonly key: string | number;
          readonly state: ItemState;
        }> = [];
        for (const key of keyOrder) {
          if (!newKeySet.has(key)) {
            const state = itemStates.get(key);
            if (state !== undefined) removedItems.push({ key, state });
          }
        }

        const previousKeyOrder = [...keyOrder];
        const entriesByKey = new Map(newItemStates.map((entry) => [entry.key, entry]));
        const retiredRows: Array<{
          readonly key: string | number;
          readonly state: ItemState;
          readonly result: RenderResult;
          readonly startMarker: Comment;
          readonly endMarker: Comment;
          readonly subscriptions: ReadonlyArray<Effect.Effect<void>>;
          readonly closeScope: boolean;
          detached: boolean;
        }> = [];
        for (const key of keyOrder) {
          const state = itemStates.get(key);
          if (state === undefined) continue;
          const entry = entriesByKey.get(key);
          const removed = !newKeySet.has(key);
          if (!removed && entry?.commitKind !== "replaced") continue;
          retiredRows.push({
            key,
            state,
            result: state.result,
            startMarker: state.startMarker,
            endMarker: state.endMarker,
            subscriptions: removed ? [...state.subscriptions.values()] : [],
            closeScope: removed,
            detached: false,
          });
        }

        // Publication and retirement form one interruption-safe transaction.
        // Once candidate ranges become visible, state and ownership are made
        // reachable before any old result or scope is allowed to release.
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            let moveCount = 0;

            if (keyOrder.length === 0) {
              const currentParent = anchor.parentNode;
              if (isUnmounted || currentParent === null) {
                yield* cleanupStagedItems;
                return;
              }
              if (stagedParent.firstChild !== null) {
                currentParent.insertBefore(stagedParent, anchor);
              }
            } else {
              let nextSibling: Node = anchor;
              for (let i = newItemStates.length - 1; i >= 0; i--) {
                const currentParent = anchor.parentNode;
                if (isUnmounted || currentParent === null) {
                  yield* cleanupStagedItems;
                  return;
                }

                const entry = newItemStates[i];
                if (entry === undefined) continue;
                const usesStagedRange = entry.isNew || entry.commitKind === "replaced";
                const range = usesStagedRange ? entry.staged : entry.state;
                if (range === null) continue;

                if (usesStagedRange || entry.needsMove) {
                  if (
                    range.startMarker.parentNode === null ||
                    range.endMarker.parentNode === null
                  ) {
                    continue;
                  }
                  if (
                    !usesStagedRange &&
                    (range.startMarker.parentNode !== currentParent ||
                      range.endMarker.parentNode !== currentParent)
                  ) {
                    continue;
                  }
                  if (nextSibling.parentNode !== currentParent) {
                    nextSibling = anchor;
                    if (nextSibling.parentNode !== currentParent) return;
                  }
                  moveRange(range.startMarker, range.endMarker, nextSibling);
                  moveCount++;
                }
                nextSibling = range.startMarker;
              }
            }

            let insertedCount = 0;
            let reconciledCount = 0;
            let replacedCount = 0;
            for (const entry of newItemStates) {
              const { staged, state } = entry;
              if (entry.isNew) {
                insertedCount++;
                if (staged !== null) {
                  staged.retainResult = true;
                  staged.retainScope = true;
                }
                itemStates.set(entry.key, state);
              } else if (entry.needsRerender && staged !== null) {
                staged.retainScope = true;
                if (entry.commitKind === "replaced") {
                  replacedCount++;
                  staged.retainResult = true;
                  state.result = staged.result;
                  state.startMarker = staged.startMarker;
                  state.endMarker = staged.endMarker;
                }
                if (entry.commitKind === "reconciled") reconciledCount++;
                state.renderPhase = staged.renderPhase;
                state.element = staged.element;
              }
              state.item = entry.nextItem;
              state.currentIndex = entry.nextIndex;
            }

            for (const { key } of removedItems) {
              const state = itemStates.get(key);
              if (state !== undefined) state.pendingRerenderContext = null;
              itemStates.delete(key);
            }
            keyOrder.length = 0;
            for (const key of newKeys) {
              if (key !== undefined) keyOrder.push(key);
            }

            // At this point every candidate result and scope is reachable from
            // the committed keyed snapshot. All remaining failures are honestly
            // post-commit and must never trigger candidate rollback.
            committed = true;

            const postCommit: Array<Effect.Effect<void, unknown, R>> = [];
            if (retiredRows.length > 0) {
              postCommit.push(
                Effect.sync(() => {
                  if (
                    retiredRows.length === oldKeyToIndex.size &&
                    detachContiguousItemRange(retiredRows)
                  ) {
                    for (const row of retiredRows) row.detached = true;
                  } else {
                    for (const row of retiredRows) {
                      row.detached = detachContiguousItemRange([row]);
                    }
                  }
                }),
              );
            }

            for (const entry of newItemStates) {
              if (entry.isNew) {
                postCommit.push(Trace.emit("keyedList.item.add", () => ({ key: entry.key })));
              }
            }
            for (const { key } of removedItems) {
              postCommit.push(Trace.emit("keyedList.item.remove", () => ({ key })));
            }

            for (const entry of newItemStates) {
              if (entry.isNew) {
                if (entry.state.renderPhase.accessed.size > 0) {
                  postCommit.push(
                    diffSubscriptions(
                      entry.key,
                      entry.state,
                      entry.state.renderPhase.accessed,
                      entry.state.scheduleRerender,
                    ),
                  );
                }
              } else if (entry.needsRerender && entry.staged !== null) {
                postCommit.push(
                  diffSubscriptions(
                    entry.key,
                    entry.state,
                    entry.staged.renderPhase.accessed,
                    entry.state.scheduleRerender,
                  ),
                );
              }
            }

            postCommit.push(
              Trace.emit("keyedList.reorder", () => ({
                total_items: newItemStates.length,
                moves: moveCount,
                stable_nodes: newItemStates.length - moveCount,
                inserted: insertedCount,
                removed: removedItems.length,
                reconciled: reconciledCount,
                replaced: replacedCount,
              })),
              Trace.emit("keyedList.state", () => ({
                phase: "after-reorder",
                key_order: previousKeyOrder,
                new_keys: newKeys,
                move_count: moveCount,
              })),
              Trace.emit("keyedList.state", () => ({
                phase: "committed",
                key_order: [...keyOrder],
              })),
            );

            for (const row of retiredRows) {
              postCommit.push(...row.subscriptions);
              const cleanupSync = row.result.cleanupSync;
              postCommit.push(
                row.closeScope && cleanupSync !== undefined && row.subscriptions.length === 0
                  ? Effect.sync(() => cleanupSync(row.detached))
                  : RenderTransaction.cleanup(row.result),
                Effect.sync(() => row.startMarker.remove()),
                Effect.sync(() => row.endMarker.remove()),
              );
              if (row.closeScope) {
                postCommit.push(Scope.close(row.state.scope, Exit.void));
              }
            }
            postCommit.push(cleanupStagedItems);
            yield* cleanupAll(postCommit);
          }),
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (committed) {
              yield* Trace.emit("keyedList.update.error", () => ({
                cause_type: Trace.causeValueType(cause),
              }));
              return yield* Effect.failCause(cause);
            }
            const cleanupExit = yield* Effect.exit(cleanupStagedItems);
            const reportedCause = Exit.isFailure(cleanupExit)
              ? Cause.combine(cause, cleanupExit.cause)
              : cause;
            yield* Trace.emit("keyedList.update.error", () => ({
              cause_type: Trace.causeValueType(reportedCause),
            }));
            yield* handleUpdateCause(reportedCause);
          }),
        ),
      ),
    ).pipe(
      Effect.ensuring(
        Effect.suspend(() => {
          isUpdating = false;
          if (pendingUpdate && !isUnmounted) {
            const nextContext = pendingUpdateContext;
            pendingUpdate = false;
            pendingUpdateContext = null;
            updateList(nextContext);
            return Effect.void;
          }
          if (isUnmounted || pendingRerenderKeys.size === 0) return Effect.void;
          return Effect.gen(function* () {
            for (const key of pendingRerenderKeys) {
              // A resumed row may synchronously start another source update.
              if (isUpdating || isUnmounted) break;
              pendingRerenderKeys.delete(key);
              const state = itemStates.get(key);
              if (state !== undefined) yield* resumeItemRerender(state);
            }
          });
        }),
      ),
    );

    const forkRuntime =
      forkContext === null
        ? updateContext
        : { ...updateContext, services: Context.merge(forkContext, rowServices) };

    // Structural reconcile passes (create / replace / append / reorder / remove)
    // are a single synchronous compute+DOM unit. Run the forked update fiber under
    // Scheduler.PreventSchedulerYield so it completes in one macrotask instead of
    // injecting cooperative setTimeout(0) yields — each Chrome-clamped to ~4.5ms of
    // pure main-thread idle — once op-count crosses MaxOpsBeforeYield. Granular
    // per-item re-renders fork separately (scheduleItemRerender) and keep cooperative
    // scheduling, so interactive single-row updates are unaffected.
    deps.runForkInRenderContext(
      profileUpdate(updateEffect),
      forkRuntime,
      forkContext === null ? context : null,
      {
        preventSchedulerYield: true,
      },
    );
  }

  // Initial render.
  yield* Effect.sync(() => updateList());

  // Subscribe to source signal changes. Capture the listener fiber context so
  // verifier annotations such as Trace.withAction follow the forked update.
  const unsubscribeSource = yield* Signal.subscribe(source, () =>
    Effect.gen(function* () {
      const forkContext = yield* Effect.context<never>();
      updateList(unsafeWidenContext(forkContext));
    }),
  );

  return {
    node: anchor,
    cleanup: Effect.gen(function* () {
      isUnmounted = true;
      pendingUpdate = false;
      pendingUpdateContext = null;

      const mountedStates = currentStatesInDomOrder();
      detachContiguousItemRange(mountedStates);
      const cleanups: Array<Effect.Effect<void, unknown, R>> = [
        unsubscribeSource,
        Scope.close(updateScope, Exit.void),
      ];
      for (const state of mountedStates) {
        state.pendingRerenderContext = null;
        for (const [, unsubscribe] of state.subscriptions) {
          cleanups.push(unsubscribe);
        }
        cleanups.push(
          RenderTransaction.cleanup(state.result),
          Effect.sync(() => state.startMarker.remove()),
          Effect.sync(() => state.endMarker.remove()),
          Scope.close(state.scope, Exit.void),
        );
      }
      cleanups.push(
        Effect.sync(() => {
          itemStates.clear();
          pendingRerenderKeys.clear();
        }),
        Scope.close(listScope, Exit.void),
        Effect.sync(() => anchor.remove()),
      );
      yield* cleanupAll(cleanups);
    }),
  };
});
