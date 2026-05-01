import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as ContractTrace from "../trace.js";

describe("ContractTrace", () => {
  it.effect("emit is a no-op without a collector", () =>
    Effect.gen(function* () {
      yield* ContractTrace.emit({ event: "debug.note", payload: { message: "ignored" } });
      assert.isTrue(true);
    }),
  );

  it.effect("collector records ordered events", () =>
    Effect.gen(function* () {
      const collector = yield* ContractTrace.createInMemoryCollector("run-1");

      yield* ContractTrace.withCollector(
        Effect.gen(function* () {
          yield* ContractTrace.emit({ event: "router.navigate.request" });
          yield* ContractTrace.emit({ event: "router.navigate.commit" });
        }),
        collector,
      );

      const records = yield* collector.snapshot;
      assert.strictEqual(records.length, 2);
      assert.strictEqual(records[0]?.seq, 1);
      assert.strictEqual(records[1]?.seq, 2);
      assert.strictEqual(records[0]?.event.event, "router.navigate.request");
      assert.strictEqual(records[1]?.event.event, "router.navigate.commit");
    }),
  );

  it.effect("withAction propagates the current action id", () =>
    Effect.gen(function* () {
      const collector = yield* ContractTrace.createInMemoryCollector("run-2");

      yield* ContractTrace.withCollector(
        ContractTrace.withAction(
          "a1",
          { kind: "navigate", to: "/users" },
          ContractTrace.emit({ event: "router.current.set" }),
        ),
        collector,
      );

      const records = yield* collector.snapshot;
      assert.strictEqual(records[0]?.event.event, "contract.action.start");
      assert.strictEqual(records[1]?.actionId, "a1");
      assert.strictEqual(records[1]?.event.event, "router.current.set");
      assert.strictEqual(records[2]?.event.event, "contract.action.end");
    }),
  );
});
