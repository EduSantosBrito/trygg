import { Cause, Effect, Exit, Scope } from "effect";
import * as Context from "effect/Context";
import { Element } from "./element.js";
import * as Signal from "./signal.js";
import * as Trace from "../trace/index.js";
import { moveRange } from "./render-utils.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";
import { sharedRenderTransaction } from "./render-transaction.js";
import { unsafeWidenContext } from "../internal/unsafe.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderKeyedListDeps<E, R> {
  readonly provideRenderContext: <A, E2, R2>(
    effect: Effect.Effect<A, E2, R2>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => Effect.Effect<A, E2, R | R2>;
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
  ) => RenderResult | null;
  readonly runForkInRenderContext: <E2, R2>(
    effect: Effect.Effect<void, E2, R2>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options?: { readonly preventSchedulerYield?: boolean },
  ) => void;
}

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
  // Create anchor comment for the list
  const anchor = document.createComment("keyed-list");
  parent.appendChild(anchor);
  const renderTransaction = sharedRenderTransaction;

  // Track item states by key
  type ItemState = {
    renderPhase: Signal.RenderPhase;
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
    /** Whether another re-render is pending */
    pendingRerender: boolean;
    /** Map from signal debugId to unsubscribe Effect */
    subscriptions: Map<string, Effect.Effect<void>>;
    /** Scope that owns render-function signals and child component scopes for this keyed item */
    scope: Scope.Closeable;
    /** Trigger item rerender while preserving scope */
    scheduleRerender: () => Effect.Effect<void>;
  };
  const itemStates = new Map<string | number, ItemState>();
  const keyOrder: Array<string | number> = [];
  const listScope = yield* Scope.fork(yield* Effect.scope);
  let isUnmounted = false;
  let isUpdating = false;
  let pendingUpdate = false;

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
    const renderEffect = deps.provideRenderContext(renderFn(item, index), runtime, context);
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
  ) {
    const listParent = parentOverride ?? anchor.parentNode ?? parent;

    // Insert start marker before rendering so content appears after it
    const startMarker = document.createComment("item-start");
    listParent.appendChild(startMarker);

    // Synchronous fast path: a fully-static row subtree builds inline, skipping a
    // per-row `renderElement` Effect dispatch (one `Effect.sync` primitive
    // allocation + one run-loop step saved for every row of the create/replace/
    // append cluster). `renderElementSync` returns `null` for rows that need the
    // effectful renderer (signal/component/keyed children), which fall back to the
    // original `yield* renderElement` path.
    const syncResult = deps.renderElementSync(normalizedElement, listParent, runtime, context);
    const result =
      syncResult !== null
        ? syncResult
        : yield* deps.renderElement(normalizedElement, listParent, runtime, context, options);

    // Insert end marker after content - ensures moveRange captures full Fragment range
    const endMarker = document.createComment("item-end");
    listParent.appendChild(endMarker);

    return { result, startMarker, endMarker };
  });

  // Helper to render a single item with a stable render phase. `Effect.fnUntraced`
  // (no span) — the Scope-provided inner `Effect.gen` is the only extra Effect
  // boundary the run loop drives per row.
  const renderItem = Effect.fnUntraced(function* (
    item: T,
    index: number,
    existingPhase: Signal.RenderPhase | null,
    itemScope: Scope.Closeable,
    parentOverride?: Node,
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
    return yield* Effect.gen(function* () {
      const normalizedElement = yield* runRenderFn(item, index, renderPhase);
      const { result, startMarker, endMarker } = yield* buildItemDom(
        normalizedElement,
        parentOverride,
      );
      return { renderPhase, result, startMarker, endMarker };
    }).pipe(
      Scope.provide(itemScope),
      // Close the forked item scope if the render fails (the only failure-prone
      // work — `runRenderFn` + `buildItemDom` — lives inside the gen above; the
      // preceding phase setup is synchronous/infallible). Folded in here so the
      // create call site can `yield*`-delegate `renderItem` directly.
      Effect.onError(() => Scope.close(itemScope, Exit.void)),
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
  const detachContiguousItemRange = (states: ReadonlyArray<ItemState>): boolean => {
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
  function updateList(
    forkContext: Context.Context<unknown> | null = null,
  ): void {
    if (isUnmounted) return;

    if (isUpdating) {
      pendingUpdate = true;
      return;
    }

    isUpdating = true;

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
          }
        }

        // Remove items that are no longer in the list
        const removedItems: Array<{
          readonly key: string | number;
          readonly state: ItemState;
        }> = [];
        for (const key of keyOrder) {
          if (!newKeySet.has(key)) {
            const state = itemStates.get(key);
            if (state !== undefined) {
              removedItems.push({ key, state });
            }
          }
        }

        // Full clear: pull the entire row range off-document in ONE range
        // extraction. `detached` then lets the per-row teardown below skip the
        // now-redundant root/marker `.remove()` calls — those nodes already live in
        // the discarded fragment, so re-removing them is pure waste.
        const detached =
          removedItems.length === keyOrder.length &&
          detachContiguousItemRange(removedItems.map((item) => item.state));

        // Synchronous batch teardown. A removed row whose render result exposes a
        // sync cleanup core (the static fast-path) and holds no keyed-list-level
        // subscriptions is torn down entirely in plain JS — cleanup, marker
        // removal, scope close — inside ONE Effect.sync, instead of driving ~4
        // primitives per row through the runLoop (the renderTransaction.cleanup
        // wrapper alone is an fnUntraced suspend + a trace + a context-provide).
        // This is the teardown analog of the static-build fast-path and the
        // dominant cost on the keyed-list clear op. Rows with effectful cleanup or
        // live subscriptions fall back to the per-row effectful path. Scope.close
        // for a fast-path item scope runs a single reciprocal parent-unregister
        // finalizer (Scope.closeUnsafe returns it as one cheap Sync); collect and
        // run those after the sync pass. Exactly one keyedList.item.remove per
        // removed row is preserved (perf-contract), in removedItems order.
        const slowRemovals: Array<{ key: string | number; state: ItemState }> = [];
        const reciprocalCloses: Array<Effect.Effect<void>> = [];
        yield* Effect.sync(() => {
          for (const removal of removedItems) {
            const { key, state } = removal;
            const cleanupSync = state.result.cleanupSync;
            if (cleanupSync !== undefined && state.subscriptions.size === 0) {
              cleanupSync(detached);
              if (!detached) {
                state.startMarker.remove();
                state.endMarker.remove();
              }
              const close = Scope.closeUnsafe(state.scope, Exit.void);
              if (close !== undefined) reciprocalCloses.push(close);
              itemStates.delete(key);
            } else {
              slowRemovals.push(removal);
            }
          }
        });
        for (const close of reciprocalCloses) {
          yield* close;
        }
        for (const { key, state } of slowRemovals) {
          // Clean up subscriptions
          for (const [, unsubscribe] of state.subscriptions) {
            yield* unsubscribe;
          }
          // Clean up rendered content + markers
          yield* renderTransaction.cleanup(state.result);
          state.startMarker.remove();
          state.endMarker.remove();
          yield* Scope.close(state.scope, Exit.void);
          itemStates.delete(key);
        }
        for (const { key } of removedItems) {
          yield* Trace.emit("keyedList.item.remove", () => ({ key }));
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
        const stagedParent = document.createDocumentFragment();
        const newItemStates: Array<{
          key: string | number;
          state: ItemState;
          isNew: boolean;
          needsMove: boolean;
          needsRerender: boolean;
        }> = [];

        for (const [i, item] of items.entries()) {
          const key = newKeys[i];

          if (key === undefined) continue;

          const existingState = itemStates.get(key);
          const oldIndex = oldKeyToIndex.get(key);

          if (existingState !== undefined && oldIndex !== undefined) {
            // Item exists - update stored item reference
            // If item identity changed, schedule rerender later.
            const needsRerender = !Object.is(existingState.item, item);
            existingState.item = item;
            // Check if this item needs to move (not in LIS)
            const needsMove = !stableOldIndices.has(oldIndex);
            newItemStates.push({
              key,
              state: existingState,
              isNew: false,
              needsMove,
              needsRerender,
            });
          } else {
            // New item - create new state. Fork the item scope synchronously
            // (Scope.fork === sync(() => Scope.forkUnsafe(...)); forking unsafely
            // here skips one run-loop Effect.sync step per row with identical
            // parent/child finalizer wiring). The create-path error boundary below
            // still closes + detaches it on failure.
            const itemScope = Scope.forkUnsafe(listScope);
            const { renderPhase, result, startMarker, endMarker } = yield* renderItem(
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
              const currentState = yield* Effect.sync(() => {
                if (isUnmounted) return null;
                const state = itemStates.get(key);
                if (state === undefined) return null;

                // Coalesce rapid signal changes - mark pending if already rerendering
                if (state.isRerendering) {
                  state.pendingRerender = true;
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
                      // Re-render with the same phase (preserves signals). First
                      // try an in-place reconcile: re-run the render fn for the new
                      // value and ask the existing result to patch its own DOM
                      // (changed text/props on the SAME nodes). On success we touch
                      // only what changed — no new subtree, no teardown, node identity
                      // preserved (the update-row hot path: 100 immutable-row updates
                      // become 100 text-data writes instead of 100 subtree rebuilds).
                      // On structural divergence the reconcile returns false and we
                      // fall back to building a fresh subtree from the SAME already-
                      // rendered element (the render fn runs exactly once) and swap.
                      const oldStartMarker = currentState.startMarker;
                      const oldEndMarker = currentState.endMarker;

                      // Track new nodes for cleanup on error (set only on the replace
                      // fallback; the reconcile path creates no new DOM).
                      let newResult: RenderResult | null = null;
                      let newStartMarker: Comment | null = null;
                      let newEndMarker: Comment | null = null;

                      yield* Effect.gen(function* () {
                        const reconcile = currentState.result.reconcile;
                        // Run the render fn once under the item's own scope, then
                        // either reconcile in place or build a replacement subtree.
                        const outcome = yield* Effect.gen(function* () {
                          yield* Signal.resetRenderPhase(currentState.renderPhase);
                          const normalizedElement = yield* runRenderFn(
                            currentState.item,
                            currentState.currentIndex,
                            currentState.renderPhase,
                          );
                          if (reconcile !== undefined) {
                            const patched = yield* reconcile(normalizedElement, context);
                            if (patched) return { reconciled: true as const };
                          }
                          const built = yield* buildItemDom(normalizedElement);
                          return { reconciled: false as const, built };
                        }).pipe(Scope.provide(currentState.scope));

                        if (!outcome.reconciled) {
                          newResult = outcome.built.result;
                          newStartMarker = outcome.built.startMarker;
                          newEndMarker = outcome.built.endMarker;

                          // Move new range [newStartMarker..newEndMarker] before old start
                          moveRange(newStartMarker, newEndMarker, oldStartMarker);

                          // Clean up old render (removes old content)
                          yield* renderTransaction.cleanup(currentState.result);
                          oldStartMarker.remove();
                          oldEndMarker.remove();

                          // Update state
                          currentState.result = newResult;
                          currentState.startMarker = newStartMarker;
                          currentState.endMarker = newEndMarker;
                        }
                        // Reconcile success leaves markers, scope and result in place —
                        // only changed text/props/listeners on the existing nodes moved.

                        // Check if another re-render was requested during this render
                        const needsAnotherRender = currentState.pendingRerender;
                        currentState.isRerendering = false;
                        currentState.pendingRerender = false;

                        yield* Trace.emit("keyedList.item.rerender", () => ({ key }));

                        // Diff subscriptions (reuse stable ones)
                        yield* diffSubscriptions(
                          key,
                          currentState,
                          currentState.renderPhase.accessed,
                          scheduleItemRerender,
                        );

                        // If a signal changed during re-render, schedule another
                        if (needsAnotherRender) {
                          yield* scheduleItemRerender();
                        }
                      }).pipe(
                        Effect.catchCause((cause) =>
                          Effect.gen(function* () {
                            // Cleanup new render result, ensuring markers are removed
                            // even if cleanup fails (prevents DOM leaks)
                            yield* Effect.ensuring(
                              newResult !== null
                                ? renderTransaction.cleanup(newResult)
                                : Effect.void,
                              Effect.sync(() => {
                                if (newStartMarker !== null) newStartMarker.remove();
                                if (newEndMarker !== null) newEndMarker.remove();
                              }),
                            );
                            // Reset flags on error to allow retry
                            currentState.isRerendering = false;
                            currentState.pendingRerender = false;
                            yield* Trace.emit("keyedList.item.rerender.error", () => ({
                              key,
                              reason: Cause.pretty(cause),
                            }));
                          }),
                        ),
                      );
                    }),
                  ),
                  runtime,
                  context,
                ),
              );
            });

            const state: ItemState = {
              renderPhase,
              result,
              startMarker,
              endMarker,
              item,
              currentIndex: i,
              isRerendering: false,
              pendingRerender: false,
              subscriptions: new Map(),
              scope: itemScope,
              scheduleRerender: scheduleItemRerender,
            };

            // Initial subscription setup. On the create path `state.subscriptions`
            // is freshly empty (line above), so when the render read no signals
            // (`accessed` empty) diffSubscriptions would only swap one empty Map for
            // another — skip the fiber spin entirely. The re-render call site keeps
            // calling unconditionally: there `subscriptions` may hold stale entries
            // that must be unsubscribed even when the new render reads nothing.
            if (renderPhase.accessed.size > 0) {
              yield* diffSubscriptions(key, state, renderPhase.accessed, scheduleItemRerender);
            }

            itemStates.set(key, state);
            newItemStates.push({
              key,
              state,
              isNew: true,
              needsMove: false,
              needsRerender: false,
            });
            yield* Trace.emit("keyedList.item.add", () => ({ key }));
          }
        }

        // Reorder DOM nodes using minimal moves (LIS optimization).
        // Initial create is already rendered in order into a DocumentFragment;
        // insert it once so the create path is not counted as N DOM moves.
        let moveCount = 0;
        const rerenderStates: Array<ItemState> = [];

        if (keyOrder.length === 0) {
          const currentParent = anchor.parentNode;
          if (isUnmounted || currentParent === null) {
            return;
          }

          if (stagedParent.firstChild !== null) {
            currentParent.insertBefore(stagedParent, anchor);
          }

          for (const [i, entry] of newItemStates.entries()) {
            entry.state.currentIndex = i;
          }
        } else {
          // Process from end to start, keeping track of next sibling reference.
          // Nodes in LIS stay in place; only move nodes not in LIS. Move the
          // full range [startMarker..endMarker] so content stays with its anchor.
          let nextSibling: Node = anchor;

          // Iterate in reverse to build correct order
          for (let i = newItemStates.length - 1; i >= 0; i--) {
            const currentParent = anchor.parentNode;
            if (isUnmounted || currentParent === null) {
              return;
            }

            const entry = newItemStates[i];
            if (entry === undefined) continue;
            const { state, isNew, needsMove, needsRerender } = entry;

            // Update currentIndex so re-renders use correct index
            state.currentIndex = i;

            if (isNew || needsMove) {
              if (state.startMarker.parentNode === null || state.endMarker.parentNode === null) {
                continue;
              }

              if (
                !isNew &&
                (state.startMarker.parentNode !== currentParent ||
                  state.endMarker.parentNode !== currentParent)
              ) {
                continue;
              }

              if (nextSibling.parentNode !== currentParent) {
                nextSibling = anchor;
                if (nextSibling.parentNode !== currentParent) {
                  return;
                }
              }

              // Move the entire item range [startMarker..endMarker] before nextSibling
              moveRange(state.startMarker, state.endMarker, nextSibling);
              moveCount++;
            }
            // Update next sibling reference: use startMarker since it's the
            // first node of this item's range
            nextSibling = state.startMarker;

            // Re-render items with same key but new value.
            if (needsRerender && !needsMove) {
              rerenderStates.push(state);
            }
          }
        }

        yield* Trace.emit("keyedList.reorder", () => ({
          total_items: newItemStates.length,
          moves: moveCount,
          stable_nodes: newItemStates.length - moveCount,
        }));

        yield* Trace.emit("keyedList.state", () => ({
          phase: "after-reorder",
          key_order: [...keyOrder],
          new_keys: newKeys,
          move_count: moveCount,
        }));

        // Re-render changed items only when order is stable.
        // When reorder happened, defer to next source update to avoid
        // interfering with move sequencing for fragment ranges.
        if (moveCount === 0) {
          for (const state of rerenderStates) {
            yield* state.scheduleRerender();
          }
        }

        // Update key order
        keyOrder.length = 0;
        for (const key of newKeys) {
          if (key !== undefined) {
            keyOrder.push(key);
          }
        }

        yield* Trace.emit("keyedList.state", () => ({
          phase: "committed",
          key_order: [...keyOrder],
        }));
      }).pipe(
        Effect.catchCause((cause) =>
          Trace.emit("keyedList.update.error", () => ({ reason: Cause.pretty(cause) })),
        ),
      ),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          isUpdating = false;
          if (pendingUpdate && !isUnmounted) {
            pendingUpdate = false;
            updateList();
          }
        }),
      ),
    );

    const forkRuntime =
      forkContext === null
        ? runtime
        : { ...runtime, services: Context.merge(runtime.services, forkContext) };

    // Structural reconcile passes (create / replace / append / reorder / remove)
    // are a single synchronous compute+DOM unit. Run the forked update fiber under
    // Scheduler.PreventSchedulerYield so it completes in one macrotask instead of
    // injecting cooperative setTimeout(0) yields — each Chrome-clamped to ~4.5ms of
    // pure main-thread idle — once op-count crosses MaxOpsBeforeYield. Granular
    // per-item re-renders fork separately (scheduleItemRerender) and keep cooperative
    // scheduling, so interactive single-row updates are unaffected.
    deps.runForkInRenderContext(updateEffect, forkRuntime, context, {
      preventSchedulerYield: true,
    });
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
      yield* unsubscribeSource;

      // Clean up all items
      const mountedStates = currentStatesInDomOrder();
      detachContiguousItemRange(mountedStates);

      for (const state of mountedStates) {
        for (const [, unsubscribe] of state.subscriptions) {
          yield* unsubscribe;
        }
        yield* renderTransaction.cleanup(state.result);
        state.startMarker.remove();
        state.endMarker.remove();
        yield* Scope.close(state.scope, Exit.void);
      }
      itemStates.clear();
      yield* Scope.close(listScope, Exit.void);
      anchor.remove();
    }),
  };
});
