import { describe, expect, it } from "vitest";
import { Context, Effect, Option, Scope } from "effect";
import { makeRenderTransaction } from "../render-transaction.js";
import * as SafeUrl from "../../security/safe-url.js";
import type { RenderContext, RenderResult } from "../renderer.js";

const context: RenderContext = {
  services: Context.empty() as Context.Context<unknown>,
  scope: {} as Scope.Scope,
  safeUrlConfig: SafeUrl.defaultConfig,
};

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

  it("preserves previous UI when render fails before commit", async () => {
    const parent = document.createElement("div");
    const previousNode = document.createElement("span");
    previousNode.textContent = "old";
    parent.appendChild(previousNode);
    const transaction = makeRenderTransaction({ emitTraceEvents: false });

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
