import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Option, Predicate, Scope } from "effect";
import * as Trace from "../../trace/index.js";
import { unsafeWidenContext } from "../../internal/unsafe.js";
import { makeRenderTransaction } from "../render-transaction.js";
import * as SafeUrl from "../../security/safe-url.js";
import { Element } from "../element.js";
import type { RenderContext, RenderResult } from "../renderer.js";

const makeContext: Effect.Effect<RenderContext> = Effect.gen(function* () {
  const scope = yield* Scope.make();
  return {
    services: unsafeWidenContext(Context.empty()),
    scope,
    safeUrlConfig: SafeUrl.defaultConfig,
  };
});

const traceEventsFor = Effect.fn("RenderTransactionTest.traceEventsFor")(function* <E, R>(
  effect: Effect.Effect<void, E, R>,
) {
  const recorder = Trace.makeRecorder();
  yield* Trace.record(effect, recorder);
  return recorder.records();
});

const eventNames = (
  records: ReadonlyArray<Trace.TraceRecord>,
): ReadonlyArray<Trace.TraceEventName> => records.map((record) => record.name);

const result = (node: Node, cleanupLog: Array<string>, label: string): RenderResult => ({
  node,
  cleanup: Effect.sync(() => {
    cleanupLog.push(label);
    node.parentNode?.removeChild(node);
  }),
});

describe("RenderTransaction", () => {
  it.effect("commits replacement before cleaning previous result", () =>
    Effect.gen(function* () {
      const parent = document.createElement("div");
      const previousNode = document.createElement("span");
      previousNode.textContent = "old";
      parent.appendChild(previousNode);
      const cleanupSnapshots: Array<string> = [];
      const transaction = makeRenderTransaction();
      const previous = result(previousNode, cleanupSnapshots, "old");
      const context = yield* makeContext;

      const outcome = yield* transaction
        .replace({
          parent,
          previous: Option.some(previous),
          renderNext: Effect.sync(() => {
            const nextNode = document.createElement("strong");
            nextNode.textContent = "new";
            return result(nextNode, [], "new");
          }),
          context,
        })
        .pipe(Effect.scoped);

      assert.isTrue(Predicate.isTagged(outcome, "Committed"));
      assert.strictEqual(parent.textContent, "new");
      assert.deepStrictEqual(cleanupSnapshots, ["old"]);
    }),
  );

  it.effect("represents reconcile success and skipped fallback explicitly", () =>
    Effect.gen(function* () {
      const node = document.createElement("div");
      const transaction = makeRenderTransaction();
      const context = yield* makeContext;
      const previous = {
        ...result(node, [], "previous"),
        reconcile: () => Effect.succeed(true),
      } satisfies RenderResult;

      const reconciled = yield* transaction.reconcile({
        previous,
        nextElement: Element.Text({ content: "next" }),
        nextContext: null,
        context,
      });
      const skipped = yield* transaction.reconcile({
        previous: result(node, [], "previous"),
        nextElement: Element.Text({ content: "next" }),
        nextContext: null,
        context,
      });

      assert.isTrue(Predicate.isTagged(reconciled, "Reconciled"));
      assert.isTrue(Predicate.isTagged(skipped, "NotReconciled"));
    }),
  );

  it.effect("emits no-blank replacement and cleanup traces", () =>
    Effect.gen(function* () {
      const parent = document.createElement("div");
      const previousNode = document.createElement("span");
      previousNode.textContent = "old";
      parent.appendChild(previousNode);
      const transaction = makeRenderTransaction();
      const context = yield* makeContext;

      const records = yield* traceEventsFor(
        transaction
          .replace({
            parent,
            previous: Option.some(result(previousNode, [], "old")),
            renderNext: Effect.sync(() => {
              const nextNode = document.createElement("strong");
              nextNode.textContent = "new";
              return result(nextNode, [], "new");
            }),
            context,
          })
          .pipe(Effect.asVoid, Effect.scoped),
      );

      assert.deepStrictEqual(eventNames(records), [
        "signalElement.swap.start",
        "signalElement.swap.render",
        "signalElement.swap.commit",
        "signalElement.cleanup",
      ]);
      assert.strictEqual(parent.textContent, "new");
    }),
  );

  it.effect("emits failed-before-commit traces without blanking previous UI", () =>
    Effect.gen(function* () {
      const parent = document.createElement("div");
      const previousNode = document.createElement("span");
      previousNode.textContent = "old";
      parent.appendChild(previousNode);
      const transaction = makeRenderTransaction();
      const context = yield* makeContext;

      const records = yield* traceEventsFor(
        transaction
          .replace({
            parent,
            previous: Option.some(result(previousNode, [], "old")),
            renderNext: Effect.fail("boom"),
            context,
          })
          .pipe(Effect.asVoid, Effect.scoped),
      );

      assert.deepStrictEqual(eventNames(records), [
        "signalElement.swap.start",
        "signalElement.swap.failBeforeCommit",
      ]);
      assert.strictEqual(parent.textContent, "old");
    }),
  );

  it.effect("preserves previous UI when render fails before commit", () =>
    Effect.gen(function* () {
      const parent = document.createElement("div");
      const previousNode = document.createElement("span");
      previousNode.textContent = "old";
      parent.appendChild(previousNode);
      const transaction = makeRenderTransaction();
      const context = yield* makeContext;

      const outcome = yield* transaction
        .replace({
          parent,
          previous: Option.some(result(previousNode, [], "old")),
          renderNext: Effect.fail("boom"),
          context,
        })
        .pipe(Effect.scoped);

      assert.isTrue(Predicate.isTagged(outcome, "FailedBeforeCommit"));
      if (Predicate.isTagged(outcome, "FailedBeforeCommit")) {
        assert.strictEqual(outcome.cause, "boom");
      }
      assert.strictEqual(parent.textContent, "old");
    }),
  );
});
