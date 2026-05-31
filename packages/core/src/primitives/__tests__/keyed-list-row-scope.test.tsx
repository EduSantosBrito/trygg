/**
 * Per-row scope lifecycle regression tests for keyed lists (`Signal.each`).
 *
 * These lock in the *current, source-verified* ownership semantics of the
 * per-row item scope so a future refactor of the keyed-list create path
 * (e.g. dropping or re-homing the per-row `Scope.forkUnsafe`) cannot silently
 * regress them.
 *
 * What is guarded:
 *   1. A per-row owned signal (`Signal.make`) created inside a row body is
 *      disposed when *that* row is removed, and stays live when a sibling is
 *      removed.
 *   2. `Signal.selector` output signals created per row (the krausest
 *      `classFor(row.id)` pattern in main.tsx) are disposed on row removal, and
 *      the shared selector keeps serving the surviving rows (the bucket entry
 *      for the removed key is cleaned up — no stale recompute).
 *   3. A finalizer registered in a row body (i.e. on the ambient item scope)
 *      runs on single-row removal, and again for any survivors on full list
 *      unmount.
 *   4. An in-flight event-handler fiber is owned by the *mount* scope, not the
 *      per-row scope: removing the row does NOT interrupt it, but unmounting the
 *      list does.
 *
 * Source basis (effect 4.0.0-beta.68):
 *   - render-keyed-list.ts: `itemScope = Scope.forkUnsafe(listScope)`, provided
 *     as the ambient `Effect.scope` for each row render (`Scope.provide`).
 *   - signal.ts `select()`: owner scope = `CurrentRenderScope ?? Effect.scope`.
 *     Fork services never carry `CurrentRenderScope` (renderer.ts
 *     `mergeRenderServices`), and `runForkWith` seeds the fiber context from the
 *     provided ServiceMap only (internal/effect.ts `FiberImpl` ctor →
 *     `setContext`/`getRef`), so the reference resolves to its `null` default
 *     and the owner falls through to the ambient item scope. `Signal.make` is
 *     owned the same way via `currentOwnerScope()`.
 *   - render-intrinsic.ts:334-352: the event listener forks the handler fiber
 *     and registers `Scope.addFinalizer(eventSnapshot.scope, Fiber.interrupt)`,
 *     and `eventSnapshot.scope === renderContext.scope` (the mount scope), NOT
 *     the per-row item scope.
 */
import { assert, describe, effect } from "@effect/vitest";
import { Deferred, Effect, Exit, Ref, Scope } from "effect";
import * as Signal from "../signal.js";
import { click, render } from "../../testing/index.js";

interface Row {
  readonly id: number;
  readonly label: string;
}

const rows3: readonly Row[] = [
  { id: 1, label: "a" },
  { id: 2, label: "b" },
  { id: 3, label: "c" },
];

// =============================================================================
// 1. Per-row owned signal (`Signal.make`) disposal
// =============================================================================

describe("KeyedList per-row scope: owned signal disposal", () => {
  effect("disposes a row's Signal.make when that row is removed, not when a sibling is", () =>
    Effect.gen(function* () {
      const data = yield* Signal.make<readonly Row[]>(rows3);
      const owned = new Map<number, Signal.Signal<string>>();

      const { container } = yield* render(
        <div>
          {Signal.each(
            data,
            Effect.fnUntraced(function* (row: Row) {
              const local = yield* Signal.make(`v-${row.id}`);
              owned.set(row.id, local);
              return <div data-id={row.id} className={local} />;
            }),
            { key: (row) => row.id },
          )}
        </div>,
      );

      assert.strictEqual(container.querySelectorAll("[data-id]").length, 3);
      const isDisposed = (id: number) => Ref.get(owned.get(id)!._disposed);

      // Nothing disposed before any removal.
      assert.strictEqual(yield* isDisposed(1), false);
      assert.strictEqual(yield* isDisposed(2), false);

      // Remove only row 2.
      yield* Signal.update(data, (d) => d.filter((r) => r.id !== 2));
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      // The removed row's signal is disposed; survivors stay live.
      assert.strictEqual(yield* isDisposed(2), true);
      assert.strictEqual(yield* isDisposed(1), false);
      assert.strictEqual(yield* isDisposed(3), false);
    }),
  );
});

// =============================================================================
// 2. Per-row `Signal.selector` output disposal (the `classFor` pattern)
// =============================================================================

describe("KeyedList per-row scope: Signal.selector disposal (classFor pattern)", () => {
  effect("disposes the per-row selector output on removal; selector still serves survivors", () =>
    Effect.gen(function* () {
      const data = yield* Signal.make<readonly Row[]>(rows3);
      const selected = yield* Signal.make<number>(2);
      const classFor = yield* Signal.selector(selected, (isSel) => (isSel ? "danger" : ""));
      const outputs = new Map<number, Signal.Signal<string>>();

      const { container } = yield* render(
        <div>
          {Signal.each(
            data,
            Effect.fnUntraced(function* (row: Row) {
              const className = yield* classFor(row.id);
              outputs.set(row.id, className);
              return <div data-id={row.id} className={className} />;
            }),
            { key: (row) => row.id },
          )}
        </div>,
      );

      const classOf = (id: number) =>
        (container.querySelector(`[data-id="${id}"]`) as HTMLElement | null)?.className ?? null;

      // selected === 2 → row 2 is "danger".
      assert.strictEqual(classOf(2), "danger");
      assert.strictEqual(classOf(1), "");
      assert.strictEqual(classOf(3), "");

      // Remove the selected row.
      yield* Signal.update(data, (d) => d.filter((r) => r.id !== 2));
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      // Its selector output signal is disposed; the survivor's is not.
      assert.strictEqual(yield* Ref.get(outputs.get(2)!._disposed), true);
      assert.strictEqual(yield* Ref.get(outputs.get(1)!._disposed), false);

      // The shared selector still drives survivors: selecting row 3 makes it
      // "danger". This would break if the removed row's bucket entry leaked
      // (stale recompute against a disposed output).
      yield* Signal.set(selected, 3);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      assert.strictEqual(classOf(3), "danger");
      assert.strictEqual(classOf(1), "");
    }),
  );
});

// =============================================================================
// 3. Item-scope finalizers: single-row removal vs full unmount
// =============================================================================

describe("KeyedList per-row scope: item-scope finalizers", () => {
  effect("runs a row-body finalizer on single-row removal and on full unmount", () =>
    Effect.gen(function* () {
      const mountScope = yield* Scope.make();
      const data = yield* Signal.make<readonly Row[]>(rows3);
      const cleaned: number[] = [];

      yield* render(
        <div>
          {Signal.each(
            data,
            Effect.fnUntraced(function* (row: Row) {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  cleaned.push(row.id);
                }),
              );
              return <div data-id={row.id} />;
            }),
            { key: (row) => row.id },
          )}
        </div>,
      ).pipe(Effect.provideService(Scope.Scope, mountScope));

      assert.deepStrictEqual(cleaned, []);

      // Remove one row → only its finalizer runs.
      yield* Signal.update(data, (d) => d.filter((r) => r.id !== 2));
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      assert.deepStrictEqual(cleaned, [2]);

      // Unmount the whole list → the survivors' finalizers run.
      yield* Scope.close(mountScope, Exit.void);
      assert.deepStrictEqual([...cleaned].sort((x, y) => x - y), [1, 2, 3]);
    }),
  );
});

// =============================================================================
// 4. In-flight event-handler fiber ownership (mount scope, not item scope)
// =============================================================================

describe("KeyedList per-row scope: in-flight event-handler ownership", () => {
  effect("does not interrupt an in-flight handler on row removal, but does on unmount", () =>
    Effect.gen(function* () {
      const mountScope = yield* Scope.make();
      const data = yield* Signal.make<readonly Row[]>([
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ]);
      const started = yield* Deferred.make<void>();
      let interrupted = false;

      const { container } = yield* render(
        <div>
          {Signal.each(
            data,
            (row: Row) => (
              <button
                data-id={row.id}
                onClick={() =>
                  Effect.gen(function* () {
                    yield* Deferred.succeed(started, undefined);
                    return yield* Effect.never;
                  }).pipe(
                    Effect.onInterrupt(() =>
                      Effect.sync(() => {
                        interrupted = true;
                      }),
                    ),
                  )
                }
              >
                {row.label}
              </button>
            ),
            { key: (row) => row.id },
          )}
        </div>,
      ).pipe(Effect.provideService(Scope.Scope, mountScope));

      // Click row 2's button → the handler forks and parks on `Effect.never`.
      const btn = container.querySelector(`[data-id="2"]`) as HTMLButtonElement;
      yield* click(btn);
      yield* Deferred.await(started);
      assert.strictEqual(interrupted, false);

      // Remove row 2: its DOM is gone, but the in-flight handler fiber is owned
      // by the mount scope, so removing the row does NOT interrupt it.
      yield* Signal.update(data, (d) => d.filter((r) => r.id !== 2));
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      assert.isNull(container.querySelector(`[data-id="2"]`));
      assert.strictEqual(interrupted, false);

      // Unmount the whole list → the mount-scope finalizer interrupts the fiber.
      yield* Scope.close(mountScope, Exit.void);
      yield* Effect.yieldNow;
      assert.strictEqual(interrupted, true);
    }),
  );
});
