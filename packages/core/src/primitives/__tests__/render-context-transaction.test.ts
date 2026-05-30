import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Option, Scope } from "effect";
import {
  makeRenderContextTransaction,
  type RenderContextForkRequest,
  type RenderContextSnapshot,
} from "../render-context-transaction.js";
import * as SafeUrl from "../../security/safe-url.js";
import * as Trace from "../../trace/index.js";
import { unsafeWidenContext } from "../../internal/unsafe.js";

class Message extends Context.Service<Message, { readonly value: string }>()("test/Message") {}

const traceEventsFor = Effect.fn("RenderContextTransactionTest.traceEventsFor")(function* <E, R>(
  effect: Effect.Effect<void, E, R>,
) {
  const recorder = Trace.makeRecorder();
  yield* Trace.record(effect, recorder);
  return recorder.records();
});

const eventNames = (
  records: ReadonlyArray<Trace.TraceRecord>,
): ReadonlyArray<Trace.TraceEventName> => records.map((record) => record.name);

const makeSnapshot: Effect.Effect<RenderContextSnapshot> = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const services = unsafeWidenContext(Context.make(Message, { value: "root" }));
  return { services, scope, safeUrlConfig: SafeUrl.defaultConfig };
});

const SCOPE_OWNERS: ReadonlyArray<RenderContextForkRequest["scopeOwner"]> = [
  "provider",
  "signal",
  "portal",
  "boundary",
];

describe("RenderContextTransaction", () => {
  it.effect("runs event handlers with the captured service context and scope", () =>
    Effect.gen(function* () {
      const transaction = makeRenderContextTransaction();
      const snapshot = yield* makeSnapshot;

      const value = yield* transaction.runEventHandler(
        snapshot,
        Effect.gen(function* () {
          const message = yield* Message;
          yield* Effect.addFinalizer(() => Effect.void);
          return message.value;
        }),
      );

      assert.strictEqual(value, "root");
    }),
  );

  it.effect("emits scoped fork and scope close lifecycle traces", () =>
    Effect.gen(function* () {
      const transaction = makeRenderContextTransaction();
      const parent = yield* makeSnapshot;

      const records = yield* traceEventsFor(
        Effect.gen(function* () {
          const child = yield* transaction.forkContext({
            parent,
            additionalServices: Option.none(),
            scopeOwner: "component",
          });
          yield* transaction.finalizeOwnedScope(child);
        }),
      );

      assert.deepStrictEqual(eventNames(records), ["effect.fork.scoped", "effect.scope.close"]);
      assert.deepStrictEqual(records[0]?.payload, { owner: "component" });
    }),
  );

  it.effect("finalizes provider, signal, portal, and boundary owned scopes", () =>
    Effect.gen(function* () {
      const transaction = makeRenderContextTransaction();
      const parent = yield* makeSnapshot;
      const finalized: Array<string> = [];

      for (const scopeOwner of SCOPE_OWNERS) {
        const child = yield* transaction.forkContext({
          parent,
          additionalServices: Option.none(),
          scopeOwner,
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => finalized.push(scopeOwner))).pipe(
          Scope.provide(child.scope),
        );
        yield* transaction.finalizeOwnedScope(child);
      }

      assert.deepStrictEqual(finalized, ["provider", "signal", "portal", "boundary"]);
    }),
  );

  it.effect("forks and finalizes owned render scopes with additional services", () =>
    Effect.gen(function* () {
      const transaction = makeRenderContextTransaction();
      const parent = yield* makeSnapshot;
      const additional = unsafeWidenContext(Context.make(Message, { value: "child" }));

      const child = yield* transaction.forkContext({
        parent,
        additionalServices: Option.some(additional),
        scopeOwner: "component",
      });
      const value = yield* transaction.runEventHandler(
        child,
        Effect.gen(function* () {
          const message = yield* Message;
          return message.value;
        }),
      );

      assert.strictEqual(value, "child");
      yield* transaction.finalizeOwnedScope(child);
    }),
  );
});
