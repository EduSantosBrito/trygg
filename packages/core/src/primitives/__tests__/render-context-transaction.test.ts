import { describe, expect, it } from "vitest";
import { Context, Effect, Option, Scope } from "effect";
import {
  makeRenderContextTransaction,
  type RenderContextSnapshot,
} from "../render-context-transaction.js";
import * as SafeUrl from "../../security/safe-url.js";
import { unsafeWidenContext } from "../../internal/unsafe.js";

class Message extends Context.Service<Message, { readonly value: string }>()("test/Message") {}

const makeSnapshot = async (): Promise<RenderContextSnapshot> => {
  const scope = await Effect.runPromise(Scope.make());
  const services = unsafeWidenContext(Context.make(Message, { value: "root" }));
  return { services, scope, safeUrlConfig: SafeUrl.defaultConfig };
};

describe("RenderContextTransaction", () => {
  it("runs event handlers with the captured service context and scope", async () => {
    const transaction = makeRenderContextTransaction({ emitLifecycleTraceEvents: false });
    const snapshot = await makeSnapshot();

    const value = await Effect.runPromise(
      transaction.runEventHandler(
        snapshot,
        Effect.gen(function* () {
          const message = yield* Message;
          yield* Effect.addFinalizer(() => Effect.void);
          return message.value;
        }),
      ),
    );

    expect(value).toBe("root");
  });

  it("forks and finalizes owned render scopes with additional services", async () => {
    const transaction = makeRenderContextTransaction({ emitLifecycleTraceEvents: false });
    const parent = await makeSnapshot();
    const additional = unsafeWidenContext(Context.make(Message, { value: "child" }));

    const child = await Effect.runPromise(
      transaction.forkContext({
        parent,
        additionalServices: Option.some(additional),
        scopeOwner: "component",
      }),
    );
    const value = await Effect.runPromise(
      transaction.runEventHandler(
        child,
        Effect.gen(function* () {
          const message = yield* Message;
          return message.value;
        }),
      ),
    );

    expect(value).toBe("child");
    await Effect.runPromise(transaction.finalizeOwnedScope(child));
  });
});
