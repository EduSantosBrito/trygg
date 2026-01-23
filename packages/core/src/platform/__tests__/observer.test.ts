/**
 * Observer Service Tests
 *
 * Tests the in-memory test layer for Observer.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { Observer, test as observerTest, type TestObserverService } from "../observer.js";

describe("Observer.intersection", () => {
  it.scoped("observe registers element for intersection", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const received: Array<Element> = [];
      const el = { tagName: "DIV" } as unknown as Element;

      const handle = yield* obs.intersection({
        onIntersect: (entry) =>
          Effect.sync(() => {
            received.push(entry.target);
          }),
      });

      yield* handle.observe(el);
      yield* (obs as TestObserverService).triggerIntersection(el);

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0], el);
    }).pipe(Effect.provide(observerTest)),
  );

  it.scoped("unobserve removes element from observation", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const received: Array<Element> = [];
      const el = { tagName: "DIV" } as unknown as Element;

      const handle = yield* obs.intersection({
        onIntersect: (entry) =>
          Effect.sync(() => {
            received.push(entry.target);
          }),
      });

      yield* handle.observe(el);
      yield* handle.unobserve(el);
      yield* (obs as TestObserverService).triggerIntersection(el);

      assert.strictEqual(received.length, 0);
    }).pipe(Effect.provide(observerTest)),
  );

  it.effect("scope close cleans up observers", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const received: Array<Element> = [];
      const el = { tagName: "DIV" } as unknown as Element;

      const scope = yield* Scope.make();
      const handle = yield* obs
        .intersection({
          onIntersect: (entry) =>
            Effect.sync(() => {
              received.push(entry.target);
            }),
        })
        .pipe(Effect.provideService(Scope.Scope, scope));

      yield* handle.observe(el);
      yield* Scope.close(scope, Exit.void);

      // After scope close, trigger should not fire handler
      yield* (obs as TestObserverService).triggerIntersection(el);
      assert.strictEqual(received.length, 0);
    }).pipe(Effect.provide(observerTest)),
  );

  it.scoped("multiple elements can be observed", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const received: Array<string> = [];
      const el1 = { tagName: "DIV", id: "1" } as unknown as Element;
      const el2 = { tagName: "SPAN", id: "2" } as unknown as Element;

      const handle = yield* obs.intersection({
        onIntersect: (entry) =>
          Effect.sync(() => {
            received.push((entry.target as unknown as { id: string }).id);
          }),
      });

      yield* handle.observe(el1);
      yield* handle.observe(el2);

      yield* (obs as TestObserverService).triggerIntersection(el1);
      yield* (obs as TestObserverService).triggerIntersection(el2);

      assert.deepStrictEqual(received, ["1", "2"]);
    }).pipe(Effect.provide(observerTest)),
  );

  it.scoped("triggerIntersection on unobserved element is no-op", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const received: Array<Element> = [];
      const el = { tagName: "DIV" } as unknown as Element;

      yield* obs.intersection({
        onIntersect: (entry) =>
          Effect.sync(() => {
            received.push(entry.target);
          }),
      });

      // Don't observe el, just trigger
      yield* (obs as TestObserverService).triggerIntersection(el);
      assert.strictEqual(received.length, 0);
    }).pipe(Effect.provide(observerTest)),
  );
});

describe("Observer.mutation", () => {
  it.scoped("mutation registers handler for target", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const received: Array<number> = [];
      const target = { nodeType: 1 } as unknown as Node;

      yield* obs.mutation(target, { childList: true }, (mutations) =>
        Effect.sync(() => {
          received.push(mutations.length);
        }),
      );

      yield* (obs as TestObserverService).triggerMutation(target, [
        {} as MutationRecord,
        {} as MutationRecord,
      ]);

      assert.deepStrictEqual(received, [2]);
    }).pipe(Effect.provide(observerTest)),
  );

  it.effect("mutation handler removed on scope close", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const received: Array<number> = [];
      const target = { nodeType: 1 } as unknown as Node;

      const scope = yield* Scope.make();
      yield* obs
        .mutation(target, { childList: true }, (mutations) =>
          Effect.sync(() => {
            received.push(mutations.length);
          }),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));

      yield* Scope.close(scope, Exit.void);

      yield* (obs as TestObserverService).triggerMutation(target, [{} as MutationRecord]);

      assert.deepStrictEqual(received, []);
    }).pipe(Effect.provide(observerTest)),
  );
});
