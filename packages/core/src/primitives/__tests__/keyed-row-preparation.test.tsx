import { assert, describe, vi } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Signal from "../signal.js";

class RowPropertyFailure extends Schema.TaggedError<RowPropertyFailure>()(
  "RowPropertyFailure",
  {},
) {}

describe("keyed row reactive preparation", () => {
  scoped("should acquire properties once when a row Signal requires structural replacement", () =>
    Effect.gen(function* () {
      // Scope: Signal.get inside the row body uses the granular rerender path, with the source list unchanged.
      // Assertion: replacement executes each property once and closes every acquisition exactly once.
      const evaluations: Array<string> = [];
      const releases: Array<string> = [];
      yield* Effect.scoped(
        Effect.gen(function* () {
          const label = yield* Signal.make("old");
          const items = yield* Signal.make([{ id: 1 }]);
          const { container } = yield* render(
            <ul>
              {Signal.each(
                items,
                () =>
                  Effect.gen(function* () {
                    const value = yield* Signal.get(label);
                    return (
                      <li
                        data-value={Effect.gen(function* () {
                          evaluations.push(value);
                          yield* Effect.addFinalizer(() =>
                            Effect.sync(() => {
                              releases.push(value);
                            }),
                          );
                          return value;
                        })}
                      >
                        {value === "old" ? <span>old</span> : <b>new</b>}
                      </li>
                    );
                  }),
                { key: (item) => item.id },
              )}
            </ul>,
          );
          const row = container.querySelector("li");
          yield* Signal.set(label, "new");
          yield* Effect.yieldNow;
          assert.deepStrictEqual(evaluations, ["old", "new"]);
          assert.notStrictEqual(container.querySelector("li"), row);
          assert.strictEqual(container.querySelector("b")?.textContent, "new");
        }),
      );
      assert.deepStrictEqual([...releases].sort(), ["new", "old"]);
    }),
  );

  for (const releaseFails of [false, true]) {
    scoped(
      `should restore a failed native row patch without rerunning properties (release fails: ${releaseFails})`,
      () =>
        Effect.gen(function* () {
          // Scope: a retained row accepts its first attribute and rejects the next while its property owns a finalizer.
          // Assertion: rollback restores old DOM; the worker Exit retains native and cleanup Causes; retry acquires once.
          const label = yield* Signal.make("old");
          const items = yield* Signal.make([{ id: 1 }]);
          const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          const evaluations: Array<string> = [];
          const releases: Array<string> = [];
          const { container } = yield* render(
            <ul>
              {Signal.each(
                items,
                () =>
                  Effect.gen(function* () {
                    const value = yield* Signal.get(label);
                    return (
                      <li
                        data-value={Effect.gen(function* () {
                          evaluations.push(value);
                          yield* Effect.addFinalizer(() =>
                            Effect.sync(() => {
                              releases.push(value);
                              if (releaseFails && value === "new") BigInt("invalid");
                            }),
                          );
                          if (value === "new")
                            yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                          return value;
                        })}
                        title={value}
                      >
                        row
                      </li>
                    );
                  }),
                { key: (item) => item.id },
              )}
            </ul>,
          );
          const row = container.querySelector("li");
          if (row === null) return assert.fail("Expected row");
          const set = row.setAttribute.bind(row);
          const setter = vi.spyOn(row, "setAttribute").mockImplementation((name, value) => {
            if (name === "title" && value === "new") decodeURIComponent("%");
            set(name, value);
          });
          yield* Effect.addFinalizer(() => Effect.sync(() => setter.mockRestore()));
          yield* Signal.set(label, "new");
          const worker = yield* Deferred.await(entered);
          const exit = yield* Fiber.await(worker);
          if (Exit.isSuccess(exit)) return assert.fail("Expected native patch failure");
          assert.deepStrictEqual(evaluations, ["old", "new"]);
          assert.deepStrictEqual(releases, ["new"]);
          assert.strictEqual(container.querySelector("li"), row);
          assert.strictEqual(row.getAttribute("data-value"), "old");
          assert.strictEqual(row.title, "old");
          assert.isTrue(
            exit.cause.reasons.some(
              (reason) => Cause.isDieReason(reason) && reason.defect instanceof URIError,
            ),
          );
          assert.strictEqual(
            exit.cause.reasons.some(
              (reason) => Cause.isDieReason(reason) && reason.defect instanceof SyntaxError,
            ),
            releaseFails,
          );
          setter.mockRestore();
          yield* Signal.set(label, "retry");
          yield* Effect.yieldNow;
          assert.deepStrictEqual(evaluations, ["old", "new", "retry"]);
          assert.strictEqual(row.getAttribute("data-value"), "retry");
        }),
    );
  }

  for (const interrupted of [false, true]) {
    scoped(
      `should preserve the committed row while property preparation stops (interrupted: ${interrupted})`,
      () =>
        Effect.gen(function* () {
          // Scope: a later property fails or suspends after the first property acquires a scoped resource.
          // Assertion: stopping preparation releases that resource, retains committed DOM, and permits a later update.
          const label = yield* Signal.make("old");
          const items = yield* Signal.make([{ id: 1 }]);
          const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          const releases: Array<string> = [];
          const evaluations: Array<string> = [];
          const { container } = yield* render(
            <ul>
              {Signal.each(
                items,
                () =>
                  Effect.gen(function* () {
                    const value = yield* Signal.get(label);
                    return (
                      <li
                        data-value={Effect.gen(function* () {
                          evaluations.push(value);
                          yield* Effect.addFinalizer(() =>
                            Effect.sync(() => {
                              releases.push(value);
                            }),
                          );
                          return value;
                        })}
                        data-stop={
                          value !== "new"
                            ? Effect.void
                            : Effect.withFiber((fiber) =>
                                Deferred.succeed(entered, fiber).pipe(
                                  Effect.andThen(
                                    interrupted ? Effect.never : new RowPropertyFailure(),
                                  ),
                                ),
                              )
                        }
                      >
                        row
                      </li>
                    );
                  }),
                { key: (item) => item.id },
              )}
            </ul>,
          );
          const row = container.querySelector("li");
          yield* Signal.set(label, "new");
          const worker = yield* Deferred.await(entered);
          if (interrupted) yield* Fiber.interrupt(worker);
          const exit = yield* Fiber.await(worker);
          assert.isTrue(Exit.isFailure(exit));
          assert.deepStrictEqual(releases, ["new"]);
          assert.deepStrictEqual(evaluations, ["old", "new"]);
          assert.strictEqual(container.querySelector("li"), row);
          assert.strictEqual(row?.getAttribute("data-value"), "old");
          yield* Signal.set(label, "retry");
          yield* Effect.yieldNow;
          assert.deepStrictEqual(evaluations, ["old", "new", "retry"]);
          assert.strictEqual(row?.getAttribute("data-value"), "retry");
        }),
    );
  }

  scoped("should stop a suspended row before newer source inputs are published", () =>
    Effect.gen(function* () {
      // Scope: an internal Signal rerender is suspended when the source list replaces the same keyed item's inputs.
      // Assertion: the old worker is interrupted and releases its acquisition before the source update publishes.
      const label = yield* Signal.make("old");
      const items = yield* Signal.make([{ id: 1, source: "old" }]);
      const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
      const sourceEntered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
      const gate = yield* Deferred.make<void>();
      const releases: Array<string> = [];
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (item) =>
              Effect.gen(function* () {
                const value = yield* Signal.get(label);
                return (
                  <li
                    data-value={Effect.gen(function* () {
                      const text = `${item.source}:${value}`;
                      yield* Effect.addFinalizer(() =>
                        Effect.sync(() => {
                          releases.push(text);
                        }),
                      );
                      if (item.source === "old" && value === "new") {
                        yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                        yield* Deferred.await(gate);
                      }
                      if (item.source === "fresh")
                        yield* Effect.withFiber((fiber) => Deferred.succeed(sourceEntered, fiber));
                      return text;
                    })}
                  >
                    row
                  </li>
                );
              }),
            { key: (item) => item.id },
          )}
        </ul>,
      );
      yield* Signal.set(label, "new");
      const oldWorker = yield* Deferred.await(entered);
      yield* Signal.set(items, [{ id: 1, source: "fresh" }]);
      const sourceWorker = yield* Deferred.await(sourceEntered);
      yield* Fiber.await(sourceWorker);
      yield* Deferred.succeed(gate, undefined);
      const oldExit = yield* Fiber.await(oldWorker);
      assert.isTrue(Exit.hasInterrupts(oldExit));
      assert.deepStrictEqual(releases, ["old:new"]);
      assert.strictEqual(container.querySelector("li")?.getAttribute("data-value"), "fresh:new");
    }),
  );

  scoped("should coalesce row dependency changes while source preparation owns the list", () =>
    Effect.gen(function* () {
      // Scope: a source update suspends after reading an internal Signal, which then changes again.
      // Assertion: queued row work uses the committed source inputs and the latest dependency value, without rendering obsolete inputs.
      const label = yield* Signal.make("old");
      const items = yield* Signal.make([{ id: 1, source: "old" }]);
      const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
      const resumed = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
      const gate = yield* Deferred.make<void>();
      const evaluations: Array<string> = [];
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (item) =>
              Effect.gen(function* () {
                const value = yield* Signal.get(label);
                return (
                  <li
                    data-value={Effect.gen(function* () {
                      const text = `${item.source}:${value}`;
                      evaluations.push(text);
                      if (item.source === "fresh" && value === "old") {
                        yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                        yield* Deferred.await(gate);
                      }
                      if (item.source === "fresh" && value === "new")
                        yield* Effect.withFiber((fiber) => Deferred.succeed(resumed, fiber));
                      return text;
                    })}
                  >
                    row
                  </li>
                );
              }),
            { key: (item) => item.id },
          )}
        </ul>,
      );
      yield* Signal.set(items, [{ id: 1, source: "fresh" }]);
      const sourceWorker = yield* Deferred.await(entered);
      yield* Signal.set(label, "new");
      yield* Effect.yieldNow;
      assert.deepStrictEqual(evaluations, ["old:old", "fresh:old"]);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.await(sourceWorker);
      const rowWorker = yield* Deferred.await(resumed);
      yield* Fiber.await(rowWorker);
      assert.deepStrictEqual(evaluations, ["old:old", "fresh:old", "fresh:new"]);
      assert.strictEqual(container.querySelector("li")?.getAttribute("data-value"), "fresh:new");
    }),
  );

  for (const interrupted of [false, true]) {
    scoped(
      `should resume queued dependencies after failed source preparation (interrupted: ${interrupted})`,
      () =>
        Effect.gen(function* () {
          // Scope: source preparation suspends while a dependency changes, then fails or is interrupted.
          // Assertion: queued work resumes with committed source inputs and the latest Signal, preserving source failure.
          const label = yield* Signal.make("old");
          const items = yield* Signal.make([{ id: 1, source: "old" }]);
          const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          const resumed = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          const gate = yield* Deferred.make<void>();
          const evaluations: Array<string> = [];
          const { container } = yield* render(
            <ul>
              {Signal.each(
                items,
                (item) =>
                  Effect.gen(function* () {
                    const value = yield* Signal.get(label);
                    return (
                      <li
                        data-value={Effect.gen(function* () {
                          const text = `${item.source}:${value}`;
                          evaluations.push(text);
                          if (item.source === "fresh") {
                            yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                            yield* Deferred.await(gate);
                            return yield* new RowPropertyFailure();
                          }
                          if (value === "new")
                            yield* Effect.withFiber((fiber) => Deferred.succeed(resumed, fiber));
                          return text;
                        })}
                      >
                        row
                      </li>
                    );
                  }),
                { key: (item) => item.id },
              )}
            </ul>,
          );
          const row = container.querySelector("li");
          yield* Signal.set(items, [{ id: 1, source: "fresh" }]);
          const sourceWorker = yield* Deferred.await(entered);
          yield* Signal.set(label, "new");
          assert.deepStrictEqual(evaluations, ["old:old", "fresh:old"]);
          if (interrupted) yield* Fiber.interrupt(sourceWorker);
          else yield* Deferred.succeed(gate, undefined);
          const sourceExit = yield* Fiber.await(sourceWorker);
          if (Exit.isSuccess(sourceExit)) return assert.fail("Expected source preparation failure");
          assert.strictEqual(Exit.hasInterrupts(sourceExit), interrupted);
          if (!interrupted)
            assert.isTrue(
              sourceExit.cause.reasons.some(
                (reason) =>
                  Cause.isFailReason(reason) && reason.error instanceof RowPropertyFailure,
              ),
            );
          const rowWorker = yield* Deferred.await(resumed);
          assert.isTrue(Exit.isSuccess(yield* Fiber.await(rowWorker)));
          assert.deepStrictEqual(evaluations, ["old:old", "fresh:old", "old:new"]);
          assert.strictEqual(container.querySelector("li"), row);
          assert.strictEqual(row?.getAttribute("data-value"), "old:new");
        }),
    );
  }

  for (const outcome of ["change", "remove", "cleanup-failure"]) {
    scoped(`should await stopped row finalization before source ${outcome}`, () =>
      Effect.gen(function* () {
        // Scope: a superseded row has asynchronous finalization, optionally failing, while the source wants to commit.
        // Assertion: source publication waits for quiescence; cleanup defects prevent a successful replacement and remain in the worker Cause.
        const label = yield* Signal.make("old");
        const items = yield* Signal.make([{ id: 1, source: "old" }]);
        const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
        const cleanupStarted = yield* Deferred.make<void>();
        const cleanupGate = yield* Deferred.make<void>();
        const removed = yield* Deferred.make<void>();
        const sourceEntered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
        const evaluations: Array<string> = [];
        const { container } = yield* render(
          <ul>
            {Signal.each(
              items,
              (item) =>
                Effect.gen(function* () {
                  const value = yield* Signal.get(label);
                  return (
                    <li
                      data-value={Effect.gen(function* () {
                        const text = `${item.source}:${value}`;
                        evaluations.push(text);
                        if (text === "old:old")
                          yield* Effect.addFinalizer(() => Deferred.succeed(removed, undefined));
                        if (text === "old:new") {
                          yield* Effect.addFinalizer(() =>
                            Effect.gen(function* () {
                              yield* Deferred.succeed(cleanupStarted, undefined);
                              yield* Deferred.await(cleanupGate);
                              if (outcome === "cleanup-failure")
                                yield* Effect.sync(() => {
                                  BigInt("invalid");
                                });
                            }),
                          );
                          yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                          return yield* Effect.never;
                        }
                        if (item.source === "fresh")
                          yield* Effect.withFiber((fiber) =>
                            Deferred.succeed(sourceEntered, fiber),
                          );
                        return text;
                      })}
                    >
                      row
                    </li>
                  );
                }),
              { key: (item) => item.id },
            )}
          </ul>,
        );
        const row = container.querySelector("li");
        yield* Signal.set(label, "new");
        const oldWorker = yield* Deferred.await(entered);
        yield* Signal.set(items, outcome === "remove" ? [] : [{ id: 1, source: "fresh" }]);
        yield* Deferred.await(cleanupStarted);
        assert.strictEqual(container.querySelector("li"), row);
        assert.strictEqual(row?.getAttribute("data-value"), "old:old");
        assert.deepStrictEqual(evaluations, ["old:old", "old:new"]);
        yield* Deferred.succeed(cleanupGate, undefined);
        const stopped = yield* Fiber.await(oldWorker);
        if (Exit.isSuccess(stopped)) return assert.fail("Expected stopped row");
        assert.isTrue(Cause.hasInterrupts(stopped.cause));
        if (outcome === "change") {
          const sourceWorker = yield* Deferred.await(sourceEntered);
          yield* Fiber.await(sourceWorker);
          assert.strictEqual(row?.getAttribute("data-value"), "fresh:new");
        } else if (outcome === "remove") {
          yield* Deferred.await(removed);
          assert.strictEqual(container.querySelector("li"), null);
        } else {
          yield* Effect.yieldNow;
          assert.isTrue(
            stopped.cause.reasons.some(
              (reason) => Cause.isDieReason(reason) && reason.defect instanceof SyntaxError,
            ),
          );
          assert.deepStrictEqual(evaluations, ["old:old", "old:new"]);
          assert.strictEqual(row?.getAttribute("data-value"), "old:old");
        }
      }),
    );
  }
});
