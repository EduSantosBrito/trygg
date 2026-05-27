import { describe, expect, it } from "vitest";
import { Context, Effect, Option, Scope } from "effect";
import * as ContractTrace from "../../contract/trace.js";
import { unsafeWidenContext } from "../../internal/unsafe.js";
import { makeRenderTransaction } from "../render-transaction.js";
import * as SafeUrl from "../../security/safe-url.js";
import { Element } from "../element.js";
import type { RenderContext, RenderResult } from "../renderer.js";

const makeContext = (): Effect.Effect<RenderContext> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    return {
      services: unsafeWidenContext(Context.empty()),
      scope,
      safeUrlConfig: SafeUrl.defaultConfig,
    };
  });

const traceEventsFor = <E, R>(
  effect: Effect.Effect<void, E, R>,
): Effect.Effect<ReadonlyArray<ContractTrace.ContractTraceRecord>, E, R> =>
  Effect.gen(function* () {
    const collector = yield* ContractTrace.createInMemoryCollector("render-transaction");
    yield* ContractTrace.withCollector(effect, collector);
    return yield* collector.snapshot;
  });

const eventNames = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
): ReadonlyArray<ContractTrace.ContractTraceEventName> => records.map((record) => record.event.event);

const result = (node: Node, cleanupLog: Array<string>, label: string): RenderResult => ({
  node,
  cleanup: Effect.sync(() => {
    cleanupLog.push(label);
    node.parentNode?.removeChild(node);
  }),
});

describe("RenderTransaction", () => {
  it("commits replacement before cleaning previous result", async () => {
    const parent = document.createElement("div");
    const previousNode = document.createElement("span");
    previousNode.textContent = "old";
    parent.appendChild(previousNode);
    const cleanupSnapshots: Array<string> = [];
    const transaction = makeRenderTransaction({ emitTraceEvents: false });
    const previous = result(previousNode, cleanupSnapshots, "old");
    const context = await Effect.runPromise(makeContext());

    const outcome = await Effect.runPromise(
      transaction.replace({
        parent,
        previous: Option.some(previous),
        renderNext: Effect.sync(() => {
          const nextNode = document.createElement("strong");
          nextNode.textContent = "new";
          return result(nextNode, [], "new");
        }),
        context,
      }).pipe(Effect.scoped),
    );

    expect(outcome._tag).toBe("Committed");
    expect(parent.textContent).toBe("new");
    expect(cleanupSnapshots).toEqual(["old"]);
  });

  it("represents reconcile success and skipped fallback explicitly", async () => {
    const node = document.createElement("div");
    const transaction = makeRenderTransaction({ emitTraceEvents: false });
    const context = await Effect.runPromise(makeContext());
    const previous = {
      ...result(node, [], "previous"),
      reconcile: () => Effect.succeed(true),
    } satisfies RenderResult;

    const reconciled = await Effect.runPromise(
      transaction.reconcile({
        previous,
        nextElement: Element.Text({ content: "next" }),
        nextContext: null,
        context,
      }),
    );
    const skipped = await Effect.runPromise(
      transaction.reconcile({
        previous: result(node, [], "previous"),
        nextElement: Element.Text({ content: "next" }),
        nextContext: null,
        context,
      }),
    );

    expect(reconciled._tag).toBe("Reconciled");
    expect(skipped._tag).toBe("NotReconciled");
  });

  it("emits no-blank replacement and cleanup traces", async () => {
    const parent = document.createElement("div");
    const previousNode = document.createElement("span");
    previousNode.textContent = "old";
    parent.appendChild(previousNode);
    const transaction = makeRenderTransaction({ emitTraceEvents: true });
    const context = await Effect.runPromise(makeContext());

    const records = await Effect.runPromise(
      traceEventsFor(
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
      ),
    );

    expect(eventNames(records)).toEqual([
      "signalElement.swap.start",
      "signalElement.swap.render",
      "signalElement.swap.commit",
      "signalElement.cleanup",
    ]);
    expect(parent.textContent).toBe("new");
  });

  it("emits failed-before-commit traces without blanking previous UI", async () => {
    const parent = document.createElement("div");
    const previousNode = document.createElement("span");
    previousNode.textContent = "old";
    parent.appendChild(previousNode);
    const transaction = makeRenderTransaction({ emitTraceEvents: true });
    const context = await Effect.runPromise(makeContext());

    const records = await Effect.runPromise(
      traceEventsFor(
        transaction
          .replace({
            parent,
            previous: Option.some(result(previousNode, [], "old")),
            renderNext: Effect.fail("boom"),
            context,
          })
          .pipe(Effect.asVoid, Effect.scoped),
      ),
    );

    expect(eventNames(records)).toEqual([
      "signalElement.swap.start",
      "signalElement.swap.failBeforeCommit",
    ]);
    expect(parent.textContent).toBe("old");
  });

  it("preserves previous UI when render fails before commit", async () => {
    const parent = document.createElement("div");
    const previousNode = document.createElement("span");
    previousNode.textContent = "old";
    parent.appendChild(previousNode);
    const transaction = makeRenderTransaction({ emitTraceEvents: false });
    const context = await Effect.runPromise(makeContext());

    const outcome = await Effect.runPromise(
      transaction.replace({
        parent,
        previous: Option.some(result(previousNode, [], "old")),
        renderNext: Effect.fail("boom"),
        context,
      }).pipe(Effect.scoped),
    );

    expect(outcome).toEqual({ _tag: "FailedBeforeCommit", cause: "boom" });
    expect(parent.textContent).toBe("old");
  });
});
