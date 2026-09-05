import { assert, describe } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Signal from "../signal.js";
import * as Trace from "../../trace/index.js";

interface Row {
  readonly id: number;
  readonly dependency: "left" | "right" | "none";
  readonly revision?: number;
}

describe("keyed row dependency changes", () => {
  scoped(
    "should preserve the latest dependency order when the same Signals are read in reverse",
    () =>
      Effect.gen(function* () {
        // Scope: unchanged membership can still change observable release order during row removal.
        // Assertion: the retained row updates and releases dependencies in the order of the latest successful render.
        const recorder = Trace.makeRecorder();
        const ids = yield* Trace.record(
          Effect.gen(function* () {
            const left = yield* Signal.make("left");
            const right = yield* Signal.make("right");
            const items = yield* Signal.make([{ id: 1, reversed: false }]);
            const closed = yield* Deferred.make<void>();
            const { container } = yield* render(
              <ul>
                {Signal.each(
                  items,
                  (item) =>
                    Effect.gen(function* () {
                      yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined));
                      const first = yield* Signal.get(item.reversed ? right : left);
                      const second = yield* Signal.get(item.reversed ? left : right);
                      return (
                        <li>
                          {first}:{second}
                        </li>
                      );
                    }),
                  { key: (item) => item.id },
                )}
              </ul>,
            );
            const row = container.querySelector("li");
            yield* Signal.set(items, [{ id: 1, reversed: true }]);
            assert.strictEqual(container.querySelector("li"), row);
            assert.strictEqual(row?.textContent, "right:left");
            yield* Signal.set(items, []);
            yield* Deferred.await(closed);
            assert.strictEqual(container.querySelector("li"), null);
            return [right._debugId, left._debugId];
          }),
          recorder,
        );
        const released = recorder.records().flatMap((record) => {
          const signalId = record.payload?.signal_id;
          return record.name === "signal.unsubscribe" &&
            typeof signalId === "string" &&
            ids.includes(signalId)
            ? [signalId]
            : [];
        });
        assert.deepStrictEqual(released, ids);
      }),
  );

  scoped(
    "should preserve stable dependencies and replace equally sized or empty dependency sets",
    () =>
      Effect.gen(function* () {
        // Scope: one retained row moves through unchanged, equally sized, empty, and restored dependency sets.
        // Assertion: the active Signal updates the same DOM; obsolete Signals have no row listener, including after removal.
        const left = yield* Signal.make("left");
        const right = yield* Signal.make("right");
        const items = yield* Signal.make<ReadonlyArray<Row>>([{ id: 1, dependency: "left" }]);
        let entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
        const { container } = yield* render(
          <ul>
            {Signal.each(
              items,
              (item) =>
                Effect.gen(function* () {
                  yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                  const value =
                    item.dependency === "none"
                      ? "none"
                      : yield* Signal.get(item.dependency === "left" ? left : right);
                  return <li>{value}</li>;
                }),
              { key: (item) => item.id },
            )}
          </ul>,
        );
        const row = container.querySelector("li");
        const change = Effect.fnUntraced(function* (operation: Effect.Effect<void>, text: string) {
          entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          yield* operation;
          const worker = yield* Deferred.await(entered);
          assert.isTrue(Exit.isSuccess(yield* Fiber.await(worker)));
          assert.strictEqual(container.querySelector("li"), row);
          assert.strictEqual(row?.textContent, text);
        });

        yield* change(Signal.set(left, "left-2"), "left-2");
        assert.strictEqual(left._listeners.size, 1);
        assert.strictEqual(right._listeners.size, 0);
        yield* change(Signal.set(items, [{ id: 1, dependency: "right" }]), "right");
        assert.strictEqual(left._listeners.size, 0);
        assert.strictEqual(right._listeners.size, 1);
        yield* Signal.set(left, "unused-left");
        yield* change(Signal.set(right, "right-2"), "right-2");
        yield* change(Signal.set(items, [{ id: 1, dependency: "right", revision: 1 }]), "right-2");
        assert.strictEqual(right._listeners.size, 1);
        yield* change(Signal.set(items, [{ id: 1, dependency: "none", revision: 1 }]), "none");
        assert.strictEqual(left._listeners.size, 0);
        assert.strictEqual(right._listeners.size, 0);
        yield* change(Signal.set(items, [{ id: 1, dependency: "none" }]), "none");
        yield* change(Signal.set(items, [{ id: 1, dependency: "left" }]), "unused-left");
        yield* change(Signal.set(left, "left-3"), "left-3");
        yield* Signal.set(items, []);
        assert.strictEqual(container.querySelector("li"), null);
        assert.strictEqual(left._listeners.size, 0);
        assert.strictEqual(right._listeners.size, 0);
      }),
  );
});
