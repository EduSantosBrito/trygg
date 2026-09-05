import { assert, describe } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import { scoped } from "../../testing/effect-vitest.js";
import { unsafeEraseR, unsafeWidenContext } from "../../internal/unsafe.js";
import * as SafeUrl from "../../security/safe-url.js";
import { Element } from "../element.js";
import { KeyedListDuplicateKeyError, renderKeyedList } from "../render-keyed-list.js";
import type { RenderContext, RenderResult } from "../renderer.js";
import * as Signal from "../signal.js";

class KeyedRowFailure extends Schema.TaggedError<KeyedRowFailure>()("KeyedRowFailure", {
  row: Schema.String,
}) {}

class OldRowCleanupFailure extends Schema.TaggedError<OldRowCleanupFailure>()(
  "OldRowCleanupFailure",
  { row: Schema.String },
) {}

type RowMode = "ok" | "typed" | "defect" | "interrupt" | "mixed-defect" | "mixed-interrupt";

interface Row {
  readonly id: string;
  readonly label: string;
  readonly mode?: RowMode;
  readonly finalize?: boolean;
  readonly value?: Signal.Signal<string>;
}

interface HarnessOptions {
  readonly canReconcile?: boolean;
  readonly cleanup?: (content: string, node: Text) => Effect.Effect<void, unknown>;
  readonly reconcile?: (currentContent: string, nextContent: string) => boolean;
}

const count = (values: ReadonlyArray<string>, value: string): number =>
  values.filter((candidate) => candidate === value).length;

const renderText = (content: string, parent: Node, options: HarnessOptions): RenderResult => {
  const node = document.createTextNode(content);
  parent.appendChild(node);
  let currentContent = content;
  return {
    node,
    ...(options.canReconcile === undefined
      ? {}
      : {
          canReconcile: () => options.canReconcile === true,
        }),
    cleanup: options.cleanup?.(content, node) ?? Effect.sync(() => node.remove()),
    reconcile: (nextElement) =>
      Effect.sync(() => {
        if (!Element.$is("Text")(nextElement)) return false;
        if (
          options.reconcile !== undefined &&
          !options.reconcile(currentContent, nextElement.content)
        ) {
          return false;
        }
        currentContent = nextElement.content;
        node.textContent = currentContent;
        return true;
      }),
  };
};

const makeHarness = Effect.fnUntraced(function* (
  initial: ReadonlyArray<Row>,
  options: HarnessOptions = {},
) {
  const source = yield* Signal.make(initial);
  const parent = document.createElement("div");
  const scope = yield* Effect.scope;
  const services = unsafeWidenContext(yield* Effect.context<never>());
  const context: RenderContext = {
    services,
    scope,
    safeUrlConfig: SafeUrl.defaultConfig,
  };
  const errors: Array<Cause.Cause<unknown>> = [];
  const workerExits: Array<Exit.Exit<void, unknown>> = [];
  const finalized: Array<string> = [];
  const workers: Array<Fiber.Fiber<void, unknown>> = [];
  let renderCalls = 0;
  let runUpdatesAsync = false;

  const result = yield* renderKeyedList<Row, KeyedRowFailure, Scope.Scope>(
    source,
    (row, index) =>
      Effect.gen(function* () {
        renderCalls += 1;
        if (row.finalize === true) {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              finalized.push(row.label);
            }),
          );
        }
        const mode = row.mode ?? "ok";
        if (mode === "typed") {
          return yield* new KeyedRowFailure({ row: row.id });
        }
        if (mode === "defect") {
          // oxlint-disable-next-line effect/no-effect-escape-hatch -- This branch deliberately supplies the Die case in the Cause matrix.
          return yield* Effect.die(`keyed-row-defect:${row.id}`);
        }
        if (mode === "interrupt") return yield* Effect.interrupt;
        if (mode === "mixed-defect") {
          return yield* Effect.failCause(
            Cause.combine(
              Cause.fail(new KeyedRowFailure({ row: row.id })),
              Cause.die(`keyed-row-defect:${row.id}`),
            ),
          );
        }
        if (mode === "mixed-interrupt") {
          return yield* Effect.failCause(
            Cause.combine(Cause.fail(new KeyedRowFailure({ row: row.id })), Cause.interrupt(52)),
          );
        }
        const label = row.value === undefined ? row.label : yield* Signal.get(row.value);
        return Element.Text({ content: `${index}:${label}` });
      }),
    (row) => row.id,
    parent,
    context,
    null,
    {
      errorHandler: (cause) => {
        errors.push(cause);
      },
    },
    {
      captureRowServices: () => Context.empty(),
      renderElement: (element, target) => {
        if (Element.$is("Text")(element)) {
          return Effect.succeed(renderText(element.content, target, options));
        }
        // oxlint-disable-next-line effect/no-effect-escape-hatch -- Fail-loud test adapter for an impossible renderer input.
        return Effect.die("Expected a Text element");
      },
      renderElementSync: () => null,
      runForkInRenderContext: (effect, currentContext) => {
        const owned = unsafeEraseR(effect.pipe(Scope.provide(currentContext.scope)));
        if (runUpdatesAsync) {
          const worker = Effect.runForkWith(currentContext.services)(owned);
          workers.push(worker);
          worker.addObserver((exit) => workerExits.push(exit));
          worker.currentDispatcher.flush();
          return;
        }
        workerExits.push(Effect.runSyncExitWith(currentContext.services)(owned));
      },
    },
  );

  return {
    source,
    parent,
    result,
    errors,
    workerExits,
    finalized,
    workers,
    useAsyncUpdates: () => {
      runUpdatesAsync = true;
    },
    renderCalls: () => renderCalls,
  };
});

describe("keyed-list RFC regressions", () => {
  scoped(
    "should build a replacement without rerunning the row when a prepared reconcile declines",
    () =>
      Effect.gen(function* () {
        // Scope: the renderer's preflight accepts but its later reconciliation declines.
        // Assertion: the keyed coordinator builds once from the prepared Element, replaces DOM, and releases old content once.
        const cleaned: Array<string> = [];
        const harness = yield* makeHarness([{ id: "a", label: "old" }], {
          canReconcile: true,
          reconcile: () => false,
          cleanup: (content, node) =>
            Effect.sync(() => {
              cleaned.push(content);
              node.remove();
            }),
        });
        const previous = harness.parent.textContent;
        yield* Signal.set(harness.source, [{ id: "a", label: "new" }]);
        assert.strictEqual(previous, "0:old");
        assert.strictEqual(harness.parent.textContent, "0:new");
        assert.strictEqual(harness.renderCalls(), 2);
        assert.deepStrictEqual(cleaned, ["0:old"]);
        yield* harness.result.cleanup;
        assert.deepStrictEqual(cleaned, ["0:old", "0:new"]);
      }),
  );

  scoped("should retain a committed remove, add, and move when old cleanup terminates", () =>
    Effect.gen(function* () {
      // Scope: drives post-commit old-row cleanup through Fail, Die, and self-interruption.
      // Assertion: the new keyed snapshot stays mounted/owned and cleanup never masquerades as rollback.
      const runCase = Effect.fnUntraced(function* (mode: "fail" | "die" | "interrupt") {
        const harness = yield* makeHarness(
          [
            { id: "a", label: "A", finalize: true },
            { id: "b", label: "B", finalize: true },
            { id: "c", label: "C", finalize: true },
          ],
          {
            cleanup: (content, node) => {
              const remove = Effect.sync(() => node.remove());
              if (content !== "0:A") return remove;
              if (mode === "fail") {
                return remove.pipe(
                  Effect.andThen(Effect.fail(new OldRowCleanupFailure({ row: "a" }))),
                );
              }
              if (mode === "die") {
                // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately verifies post-commit cleanup defects.
                return remove.pipe(Effect.andThen(Effect.die("old-row-cleanup-defect")));
              }
              return remove.pipe(Effect.andThen(Effect.interrupt));
            },
          },
        );
        harness.workerExits.length = 0;

        yield* Signal.set(harness.source, [
          { id: "c", label: "C2", finalize: true },
          { id: "d", label: "D", finalize: true },
        ]);

        assert.strictEqual(harness.parent.textContent, "0:C21:D");
        assert.strictEqual(harness.errors.length, 0);
        assert.strictEqual(count(harness.finalized, "A"), 1);
        assert.strictEqual(count(harness.finalized, "B"), 1);
        const updateExit = harness.workerExits.at(-1);
        assert.isDefined(updateExit);

        yield* harness.result.cleanup;
        assert.strictEqual(count(harness.finalized, "C"), 1);
        assert.strictEqual(count(harness.finalized, "C2"), 1);
        assert.strictEqual(count(harness.finalized, "D"), 1);
        return updateExit;
      });

      const failed = yield* runCase("fail");
      assert.isDefined(failed);
      if (failed !== undefined) assert.isTrue(Exit.isFailure(failed));
      if (failed !== undefined && Exit.isFailure(failed)) {
        assert.instanceOf(Cause.squash(failed.cause), OldRowCleanupFailure);
      }

      const defected = yield* runCase("die");
      assert.isDefined(defected);
      if (defected !== undefined) {
        assert.isTrue(Exit.isFailure(defected));
        assert.isTrue(Exit.hasDies(defected));
      }

      const interrupted = yield* runCase("interrupt");
      assert.isDefined(interrupted);
      if (interrupted !== undefined) {
        assert.isTrue(Exit.isFailure(interrupted));
        assert.isTrue(Exit.hasInterrupts(interrupted));
      }
    }),
  );

  scoped("should finish whole-list old cleanup after external interruption", () =>
    Effect.gen(function* () {
      // Scope: interrupts a remove/add/move update while the first old owner cleanup is blocked.
      // Assertion: the published new range remains reachable and every old owner still finalizes.
      const cleanupStarted = yield* Deferred.make<void>();
      const cleanupGate = yield* Deferred.make<void>();
      const harness = yield* makeHarness(
        [
          { id: "a", label: "A", finalize: true },
          { id: "b", label: "B", finalize: true },
          { id: "c", label: "C", finalize: true },
        ],
        {
          cleanup: (content, node) =>
            content === "0:A"
              ? Deferred.succeed(cleanupStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(cleanupGate)),
                  Effect.andThen(Effect.sync(() => node.remove())),
                )
              : Effect.sync(() => node.remove()),
        },
      );
      harness.workerExits.length = 0;
      harness.useAsyncUpdates();

      yield* Signal.set(harness.source, [
        { id: "c", label: "C2", finalize: true },
        { id: "d", label: "D", finalize: true },
      ]);
      yield* Deferred.await(cleanupStarted);
      assert.include(harness.parent.textContent ?? "", "0:C21:D");

      const worker = harness.workers.at(-1);
      assert.isDefined(worker);
      if (worker === undefined) return;
      const interrupting = yield* Fiber.interrupt(worker).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.include(harness.parent.textContent ?? "", "0:C21:D");
      yield* Deferred.succeed(cleanupGate, undefined);
      const updateExit = yield* Fiber.await(worker);
      yield* Fiber.await(interrupting);

      assert.isTrue(Exit.hasInterrupts(updateExit));
      assert.strictEqual(harness.parent.textContent, "0:C21:D");
      assert.strictEqual(count(harness.finalized, "A"), 1);
      assert.strictEqual(count(harness.finalized, "B"), 1);
      yield* harness.result.cleanup;
      assert.strictEqual(count(harness.finalized, "C"), 1);
      assert.strictEqual(count(harness.finalized, "C2"), 1);
      assert.strictEqual(count(harness.finalized, "D"), 1);
    }),
  );

  scoped("should retain a granular replacement when old cleanup terminates", () =>
    Effect.gen(function* () {
      // Scope: forces one signal-driven row through replacement with Fail, Die, and self-interrupt cleanup.
      // Assertion: current state owns the new result and disposes it exactly once on list teardown.
      const runCase = Effect.fnUntraced(function* (mode: "fail" | "die" | "interrupt") {
        const value = yield* Signal.make("A");
        let newCleanups = 0;
        const harness = yield* makeHarness([{ id: "a", label: "unused", value }], {
          reconcile: () => false,
          cleanup: (content, node) => {
            const remove = Effect.sync(() => {
              if (content === "0:B") newCleanups += 1;
              node.remove();
            });
            if (content !== "0:A") return remove;
            if (mode === "fail") {
              return remove.pipe(
                Effect.andThen(Effect.fail(new OldRowCleanupFailure({ row: "a" }))),
              );
            }
            if (mode === "die") {
              // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately verifies granular post-commit cleanup defects.
              return remove.pipe(Effect.andThen(Effect.die("granular-cleanup-defect")));
            }
            return remove.pipe(Effect.andThen(Effect.interrupt));
          },
        });
        harness.workerExits.length = 0;

        yield* Signal.set(value, "B");

        assert.strictEqual(harness.parent.textContent, "0:B");
        assert.strictEqual(newCleanups, 0);
        assert.strictEqual(harness.errors.length, 0);
        const updateExit = harness.workerExits.at(-1);
        assert.isDefined(updateExit);
        yield* harness.result.cleanup;
        assert.strictEqual(newCleanups, 1);
        return updateExit;
      });

      const failed = yield* runCase("fail");
      assert.isDefined(failed);
      if (failed !== undefined) assert.isTrue(Exit.isFailure(failed));
      if (failed !== undefined && Exit.isFailure(failed)) {
        assert.instanceOf(Cause.squash(failed.cause), OldRowCleanupFailure);
      }

      const defected = yield* runCase("die");
      assert.isDefined(defected);
      if (defected !== undefined) {
        assert.isTrue(Exit.isFailure(defected));
        assert.isTrue(Exit.hasDies(defected));
      }

      const interrupted = yield* runCase("interrupt");
      assert.isDefined(interrupted);
      if (interrupted !== undefined) {
        assert.isTrue(Exit.isFailure(interrupted));
        assert.isTrue(Exit.hasInterrupts(interrupted));
      }
    }),
  );

  scoped("should retain a granular replacement through externally interrupted old cleanup", () =>
    Effect.gen(function* () {
      // Scope: externally interrupts a signal-driven replacement while old cleanup is blocked.
      // Assertion: cleanup finishes, the new row survives, and its owner releases exactly once later.
      const value = yield* Signal.make("A");
      const cleanupStarted = yield* Deferred.make<void>();
      const cleanupGate = yield* Deferred.make<void>();
      let newCleanups = 0;
      const harness = yield* makeHarness([{ id: "a", label: "unused", value }], {
        reconcile: () => false,
        cleanup: (content, node) => {
          if (content === "0:A") {
            return Deferred.succeed(cleanupStarted, undefined).pipe(
              Effect.andThen(Deferred.await(cleanupGate)),
              Effect.andThen(Effect.sync(() => node.remove())),
            );
          }
          return Effect.sync(() => {
            newCleanups += 1;
            node.remove();
          });
        },
      });
      harness.workerExits.length = 0;
      harness.useAsyncUpdates();

      yield* Signal.set(value, "B");
      yield* Deferred.await(cleanupStarted);
      assert.include(harness.parent.textContent ?? "", "0:B");

      const worker = harness.workers.at(-1);
      assert.isDefined(worker);
      if (worker === undefined) return;
      const interrupting = yield* Fiber.interrupt(worker).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(cleanupGate, undefined);
      const updateExit = yield* Fiber.await(worker);
      yield* Fiber.await(interrupting);

      assert.isTrue(Exit.hasInterrupts(updateExit));
      assert.strictEqual(harness.parent.textContent, "0:B");
      assert.strictEqual(newCleanups, 0);
      yield* harness.result.cleanup;
      assert.strictEqual(newCleanups, 1);
    }),
  );

  scoped("should preserve the committed list when a replacement row fails", () =>
    Effect.gen(function* () {
      // Scope: replaces every committed row with one failing staged acquisition.
      // Assertion: old DOM stays intact, staging closes once, and a later retry commits.
      const harness = yield* makeHarness([
        { id: "a", label: "A", finalize: true },
        { id: "b", label: "B", finalize: true },
      ]);
      const oldNodes = Array.from(harness.parent.childNodes);

      yield* Signal.set(harness.source, [
        { id: "bad", label: "BAD", mode: "typed", finalize: true },
      ]);

      assert.strictEqual(harness.parent.textContent, "0:A1:B");
      assert.deepStrictEqual(Array.from(harness.parent.childNodes), oldNodes);
      assert.strictEqual(harness.errors.length, 1);
      assert.strictEqual(count(harness.finalized, "BAD"), 1);
      assert.strictEqual(count(harness.finalized, "A"), 0);
      assert.strictEqual(count(harness.finalized, "B"), 0);

      yield* Signal.set(harness.source, [{ id: "c", label: "C", finalize: true }]);

      assert.strictEqual(harness.parent.textContent, "0:C");
      assert.strictEqual(harness.errors.length, 1);
      assert.strictEqual(count(harness.finalized, "A"), 1);
      assert.strictEqual(count(harness.finalized, "B"), 1);

      yield* harness.result.cleanup;
      assert.strictEqual(count(harness.finalized, "C"), 1);
    }),
  );

  scoped("should preserve the committed list when an appended row fails", () =>
    Effect.gen(function* () {
      // Scope: stages an append after one already-owned row.
      // Assertion: failed staging neither moves nor finalizes the committed row.
      const existing: Row = { id: "a", label: "A", finalize: true };
      const harness = yield* makeHarness([existing]);
      const existingNode = Array.from(harness.parent.childNodes);

      yield* Signal.set(harness.source, [
        existing,
        { id: "bad", label: "BAD", mode: "typed", finalize: true },
      ]);

      assert.strictEqual(harness.parent.textContent, "0:A");
      assert.deepStrictEqual(Array.from(harness.parent.childNodes), existingNode);
      assert.strictEqual(harness.errors.length, 1);
      assert.strictEqual(count(harness.finalized, "BAD"), 1);
      assert.strictEqual(count(harness.finalized, "A"), 0);

      yield* harness.result.cleanup;
      assert.strictEqual(count(harness.finalized, "A"), 1);
    }),
  );

  scoped("should rollback remove, add, move, and changed-row staging as one snapshot", () =>
    Effect.gen(function* () {
      // Scope: stages a new row before a moved existing row fails while another old row is removed.
      // Assertion: old DOM/state remain byte-for-byte intact and every staged scope closes once.
      const initial: ReadonlyArray<Row> = [
        { id: "a", label: "A", finalize: true },
        { id: "b", label: "B", finalize: true },
        { id: "c", label: "C", finalize: true },
      ];
      const harness = yield* makeHarness(initial);
      const oldNodes = Array.from(harness.parent.childNodes);

      yield* Signal.set(harness.source, [
        { id: "d", label: "D-staged", finalize: true },
        { id: "c", label: "C-failed", mode: "typed", finalize: true },
        { id: "b", label: "B-next", finalize: true },
      ]);

      assert.strictEqual(harness.parent.textContent, "0:A1:B2:C");
      assert.deepStrictEqual(Array.from(harness.parent.childNodes), oldNodes);
      assert.strictEqual(harness.errors.length, 1);
      assert.strictEqual(count(harness.finalized, "D-staged"), 1);
      assert.strictEqual(count(harness.finalized, "C-failed"), 1);
      assert.strictEqual(count(harness.finalized, "A"), 0);
      assert.strictEqual(count(harness.finalized, "B"), 0);
      assert.strictEqual(count(harness.finalized, "C"), 0);

      yield* Signal.set(harness.source, initial);
      assert.strictEqual(harness.parent.textContent, "0:A1:B2:C");
      assert.deepStrictEqual(Array.from(harness.parent.childNodes), oldNodes);

      yield* harness.result.cleanup;
      assert.strictEqual(count(harness.finalized, "A"), 1);
      assert.strictEqual(count(harness.finalized, "B"), 1);
      assert.strictEqual(count(harness.finalized, "C"), 1);
    }),
  );

  scoped("should preserve a row on failed rerender and recover on the next snapshot", () =>
    Effect.gen(function* () {
      // Scope: fails the render-function rerun for an existing key after structural commit.
      // Assertion: old DOM identity remains and the same row can reconcile a later value.
      const harness = yield* makeHarness([{ id: "a", label: "A" }]);
      const oldTextNode = Array.from(harness.parent.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE,
      );
      assert.isDefined(oldTextNode);

      yield* Signal.set(harness.source, [{ id: "a", label: "B", mode: "typed" }]);

      assert.strictEqual(harness.parent.textContent, "0:A");
      assert.strictEqual(harness.errors.length, 1);
      assert.strictEqual(
        Array.from(harness.parent.childNodes).find((node) => node.nodeType === Node.TEXT_NODE),
        oldTextNode,
      );

      yield* Signal.set(harness.source, [{ id: "a", label: "C" }]);

      assert.strictEqual(harness.parent.textContent, "0:C");
      assert.strictEqual(harness.errors.length, 1);
      assert.strictEqual(
        Array.from(harness.parent.childNodes).find((node) => node.nodeType === Node.TEXT_NODE),
        oldTextNode,
      );

      yield* harness.result.cleanup;
    }),
  );

  scoped("should refresh item and index while preserving keyed DOM identity on reorder", () =>
    Effect.gen(function* () {
      // Scope: combines a key reorder, new item objects, and index-dependent output.
      // Assertion: content and indices refresh while each key retains its text node.
      const harness = yield* makeHarness([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ]);
      const initialTextNodes = Array.from(harness.parent.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE,
      );
      const [aNode, bNode] = initialTextNodes;
      assert.isDefined(aNode);
      assert.isDefined(bNode);

      const replacement: ReadonlyArray<Row> = [
        { id: "b", label: "B2" },
        { id: "a", label: "A2" },
      ];
      yield* Signal.set(harness.source, replacement);

      const reorderedTextNodes = Array.from(harness.parent.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE,
      );
      assert.strictEqual(harness.parent.textContent, "0:B21:A2");
      assert.deepStrictEqual(reorderedTextNodes, [bNode, aNode]);

      // Reusing the same item objects still changes their index-dependent output.
      yield* Signal.set(harness.source, [...replacement].reverse());
      assert.strictEqual(harness.parent.textContent, "0:A21:B2");
      assert.deepStrictEqual(
        Array.from(harness.parent.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE),
        [aNode, bNode],
      );

      yield* harness.result.cleanup;
    }),
  );

  scoped("should reject duplicate keys before initial or update commit", () =>
    Effect.gen(function* () {
      // Scope: presents duplicate keys both before the first row and after a valid snapshot.
      // Assertion: no duplicate renders, the valid DOM survives, and its scope finalizes once.
      const harness = yield* makeHarness([
        { id: "duplicate", label: "first" },
        { id: "duplicate", label: "second" },
      ]);

      assert.strictEqual(harness.parent.textContent, "");
      assert.strictEqual(harness.renderCalls(), 0);
      assert.strictEqual(harness.errors.length, 1);
      const [initialCause] = harness.errors;
      assert.isDefined(initialCause);
      if (initialCause !== undefined) {
        assert.instanceOf(Cause.squash(initialCause), KeyedListDuplicateKeyError);
      }

      yield* Signal.set(harness.source, [{ id: "a", label: "A", finalize: true }]);
      const validNodes = Array.from(harness.parent.childNodes);
      assert.strictEqual(harness.parent.textContent, "0:A");
      assert.strictEqual(harness.renderCalls(), 1);

      yield* Signal.set(harness.source, [
        { id: "a", label: "A2" },
        { id: "a", label: "A3" },
      ]);

      assert.strictEqual(harness.parent.textContent, "0:A");
      assert.deepStrictEqual(Array.from(harness.parent.childNodes), validNodes);
      assert.strictEqual(harness.renderCalls(), 1);
      assert.strictEqual(harness.errors.length, 2);

      yield* harness.result.cleanup;
      assert.strictEqual(count(harness.finalized, "A"), 1);
    }),
  );

  scoped("should preserve keyed row failure, defect, and interruption classifications", () =>
    Effect.gen(function* () {
      // Scope: drives the same existing-row rerender through each Cause category.
      // Assertion: only typed failure reaches recovery; defect and interruption stay terminal.
      const runCase = Effect.fnUntraced(function* (mode: Exclude<RowMode, "ok">) {
        const harness = yield* makeHarness([{ id: "a", label: "A" }]);
        harness.workerExits.length = 0;

        yield* Signal.set(harness.source, [{ id: "a", label: "B", mode }]);

        assert.strictEqual(harness.parent.textContent, "0:A");
        const failedExits = harness.workerExits.filter(Exit.isFailure);
        const reported = [...harness.errors];
        yield* harness.result.cleanup;
        return { failedExits, reported };
      });

      const typed = yield* runCase("typed");
      const defect = yield* runCase("defect");
      const interruption = yield* runCase("interrupt");
      const mixedDefect = yield* runCase("mixed-defect");
      const mixedInterruption = yield* runCase("mixed-interrupt");

      assert.strictEqual(typed.failedExits.length, 0);
      assert.strictEqual(typed.reported.length, 1);
      const [typedCause] = typed.reported;
      assert.isDefined(typedCause);
      if (typedCause !== undefined) {
        assert.isTrue(Cause.hasFails(typedCause));
        assert.isFalse(Cause.hasDies(typedCause));
        assert.isFalse(Cause.hasInterrupts(typedCause));
        assert.instanceOf(Cause.squash(typedCause), KeyedRowFailure);
      }

      assert.strictEqual(defect.reported.length, 0);
      assert.strictEqual(defect.failedExits.length, 1);
      const [defectExit] = defect.failedExits;
      assert.isDefined(defectExit);
      if (defectExit !== undefined) assert.isTrue(Exit.hasDies(defectExit));

      assert.strictEqual(interruption.reported.length, 0);
      assert.strictEqual(interruption.failedExits.length, 1);
      const [interruptExit] = interruption.failedExits;
      assert.isDefined(interruptExit);
      if (interruptExit !== undefined) assert.isTrue(Exit.hasInterrupts(interruptExit));

      assert.strictEqual(mixedDefect.reported.length, 0);
      assert.strictEqual(mixedDefect.failedExits.length, 1);
      const [mixedDefectExit] = mixedDefect.failedExits;
      assert.isDefined(mixedDefectExit);
      if (mixedDefectExit !== undefined && Exit.isFailure(mixedDefectExit)) {
        assert.deepStrictEqual(
          mixedDefectExit.cause.reasons.map((reason) => reason._tag),
          ["Fail", "Die"],
        );
      }

      assert.strictEqual(mixedInterruption.reported.length, 0);
      assert.strictEqual(mixedInterruption.failedExits.length, 1);
      const [mixedInterruptExit] = mixedInterruption.failedExits;
      assert.isDefined(mixedInterruptExit);
      if (mixedInterruptExit !== undefined && Exit.isFailure(mixedInterruptExit)) {
        assert.deepStrictEqual(
          mixedInterruptExit.cause.reasons.map((reason) => reason._tag),
          ["Fail", "Interrupt"],
        );
      }
    }),
  );
});
