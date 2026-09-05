import { assert, describe } from "@effect/vitest";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Ref, Schema, Scope } from "effect";
import * as References from "effect/References";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import { unsafeWidenContext } from "../../internal/unsafe.js";
import { Element } from "../element.js";
import * as Signal from "../signal.js";

class Label extends Context.Service<Label, { readonly value: Ref.Ref<string> }>()(
  "test/row/Label",
) {}

for (const nested of [false, true]) {
  describe(`keyed row service context (nested: ${nested})`, () => {
    scoped(
      "should retain captured services and ambient annotations while row Scopes own every acquisition",
      () =>
        Effect.gen(function* () {
          // Scope: service capture is shared across source and granular renders, with an unrelated captured Scope.
          // Assertion: service identity and live state survive updates; caller annotations remain visible; removing one row releases only that row.
          const mountScope = yield* Scope.fork(yield* Effect.scope);
          const capturedScope = yield* Scope.fork(yield* Effect.scope);
          const label = { value: yield* Ref.make("initial") };
          const caller = { value: yield* Ref.make("caller") };
          const tick = yield* Signal.make(0);
          const items = yield* Signal.make([{ id: 1, revision: 0 }]);
          let entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          const released: Array<number> = [];
          const observations: Array<{
            readonly id: number;
            readonly label: string;
            readonly annotation: unknown;
          }> = [];
          const list = (
            <ul>
              {Signal.each(
                items,
                (item) =>
                  Effect.gen(function* () {
                    const service = yield* Label;
                    assert.strictEqual(service, label);
                    const rowScope = yield* Effect.scope;
                    assert.notStrictEqual(rowScope, mountScope);
                    assert.notStrictEqual(rowScope, capturedScope);
                    yield* Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        released.push(item.id);
                      }),
                    );
                    yield* Signal.get(tick);
                    const value = yield* Ref.get(service.value);
                    const annotations = yield* References.CurrentLogAnnotations;
                    observations.push({
                      id: item.id,
                      label: value,
                      annotation: annotations["request"],
                    });
                    yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                    return (
                      <li
                        data-id={item.id}
                        data-request={Effect.gen(function* () {
                          const current = yield* References.CurrentLogAnnotations;
                          return typeof current["request"] === "string"
                            ? current["request"]
                            : "none";
                        })}
                      >
                        {value}
                      </li>
                    );
                  }),
                { key: (item) => item.id },
              )}
            </ul>
          );
          const element = nested
            ? Element.Provide({
                context: unsafeWidenContext(
                  Context.make(Label, label).pipe(
                    Context.add(Scope.Scope, capturedScope),
                    Context.add(References.CurrentLogAnnotations, { request: "captured" }),
                  ),
                ),
                child: list,
              })
            : list;
          const { container } = yield* render(element).pipe(
            Effect.provideService(Label, nested ? caller : label),
            Scope.provide(mountScope),
          );
          const first = container.querySelector("li");
          yield* Ref.set(label.value, "changed");
          entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          yield* Signal.set(items, [{ id: 1, revision: 1 }]).pipe(
            Effect.provideService(Label, caller),
            Effect.annotateLogs("request", "source-update"),
          );
          assert.isTrue(Exit.isSuccess(yield* Fiber.await(yield* Deferred.await(entered))));
          assert.strictEqual(container.querySelector("li"), first);
          assert.strictEqual(first?.textContent, "changed");
          assert.strictEqual(first?.getAttribute("data-request"), "source-update");
          assert.deepStrictEqual(observations.slice(0, 2), [
            { id: 1, label: "initial", annotation: nested ? "captured" : undefined },
            { id: 1, label: "changed", annotation: "source-update" },
          ]);
          entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
          yield* Signal.set(tick, 1).pipe(Effect.provideService(Label, caller));
          assert.isTrue(Exit.isSuccess(yield* Fiber.await(yield* Deferred.await(entered))));
          assert.strictEqual(container.querySelector("li"), first);
          assert.deepStrictEqual(released, []);
          yield* Signal.update(items, (current) => [...current, { id: 2, revision: 0 }]);
          yield* Signal.update(items, (current) => current.filter((item) => item.id !== 1));
          assert.deepStrictEqual(released, [1, 1, 1]);
          assert.strictEqual(container.querySelector("li")?.getAttribute("data-id"), "2");
          yield* Scope.close(mountScope, Exit.void);
          assert.deepStrictEqual([...released].sort(), [1, 1, 1, 2, 2]);
        }),
    );
  });
}

class QueuedContextFailure extends Schema.TaggedError<QueuedContextFailure>()(
  "QueuedContextFailure",
  {},
) {}

for (const trigger of ["source", "granular"]) {
  scoped(`should use ${trigger} caller annotations without replacing captured row services`, () =>
    Effect.gen(function* () {
      // Scope: source and dependency notifications fork workers with a service shadowed by the caller.
      // Assertion: body and property Effects share captured service identity and current caller annotations.
      const label = { value: yield* Ref.make("captured") };
      const caller = { value: yield* Ref.make("caller") };
      const tick = yield* Signal.make(0);
      const items = yield* Signal.make([{ id: 1, revision: 0 }]);
      const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
      const observations: Array<unknown> = [];
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            (item) =>
              Effect.gen(function* () {
                assert.strictEqual(yield* Label, label);
                const value = trigger === "source" ? item.revision : yield* Signal.get(tick);
                const annotations = yield* References.CurrentLogAnnotations;
                observations.push(annotations["request"]);
                if (value > 0) yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                return (
                  <li
                    data-request={Effect.gen(function* () {
                      assert.strictEqual(yield* Label, label);
                      const current = yield* References.CurrentLogAnnotations;
                      return current["request"];
                    })}
                  >
                    {value}
                  </li>
                );
              }),
            { key: (item) => item.id },
          )}
        </ul>,
      ).pipe(Effect.provideService(Label, label), Effect.annotateLogs("request", "mount"));
      const row = container.querySelector("li");
      yield* (
        trigger === "source" ? Signal.set(items, [{ id: 1, revision: 1 }]) : Signal.set(tick, 1)
      ).pipe(Effect.provideService(Label, caller), Effect.annotateLogs("request", trigger));
      assert.isTrue(Exit.isSuccess(yield* Fiber.await(yield* Deferred.await(entered))));
      assert.deepStrictEqual(observations, ["mount", trigger]);
      assert.strictEqual(container.querySelector("li"), row);
      assert.strictEqual(row?.getAttribute("data-request"), trigger);
    }),
  );
}

for (const blockedBy of ["source", "granular"]) {
  for (const outcome of ["success", "failure", "interrupt"]) {
    scoped(`should preserve queued granular context after ${blockedBy} ${outcome}`, () =>
      Effect.gen(function* () {
        // Scope: granular preparation suspends while two dependency notifications coalesce.
        // Assertion: the latest value and its annotations render once, even after predecessor failure or interruption.
        const tick = yield* Signal.make(0);
        const items = yield* Signal.make([{ id: 1, revision: 0 }]);
        const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
        const resumed = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
        const gate = yield* Deferred.make<void>();
        const seen: Array<{ readonly value: number; readonly request: unknown }> = [];
        const { container } = yield* render(
          <ul>
            {Signal.each(
              items,
              (item) =>
                Effect.gen(function* () {
                  const value = yield* Signal.get(tick);
                  const revision = blockedBy === "source" && value === 0 ? item.revision : value;
                  const annotations = yield* References.CurrentLogAnnotations;
                  seen.push({ value: revision, request: annotations["request"] });
                  if (revision === 1) {
                    yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                    yield* Deferred.await(gate);
                    if (outcome === "failure") return yield* new QueuedContextFailure();
                  }
                  if (value === 3)
                    yield* Effect.withFiber((fiber) => Deferred.succeed(resumed, fiber));
                  return (
                    <li
                      data-request={Effect.map(
                        References.CurrentLogAnnotations,
                        (current) => current["request"],
                      )}
                    >
                      {value}
                    </li>
                  );
                }),
              { key: (item) => item.id },
            )}
          </ul>,
        );
        const row = container.querySelector("li");
        yield* (
          blockedBy === "source" ? Signal.set(items, [{ id: 1, revision: 1 }]) : Signal.set(tick, 1)
        ).pipe(Effect.annotateLogs("request", "first"));
        const firstWorker = yield* Deferred.await(entered);
        yield* Signal.set(tick, 2).pipe(Effect.annotateLogs("request", "middle"));
        yield* Signal.set(tick, 3).pipe(Effect.annotateLogs("request", "latest"));
        if (outcome === "interrupt") yield* Fiber.interrupt(firstWorker);
        else yield* Deferred.succeed(gate, undefined);
        const firstExit = yield* Fiber.await(firstWorker);
        assert.strictEqual(Exit.isSuccess(firstExit), outcome === "success");
        assert.strictEqual(Exit.hasInterrupts(firstExit), outcome === "interrupt");
        assert.deepStrictEqual(seen, [
          { value: 0, request: undefined },
          { value: 1, request: "first" },
          { value: 3, request: "latest" },
        ]);
        assert.isTrue(Exit.isSuccess(yield* Fiber.await(yield* Deferred.await(resumed))));
        assert.strictEqual(container.querySelector("li"), row);
        assert.strictEqual(row?.textContent, "3");
        assert.strictEqual(row?.getAttribute("data-request"), "latest");
      }),
    );
  }
}

scoped("should coalesce a granular burst until failed preparation has finished cleanup", () =>
  Effect.gen(function* () {
    // Scope: one failed row holds an asynchronous, defective release while 1,000 dependency updates arrive.
    // Assertion: no overlapping render or intermediate acquisition; latest annotations survive and both failure Reasons remain observable.
    const tick = yield* Signal.make(0);
    const items = yield* Signal.make([{ id: 1 }]);
    const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
    const resumed = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
    const cleanupStarted = yield* Deferred.make<void>();
    const cleanupGate = yield* Deferred.make<void>();
    const cleanupDefect = new QueuedContextFailure();
    const seen: Array<{ readonly value: number; readonly request: unknown }> = [];
    const { container } = yield* render(
      <ul>
        {Signal.each(
          items,
          () =>
            Effect.gen(function* () {
              const value = yield* Signal.get(tick);
              const annotations = yield* References.CurrentLogAnnotations;
              seen.push({ value, request: annotations["request"] });
              if (value === 1) {
                yield* Effect.addFinalizer(() =>
                  Effect.gen(function* () {
                    yield* Deferred.succeed(cleanupStarted, undefined);
                    yield* Deferred.await(cleanupGate);
                    return yield* Effect.failCause(Cause.die(cleanupDefect));
                  }),
                );
                yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                return yield* new QueuedContextFailure();
              }
              if (value > 0) yield* Effect.withFiber((fiber) => Deferred.succeed(resumed, fiber));
              return <li>{value}</li>;
            }),
          { key: (item) => item.id },
        )}
      </ul>,
    );
    const row = container.querySelector("li");
    yield* Signal.set(tick, 1).pipe(Effect.annotateLogs("request", "first"));
    const worker = yield* Deferred.await(entered);
    yield* Deferred.await(cleanupStarted);
    for (let value = 2; value <= 1_001; value++)
      yield* Signal.set(tick, value).pipe(Effect.annotateLogs("request", `update-${value}`));
    assert.deepStrictEqual(seen, [
      { value: 0, request: undefined },
      { value: 1, request: "first" },
    ]);
    assert.strictEqual(row?.textContent, "0");
    yield* Deferred.succeed(cleanupGate, undefined);
    const exit = yield* Fiber.await(worker);
    if (Exit.isSuccess(exit)) return assert.fail("Expected preparation and cleanup failure");
    assert.isTrue(
      exit.cause.reasons.some(
        (reason) => Cause.isFailReason(reason) && reason.error instanceof QueuedContextFailure,
      ),
    );
    assert.isTrue(
      exit.cause.reasons.some(
        (reason) => Cause.isDieReason(reason) && reason.defect === cleanupDefect,
      ),
    );
    assert.isTrue(Exit.isSuccess(yield* Fiber.await(yield* Deferred.await(resumed))));
    assert.deepStrictEqual(seen, [
      { value: 0, request: undefined },
      { value: 1, request: "first" },
      { value: 1_001, request: "update-1001" },
    ]);
    assert.strictEqual(container.querySelector("li"), row);
    assert.strictEqual(row?.textContent, "1001");
  }),
);

for (const retirement of ["remove", "shutdown"]) {
  scoped(`should discard queued granular work during ${retirement}`, () =>
    Effect.gen(function* () {
      // Scope: a suspended granular worker has pending work when its row or mount retires.
      // Assertion: shutdown interrupts the worker, releases each acquisition once and rejects reentrant cleanup notifications.
      const mountScope = yield* Scope.fork(yield* Effect.scope);
      const tick = yield* Signal.make(0);
      const items = yield* Signal.make([{ id: 1 }]);
      const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
      const gate = yield* Deferred.make<void>();
      const released: Array<number> = [];
      const seen: Array<number> = [];
      const { container } = yield* render(
        <ul>
          {Signal.each(
            items,
            () =>
              Effect.gen(function* () {
                const value = yield* Signal.get(tick);
                seen.push(value);
                yield* Effect.addFinalizer(() =>
                  Effect.gen(function* () {
                    released.push(value);
                    yield* Signal.set(tick, 4).pipe(Effect.annotateLogs("request", "cleanup"));
                  }),
                );
                if (value === 1) {
                  yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                  yield* Deferred.await(gate);
                }
                return <li>{value}</li>;
              }),
            { key: (item) => item.id },
          )}
        </ul>,
      ).pipe(Scope.provide(mountScope));
      yield* Signal.set(tick, 1);
      const worker = yield* Deferred.await(entered);
      yield* Signal.set(tick, 2).pipe(Effect.annotateLogs("request", "middle"));
      yield* Signal.set(tick, 3).pipe(Effect.annotateLogs("request", "latest"));
      if (retirement === "shutdown") yield* Scope.close(mountScope, Exit.void);
      else {
        yield* Signal.set(items, []);
        yield* Effect.yieldNow;
      }
      assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(worker)));
      assert.deepStrictEqual(seen, [0, 1]);
      assert.deepStrictEqual([...released].sort(), [0, 1]);
      assert.strictEqual(container.querySelector("li"), null);
      yield* Signal.set(tick, 5);
      yield* Deferred.succeed(gate, undefined);
      assert.deepStrictEqual(seen, [0, 1]);
      yield* Scope.close(mountScope, Exit.void);
      assert.deepStrictEqual([...released].sort(), [0, 1]);
    }),
  );
}

for (const outcome of ["success", "failure", "interrupt"]) {
  scoped(`should preserve the latest queued source context after ${outcome}`, () =>
    Effect.gen(function* () {
      // Scope: source preparation suspends while two more source updates arrive with different annotations.
      // Assertion: only the latest pending input renders, and its body/properties use its own annotations even after predecessor failure.
      const items = yield* Signal.make([{ id: 1, revision: 0 }]);
      const entered = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
      const resumed = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>();
      const gate = yield* Deferred.make<void>();
      const seen: Array<{ readonly revision: number; readonly request: unknown }> = [];
      const { container } = yield* render(
        Element.Provide({
          context: unsafeWidenContext(
            Context.make(References.CurrentLogAnnotations, { request: "captured" }),
          ),
          child: (
            <ul>
              {Signal.each(
                items,
                (item) =>
                  Effect.gen(function* () {
                    const annotations = yield* References.CurrentLogAnnotations;
                    seen.push({ revision: item.revision, request: annotations["request"] });
                    if (item.revision === 1) {
                      yield* Effect.withFiber((fiber) => Deferred.succeed(entered, fiber));
                      yield* Deferred.await(gate);
                      if (outcome === "failure") return yield* new QueuedContextFailure();
                    }
                    if (item.revision === 3)
                      yield* Effect.withFiber((fiber) => Deferred.succeed(resumed, fiber));
                    return (
                      <li
                        data-request={Effect.map(
                          References.CurrentLogAnnotations,
                          (current) => current["request"],
                        )}
                      >
                        {item.revision}
                      </li>
                    );
                  }),
                { key: (item) => item.id },
              )}
            </ul>
          ),
        }),
      );
      yield* Signal.set(items, [{ id: 1, revision: 1 }]).pipe(
        Effect.annotateLogs("request", "first"),
      );
      const firstWorker = yield* Deferred.await(entered);
      yield* Signal.set(items, [{ id: 1, revision: 2 }]).pipe(
        Effect.annotateLogs("request", "middle"),
      );
      yield* Signal.set(items, [{ id: 1, revision: 3 }]).pipe(
        Effect.annotateLogs("request", "latest"),
      );
      if (outcome === "interrupt") yield* Fiber.interrupt(firstWorker);
      else yield* Deferred.succeed(gate, undefined);
      const firstExit = yield* Fiber.await(firstWorker);
      assert.strictEqual(Exit.isSuccess(firstExit), outcome === "success");
      assert.strictEqual(Exit.hasInterrupts(firstExit), outcome === "interrupt");
      const latestWorker = yield* Deferred.await(resumed);
      assert.isTrue(Exit.isSuccess(yield* Fiber.await(latestWorker)));
      assert.deepStrictEqual(seen, [
        { revision: 0, request: "captured" },
        { revision: 1, request: "first" },
        { revision: 3, request: "latest" },
      ]);
      assert.strictEqual(container.querySelector("li")?.textContent, "3");
      assert.strictEqual(container.querySelector("li")?.getAttribute("data-request"), "latest");
    }),
  );
}
