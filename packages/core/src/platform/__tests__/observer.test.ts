/**
 * Observer Service Tests
 *
 * Tests the in-memory test layer for Observer.
 */
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Ref, Scope } from "effect";
import {
  Observer,
  TestObserver,
  browser as observerBrowser,
  test as observerTest,
} from "../observer.js";

const makeMutationRecords: Effect.Effect<Array<MutationRecord>> = Effect.sync(() => {
  const target = document.createElement("div");
  const observer = new MutationObserver(() => undefined);
  observer.observe(target, { childList: true });
  target.appendChild(document.createElement("span"));
  const first = observer.takeRecords();
  target.appendChild(document.createElement("span"));
  const second = observer.takeRecords();
  observer.disconnect();
  return [...first, ...second];
});

describe("Observer.intersection", () => {
  it.effect("observe registers element for intersection", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const testObs = yield* TestObserver;
      const received: Array<Element> = [];
      const el = document.createElement("div");

      const handle = yield* obs.intersection({
        onIntersect: (entry) =>
          Effect.sync(() => {
            received.push(entry.target);
          }),
      });

      yield* handle.observe(el);
      yield* testObs.triggerIntersection(el);

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0], el);
    }).pipe(Effect.provide(observerTest)),
  );

  it.effect("unobserve removes element from observation", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const testObs = yield* TestObserver;
      const received: Array<Element> = [];
      const el = document.createElement("div");

      const handle = yield* obs.intersection({
        onIntersect: (entry) =>
          Effect.sync(() => {
            received.push(entry.target);
          }),
      });

      yield* handle.observe(el);
      yield* handle.unobserve(el);
      yield* testObs.triggerIntersection(el);

      assert.strictEqual(received.length, 0);
    }).pipe(Effect.provide(observerTest)),
  );

  it.effect("scope close cleans up observers", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const testObs = yield* TestObserver;
      const received: Array<Element> = [];
      const el = document.createElement("div");

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
      yield* testObs.triggerIntersection(el);
      assert.strictEqual(received.length, 0);
    }).pipe(Effect.provide(observerTest)),
  );

  it.effect("multiple elements can be observed", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const testObs = yield* TestObserver;
      const received: Array<string> = [];
      const el1 = document.createElement("div");
      el1.id = "1";
      const el2 = document.createElement("span");
      el2.id = "2";

      const handle = yield* obs.intersection({
        onIntersect: (entry) =>
          Effect.sync(() => {
            received.push(entry.target.id);
          }),
      });

      yield* handle.observe(el1);
      yield* handle.observe(el2);

      yield* testObs.triggerIntersection(el1);
      yield* testObs.triggerIntersection(el2);

      assert.deepStrictEqual(received, ["1", "2"]);
    }).pipe(Effect.provide(observerTest)),
  );

  it.effect("triggerIntersection on unobserved element is no-op", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const testObs = yield* TestObserver;
      const received: Array<Element> = [];
      const el = document.createElement("div");

      yield* obs.intersection({
        onIntersect: (entry) =>
          Effect.sync(() => {
            received.push(entry.target);
          }),
      });

      // Don't observe el, just trigger
      yield* testObs.triggerIntersection(el);
      assert.strictEqual(received.length, 0);
    }).pipe(Effect.provide(observerTest)),
  );
});

describe("Observer.mutation", () => {
  it.effect("mutation registers handler for target", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const testObs = yield* TestObserver;
      const received: Array<number> = [];
      const target = document.createElement("div");

      yield* obs.mutation(target, { childList: true }, (mutations) =>
        Effect.sync(() => {
          received.push(mutations.length);
        }),
      );

      const mutationRecords = yield* makeMutationRecords;
      yield* testObs.triggerMutation(target, mutationRecords);

      assert.deepStrictEqual(received, [2]);
    }).pipe(Effect.provide(observerTest)),
  );

  it.effect("mutation handler removed on scope close", () =>
    Effect.gen(function* () {
      const obs = yield* Observer;
      const testObs = yield* TestObserver;
      const received: Array<number> = [];
      const target = document.createElement("div");

      const scope = yield* Scope.make();
      yield* obs
        .mutation(target, { childList: true }, (mutations) =>
          Effect.sync(() => {
            received.push(mutations.length);
          }),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));

      yield* Scope.close(scope, Exit.void);

      const mutationRecords = yield* makeMutationRecords;
      yield* testObs.triggerMutation(target, mutationRecords);

      assert.deepStrictEqual(received, []);
    }).pipe(Effect.provide(observerTest)),
  );
});

describe("Observer browser supervision", () => {
  it.effect("intersection handler fiber is interrupted on scope close", () =>
    Effect.gen(function* () {
      const OriginalIntersectionObserver = globalThis.IntersectionObserver;
      const callbackRef: { current: IntersectionObserverCallback | null } = { current: null };

      class FakeIntersectionObserver implements IntersectionObserver {
        readonly root = null;
        readonly rootMargin = "0px";
        readonly scrollMargin = "0px";
        readonly thresholds = [0];

        constructor(cb: IntersectionObserverCallback) {
          callbackRef.current = cb;
        }

        disconnect(): void {}
        observe(_target: Element): void {}
        takeRecords(): Array<IntersectionObserverEntry> {
          return [];
        }
        unobserve(_target: Element): void {}
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.IntersectionObserver = OriginalIntersectionObserver;
        }),
      );

      yield* Effect.sync(() => {
        globalThis.IntersectionObserver = FakeIntersectionObserver;
      });

      const interrupted = yield* Ref.make(false);
      const gate = yield* Deferred.make<void>();
      const el = document.createElement("div");
      const scope = yield* Scope.make();
      const obs = yield* Observer;

      const handle = yield* obs
        .intersection({
          onIntersect: () =>
            Deferred.await(gate).pipe(Effect.onInterrupt(() => Ref.set(interrupted, true))),
        })
        .pipe(Effect.provideService(Scope.Scope, scope));

      yield* handle.observe(el);
      if (callbackRef.current !== null) {
        const intersectionCallback = callbackRef.current;
        intersectionCallback(
          [
            {
              target: el,
              isIntersecting: true,
              intersectionRatio: 1,
              boundingClientRect: el.getBoundingClientRect(),
              intersectionRect: el.getBoundingClientRect(),
              rootBounds: null,
              time: 0,
            },
          ],
          new FakeIntersectionObserver(intersectionCallback),
        );
      }

      yield* Scope.close(scope, Exit.void);
      assert.isTrue(yield* Ref.get(interrupted));
    }).pipe(Effect.provide(observerBrowser)),
  );
});
