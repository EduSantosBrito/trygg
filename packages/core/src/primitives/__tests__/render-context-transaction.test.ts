import { describe, expect, it } from "vitest";
import { Context, Effect, Option, Scope } from "effect";
import {
  makeRenderContextTransaction,
  type RenderContextSnapshot,
} from "../render-context-transaction.js";
import * as SafeUrl from "../../security/safe-url.js";
import * as ContractTrace from "../../contract/trace.js";
import { unsafeWidenContext } from "../../internal/unsafe.js";

class Message extends Context.Service<Message, { readonly value: string }>()("test/Message") {}

const traceEventsFor = <E, R>(
  effect: Effect.Effect<void, E, R>,
): Effect.Effect<ReadonlyArray<ContractTrace.ContractTraceRecord>, E, R> =>
  Effect.gen(function* () {
    const collector = yield* ContractTrace.createInMemoryCollector("render-context-transaction");
    yield* ContractTrace.withCollector(effect, collector);
    return yield* collector.snapshot;
  });

const eventNames = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
): ReadonlyArray<ContractTrace.ContractTraceEventName> => records.map((record) => record.event.event);

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

  it("emits scoped fork and scope close lifecycle traces", async () => {
    const transaction = makeRenderContextTransaction({ emitLifecycleTraceEvents: true });
    const parent = await makeSnapshot();

    const records = await Effect.runPromise(
      traceEventsFor(
        Effect.gen(function* () {
          const child = yield* transaction.forkContext({
            parent,
            additionalServices: Option.none(),
            scopeOwner: "component",
          });
          yield* transaction.finalizeOwnedScope(child);
        }),
      ),
    );

    expect(eventNames(records)).toEqual(["effect.fork.scoped", "effect.scope.close"]);
    expect(records[0]?.event.payload).toMatchObject({ owner: "component" });
  });

  it("finalizes provider, signal, portal, and boundary owned scopes", async () => {
    const transaction = makeRenderContextTransaction({ emitLifecycleTraceEvents: true });
    const parent = await makeSnapshot();
    const finalized: Array<string> = [];

    for (const scopeOwner of ["provider", "signal", "portal", "boundary"] as const) {
      const child = await Effect.runPromise(
        transaction.forkContext({
          parent,
          additionalServices: Option.none(),
          scopeOwner,
        }),
      );
      await Effect.runPromise(
        Effect.addFinalizer(() => Effect.sync(() => finalized.push(scopeOwner))).pipe(
          Scope.provide(child.scope),
        ),
      );
      await Effect.runPromise(transaction.finalizeOwnedScope(child));
    }

    expect(finalized).toEqual(["provider", "signal", "portal", "boundary"]);
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
