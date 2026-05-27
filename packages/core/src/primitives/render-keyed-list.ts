import { Effect, Exit, Scope } from "effect";
import * as Context from "effect/Context";
import { Element } from "./element.js";
import * as Signal from "./signal.js";
import * as Debug from "../debug/debug.js";
import { moveRange } from "./render-utils.js";
import type { ErrorBoundaryHandler, RenderContext, RenderResult } from "./renderer.js";

interface RenderOptions {
  readonly errorHandler: ErrorBoundaryHandler | null;
}

interface RenderKeyedListDeps {
  readonly provideRenderContext: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
  ) => Effect.Effect<A, E, unknown>;
  readonly renderElement: (
    element: Element,
    parent: Node,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
    options: RenderOptions,
  ) => Effect.Effect<RenderResult, unknown, unknown>;
  readonly runForkInRenderContext: (
    effect: Effect.Effect<void, unknown, unknown>,
    renderContext: RenderContext,
    context: Context.Context<unknown> | null,
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

export const renderKeyedList = (
  source: Signal.Signal<ReadonlyArray<unknown>>,
  renderFn: (item: unknown, index: number) => Effect.Effect<unknown, unknown, unknown>,
  keyFn: (item: unknown, index: number) => string | number,
  parent: Node,
  runtime: RenderContext,
  context: Context.Context<unknown> | null,
  options: RenderOptions,
  deps: RenderKeyedListDeps,
): Effect.Effect<RenderResult, unknown, unknown> =>
  Effect.gen(function* () {
    // Create anchor comment for the list
    const anchor = document.createComment("keyed-list");
    parent.appendChild(anchor);

    // Track item states by key
    type ItemState = {
      renderPhase: Signal.RenderPhase;
      result: RenderResult;
      /** Comment marking start of this item's DOM range */
      startMarker: Comment;
      /** Comment marking end of this item's DOM range (always after content) */
      endMarker: Comment;
      item: unknown;
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

    // Helper to render a single item with a stable render phase
    const renderItem = Effect.fn("renderItem")(function* (
      item: unknown,
      index: number,
      existingPhase: Signal.RenderPhase | null,
      itemScope: Scope.Closeable,
      parentOverride?: Node,
    ) {
      // Use existing phase or create new one
      const renderPhase = existingPhase ?? (yield* Signal.makeRenderPhase);

      if (existingPhase !== null) {
        // Reset for re-render
        yield* Signal.resetRenderPhase(renderPhase);
      }

      // Execute render function with render phase context and parent context
      const renderEffect = deps.provideRenderContext(renderFn(item, index), runtime, context);

      const element = yield* Effect.provideService(
        renderEffect,
        Signal.CurrentRenderPhase,
        renderPhase,
      ).pipe(Scope.provide(itemScope));

      const listParent = parentOverride ?? anchor.parentNode ?? parent;

      // Insert start marker before rendering so content appears after it
      const startMarker = document.createComment("item-start");
      listParent.appendChild(startMarker);

      // Render into list parent (content appended after startMarker)
      const normalizedElement = yield* Element.fromUnknown(element);
      const result = yield* deps
        .renderElement(normalizedElement, listParent, runtime, context, options)
        .pipe(Scope.provide(itemScope));

      // Insert end marker after content - ensures moveRange captures full Fragment range
      const endMarker = document.createComment("item-end");
      listParent.appendChild(endMarker);

      return { renderPhase, result, startMarker, endMarker };
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
    function updateList(): void {
      if (isUnmounted) return;

      if (isUpdating) {
        pendingUpdate = true;
        return;
      }

      isUpdating = true;

      deps.runForkInRenderContext(
        Effect.scoped(
          Effect.gen(function* () {
            yield* Debug.log({
              event: "render.keyedlist.update",
              current_keys: keyOrder.length,
            });

            yield* Debug.log({
              event: "render.keyedlist.state",
              phase: "start",
              key_order: [...keyOrder],
            });

            if (isUnmounted || anchor.parentNode === null) {
              return;
            }

            // Get current items from source signal
            const items = yield* Signal.get(source);

            // Compute new keys
            const newKeys = items.map((item, i) => keyFn(item, i));
            const newKeySet = new Set(newKeys);

            yield* Debug.log({
              event: "render.keyedlist.state",
              phase: "computed",
              key_order: [...keyOrder],
              new_keys: newKeys,
            });

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
                  // Clean up rendered content + markers
                  yield* state.result.cleanup;
                  state.startMarker.remove();
                  state.endMarker.remove();
                  yield* Scope.close(state.scope, Exit.void);
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
            const stagedParent = document.createDocumentFragment();
            const newItemStates: Array<{
              key: string | number;
              state: ItemState;
              isNew: boolean;
              needsMove: boolean;
              needsRerender: boolean;
            }> = [];

            for (let i = 0; i < items.length; i++) {
              const item = items[i];
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
                // New item - create new state
                const itemScope = yield* Scope.fork(listScope);
                const { renderPhase, result, startMarker, endMarker } = yield* renderItem(
                  item,
                  i,
                  null,
                  itemScope,
                  stagedParent,
                ).pipe(Effect.onError(() => Scope.close(itemScope, Exit.void)));

                // Set up subscriptions for this item's accessed signals.
                // scheduleItemRerender returns lightweight Effect.sync to avoid blocking
                // signal notification chain. Actual re-render forks via Runtime.runFork.
                // Batching via isRerendering/pendingRerender coalesces rapid updates.
                const scheduleItemRerender = (): Effect.Effect<void> =>
                  Effect.sync(() => {
                    if (isUnmounted) return;
                    const currentState = itemStates.get(key);
                    if (currentState === undefined) return;

                    // Coalesce rapid signal changes - mark pending if already rerendering
                    if (currentState.isRerendering) {
                      currentState.pendingRerender = true;
                      return;
                    }
                    currentState.isRerendering = true;

                    deps.runForkInRenderContext(
                      Effect.scoped(
                        Effect.gen(function* () {
                          // Re-render with same phase (preserves signals).
                          // renderItem appends [startMarker, content, endMarker] to listParent.
                          // We then move the new nodes before the old startMarker and
                          // clean up the old range to preserve DOM order.
                          const oldStartMarker = currentState.startMarker;
                          const oldEndMarker = currentState.endMarker;

                          // Track new nodes for cleanup on error
                          let newResult: RenderResult | null = null;
                          let newStartMarker: Comment | null = null;
                          let newEndMarker: Comment | null = null;

                          yield* Effect.gen(function* () {
                            const rendered = yield* renderItem(
                              currentState.item,
                              currentState.currentIndex,
                              currentState.renderPhase,
                              currentState.scope,
                            );
                            newResult = rendered.result;
                            newStartMarker = rendered.startMarker;
                            newEndMarker = rendered.endMarker;

                            // Move new range [newStartMarker..newEndMarker] before old start
                            moveRange(newStartMarker, newEndMarker, oldStartMarker);

                            // Clean up old render (removes old content)
                            yield* currentState.result.cleanup;
                            oldStartMarker.remove();
                            oldEndMarker.remove();

                            // Update state
                            currentState.result = newResult;
                            currentState.startMarker = newStartMarker;
                            currentState.endMarker = newEndMarker;

                            // Check if another re-render was requested during this render
                            const needsAnotherRender = currentState.pendingRerender;
                            currentState.isRerendering = false;
                            currentState.pendingRerender = false;

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
                                  newResult !== null ? newResult.cleanup : Effect.void,
                                  Effect.sync(() => {
                                    if (newStartMarker !== null) newStartMarker.remove();
                                    if (newEndMarker !== null) newEndMarker.remove();
                                  }),
                                );
                                // Reset flags on error to allow retry
                                currentState.isRerendering = false;
                                currentState.pendingRerender = false;
                                yield* Debug.log({
                                  event: "render.keyedlist.item.rerender.error",
                                  key,
                                  reason: String(cause),
                                });
                              }),
                            ),
                          );
                        }),
                      ),
                      runtime,
                      context,
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

                // Initial subscription setup
                yield* diffSubscriptions(key, state, renderPhase.accessed, scheduleItemRerender);

                itemStates.set(key, state);
                newItemStates.push({
                  key,
                  state,
                  isNew: true,
                  needsMove: false,
                  needsRerender: false,
                });
                yield* Debug.log({
                  event: "render.keyedlist.item.add",
                  key,
                });
              }
            }

            // Reorder DOM nodes using minimal moves (LIS optimization)
            // Process from end to start, keeping track of next sibling reference
            // Nodes in LIS stay in place; only move nodes not in LIS
            // Move the full range [startMarker..node] so content stays with its anchor
            let moveCount = 0;
            let nextSibling: Node = anchor;
            const rerenderStates: Array<ItemState> = [];

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

            yield* Debug.log({
              event: "render.keyedlist.reorder",
              total_items: newItemStates.length,
              moves: moveCount,
              stable_nodes: newItemStates.length - moveCount,
            });

            yield* Debug.log({
              event: "render.keyedlist.state",
              phase: "after-reorder",
              key_order: [...keyOrder],
              new_keys: newKeys,
              move_count: moveCount,
            });

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

            yield* Debug.log({
              event: "render.keyedlist.state",
              phase: "committed",
              key_order: [...keyOrder],
            });
          }).pipe(
            Effect.catchCause((cause) =>
              Debug.log({
                event: "render.keyedlist.update.error",
                reason: String(cause),
              }),
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
        ),
        runtime,
        context,
      );
    }

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
