/* oxlint-disable effect/no-raw-throw, effect/no-built-in-error-constructor, effect/no-type-casting -- Native failure fakes must violate normal browser and Effect contracts under test. */
/**
 * Observer Service Tests
 *
 * Tests the in-memory test layer for Observer.
 */
import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Ref,
  Scheduler,
  Scope,
} from "effect";
import {
  Observer,
  ObserverError,
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

type ObserverAdapterName = "controlled" | "browser";

interface ObserverConformanceHarness {
  readonly layer: Layer.Layer<Observer | TestObserver, ObserverError>;
  readonly intersectionDisconnectCount: () => number | null;
  readonly mutationDisconnectCount: () => number | null;
}

const flushHostMicrotasks: Effect.Effect<void> = Effect.callback((resume) => {
  queueMicrotask(() => resume(Effect.void));
});

const setupObserverConformance = (
  adapter: ObserverAdapterName,
): Effect.Effect<ObserverConformanceHarness, never, Scope.Scope> => {
  if (adapter === "controlled") {
    return Effect.succeed({
      layer: observerTest,
      intersectionDisconnectCount: () => null,
      mutationDisconnectCount: () => null,
    });
  }

  const OriginalIntersectionObserver = globalThis.IntersectionObserver;
  const OriginalMutationObserver = globalThis.MutationObserver;
  const intersectionObservers = new Set<ConformanceIntersectionObserver>();
  const mutationObservers = new Set<ConformanceMutationObserver>();
  let intersectionDisconnects = 0;
  let mutationDisconnects = 0;

  class ConformanceIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly scrollMargin = "0px";
    readonly thresholds = [0];
    readonly targets = new Set<Element>();

    constructor(readonly callback: IntersectionObserverCallback) {
      intersectionObservers.add(this);
    }

    disconnect(): void {
      intersectionDisconnects++;
      this.targets.clear();
    }

    observe(target: Element): void {
      this.targets.add(target);
    }

    takeRecords(): Array<IntersectionObserverEntry> {
      return [];
    }

    unobserve(target: Element): void {
      this.targets.delete(target);
    }

    trigger(target: Element, entry?: Partial<IntersectionObserverEntry>): void {
      if (!this.targets.has(target)) return;
      const rect = target.getBoundingClientRect();
      this.callback(
        [
          {
            target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
            time: 0,
            ...entry,
          },
        ],
        this,
      );
    }
  }

  class ConformanceMutationObserver implements MutationObserver {
    readonly targets = new Set<Node>();

    constructor(readonly callback: MutationCallback) {
      mutationObservers.add(this);
    }

    disconnect(): void {
      mutationDisconnects++;
      this.targets.clear();
    }

    observe(target: Node, _options?: MutationObserverInit): void {
      this.targets.add(target);
    }

    takeRecords(): Array<MutationRecord> {
      return [];
    }

    trigger(target: Node, mutations: ReadonlyArray<MutationRecord>): void {
      if (this.targets.has(target)) this.callback(Array.from(mutations), this);
    }
  }

  const controls = TestObserver.of({
    triggerIntersection: (target, entry) =>
      Effect.sync(() => {
        for (const observer of intersectionObservers) observer.trigger(target, entry);
      }),
    triggerMutation: (target, mutations) =>
      Effect.sync(() => {
        for (const observer of mutationObservers) observer.trigger(target, mutations);
      }),
    drain: Effect.gen(function* () {
      yield* flushHostMicrotasks;
      yield* Effect.yieldNow;
    }),
  });

  return Effect.acquireRelease(
    Effect.sync(() => {
      globalThis.IntersectionObserver = ConformanceIntersectionObserver;
      globalThis.MutationObserver = ConformanceMutationObserver;
      return {
        layer: Layer.merge(observerBrowser, Layer.succeed(TestObserver, controls)),
        intersectionDisconnectCount: () => intersectionDisconnects,
        mutationDisconnectCount: () => mutationDisconnects,
      };
    }),
    () =>
      Effect.sync(() => {
        globalThis.IntersectionObserver = OriginalIntersectionObserver;
        globalThis.MutationObserver = OriginalMutationObserver;
      }),
  );
};

const observerAdapters: ReadonlyArray<ObserverAdapterName> = ["controlled", "browser"];
const observerKinds: ReadonlyArray<"intersection" | "mutation"> = ["intersection", "mutation"];

for (const adapter of observerAdapters) {
  describe(`Observer ${adapter} adapter conformance`, () => {
    it.effect("should reject retained intersection handles after their owner closes", () =>
      Effect.gen(function* () {
        // Scope: an escaped handle must not reactivate a disconnected native observer.
        // Assertion: observe and unobserve fail through ObserverError after scope closure.
        const harness = yield* setupObserverConformance(adapter);
        yield* Effect.gen(function* () {
          const observers = yield* Observer;
          const owner = yield* Scope.make();
          yield* Effect.addFinalizer(() => Scope.close(owner, Exit.void));
          const handle = yield* observers
            .intersection({ onIntersect: () => Effect.void })
            .pipe(Scope.provide(owner));
          const target = document.createElement("div");
          yield* handle.observe(target);
          const closingStarted = yield* Deferred.make<void>();
          const allowClose = yield* Deferred.make<void>();
          yield* Scope.addFinalizer(
            owner,
            Deferred.succeed(closingStarted, undefined).pipe(
              Effect.andThen(Deferred.await(allowClose)),
            ),
          );
          const closing = yield* Scope.close(owner, Exit.void).pipe(Effect.forkChild);
          yield* Deferred.await(closingStarted);
          const duringClose = yield* Effect.exit(handle.observe(target));
          yield* Deferred.succeed(allowClose, undefined);
          yield* Fiber.join(closing);
          assert.isTrue(Exit.isFailure(duringClose));
          for (const operation of [handle.observe(target), handle.unobserve(target)]) {
            const exit = yield* Effect.exit(operation);
            assert.isTrue(Exit.isFailure(exit));
            if (Exit.isFailure(exit)) assert.isTrue(Cause.hasFails(exit.cause));
          }
          const disconnects = harness.intersectionDisconnectCount();
          if (disconnects !== null) assert.strictEqual(disconnects, 1);
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("should observe, unobserve, and clean up intersections", () =>
      Effect.gen(function* () {
        // Test: should observe, unobserve, and clean up intersections through every Observer adapter.
        // Scope: runs one public IntersectionHandle lifecycle against controlled and browser Layers.
        // Assertion: delivery occurs once, unobserve/close prevent later delivery, and native disconnect is exact.
        const harness = yield* setupObserverConformance(adapter);

        yield* Effect.gen(function* () {
          const observer = yield* Observer;
          const controls = yield* TestObserver;
          const scope = yield* Scope.make();
          const target = document.createElement("div");
          const deliveries = yield* Ref.make(0);
          const firstDelivery = yield* Deferred.make<void>();
          const handle = yield* observer
            .intersection({
              onIntersect: () =>
                Effect.gen(function* () {
                  yield* Ref.update(deliveries, (count) => count + 1);
                  yield* Deferred.succeed(firstDelivery, undefined);
                }),
            })
            .pipe(Scope.provide(scope));

          yield* handle.observe(target);
          yield* controls.triggerIntersection(target);
          yield* Deferred.await(firstDelivery);
          assert.strictEqual(yield* Ref.get(deliveries), 1);

          yield* handle.unobserve(target);
          yield* controls.triggerIntersection(target);
          yield* controls.drain;
          yield* flushHostMicrotasks;
          yield* Effect.yieldNow;
          assert.strictEqual(yield* Ref.get(deliveries), 1);

          yield* handle.observe(target);
          yield* Scope.close(scope, Exit.void);
          yield* controls.triggerIntersection(target);
          yield* controls.drain;
          yield* flushHostMicrotasks;
          yield* Effect.yieldNow;
          assert.strictEqual(yield* Ref.get(deliveries), 1);

          const disconnects = harness.intersectionDisconnectCount();
          if (disconnects !== null) assert.strictEqual(disconnects, 1);
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("should deliver live mutations and stop exactly at scope close", () =>
      Effect.gen(function* () {
        // Test: should deliver live mutations and stop exactly at scope close through every Observer adapter.
        // Scope: exercises native callback delivery for browser and the controlled trigger for test.
        // Assertion: one non-empty batch arrives, post-close mutations do not deliver, and native disconnect runs once.
        const mutationRecords = yield* makeMutationRecords;
        const harness = yield* setupObserverConformance(adapter);

        yield* Effect.gen(function* () {
          const observer = yield* Observer;
          const controls = yield* TestObserver;
          const scope = yield* Scope.make();
          const target = document.createElement("div");
          const deliveries = yield* Ref.make(0);
          const batchSize = yield* Ref.make(0);
          const firstDelivery = yield* Deferred.make<void>();
          yield* observer
            .mutation(target, { childList: true }, (mutations) =>
              Effect.gen(function* () {
                yield* Ref.update(deliveries, (count) => count + 1);
                yield* Ref.set(batchSize, mutations.length);
                yield* Deferred.succeed(firstDelivery, undefined);
              }),
            )
            .pipe(Scope.provide(scope));

          yield* controls.triggerMutation(target, mutationRecords);
          yield* Deferred.await(firstDelivery);
          assert.strictEqual(yield* Ref.get(deliveries), 1);
          assert.isAbove(yield* Ref.get(batchSize), 0);

          yield* Scope.close(scope, Exit.void);
          yield* controls.triggerMutation(target, mutationRecords);
          yield* controls.drain;
          yield* flushHostMicrotasks;
          yield* Effect.yieldNow;
          assert.strictEqual(yield* Ref.get(deliveries), 1);

          const disconnects = harness.mutationDisconnectCount();
          if (disconnects !== null) assert.strictEqual(disconnects, 1);
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("should isolate overlapping intersection owners on one target", () =>
      Effect.gen(function* () {
        // Test: should deliver one callback per overlapping owner on the same intersection target.
        // Scope: compares independent native observers with controlled registrations and owner cleanup.
        // Assertion: both owners receive the first event, closing one preserves the other, and each native observer disconnects once.
        const harness = yield* setupObserverConformance(adapter);

        yield* Effect.gen(function* () {
          const observer = yield* Observer;
          const controls = yield* TestObserver;
          const firstScope = yield* Scope.make();
          const secondScope = yield* Scope.make();
          const target = document.createElement("div");
          const firstCount = yield* Ref.make(0);
          const secondCount = yield* Ref.make(0);
          const firstDelivery = yield* Deferred.make<void>();
          const secondDelivery = yield* Deferred.make<void>();
          const survivingDelivery = yield* Deferred.make<void>();

          const first = yield* observer
            .intersection({
              onIntersect: () =>
                Effect.gen(function* () {
                  yield* Ref.update(firstCount, (count) => count + 1);
                  yield* Deferred.succeed(firstDelivery, undefined);
                }),
            })
            .pipe(Scope.provide(firstScope));
          const second = yield* observer
            .intersection({
              onIntersect: () =>
                Effect.gen(function* () {
                  const count = yield* Ref.updateAndGet(secondCount, (current) => current + 1);
                  yield* Deferred.succeed(secondDelivery, undefined);
                  if (count === 2) yield* Deferred.succeed(survivingDelivery, undefined);
                }),
            })
            .pipe(Scope.provide(secondScope));

          yield* first.observe(target);
          yield* second.observe(target);
          yield* controls.triggerIntersection(target);
          yield* Deferred.await(firstDelivery);
          yield* Deferred.await(secondDelivery);
          assert.deepStrictEqual([yield* Ref.get(firstCount), yield* Ref.get(secondCount)], [1, 1]);

          yield* Scope.close(firstScope, Exit.void);
          yield* controls.triggerIntersection(target);
          yield* Deferred.await(survivingDelivery);
          assert.deepStrictEqual([yield* Ref.get(firstCount), yield* Ref.get(secondCount)], [1, 2]);

          yield* Scope.close(secondScope, Exit.void);
          yield* controls.triggerIntersection(target);
          yield* controls.drain;
          yield* flushHostMicrotasks;
          yield* Effect.yieldNow;
          assert.deepStrictEqual([yield* Ref.get(firstCount), yield* Ref.get(secondCount)], [1, 2]);

          const disconnects = harness.intersectionDisconnectCount();
          if (disconnects !== null) assert.strictEqual(disconnects, 2);
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    it.effect("should isolate overlapping mutation owners on one target", () =>
      Effect.gen(function* () {
        // Test: should deliver one callback per overlapping owner on the same mutation target.
        // Scope: compares independent native observers with controlled registrations and owner cleanup.
        // Assertion: both owners receive the first batch, closing one preserves the other, and each native observer disconnects once.
        const mutationRecords = yield* makeMutationRecords;
        const harness = yield* setupObserverConformance(adapter);

        yield* Effect.gen(function* () {
          const observer = yield* Observer;
          const controls = yield* TestObserver;
          const firstScope = yield* Scope.make();
          const secondScope = yield* Scope.make();
          const target = document.createElement("div");
          const firstCount = yield* Ref.make(0);
          const secondCount = yield* Ref.make(0);
          const firstDelivery = yield* Deferred.make<void>();
          const secondDelivery = yield* Deferred.make<void>();
          const survivingDelivery = yield* Deferred.make<void>();

          yield* observer
            .mutation(target, { childList: true }, () =>
              Effect.gen(function* () {
                yield* Ref.update(firstCount, (count) => count + 1);
                yield* Deferred.succeed(firstDelivery, undefined);
              }),
            )
            .pipe(Scope.provide(firstScope));
          yield* observer
            .mutation(target, { childList: true }, () =>
              Effect.gen(function* () {
                const count = yield* Ref.updateAndGet(secondCount, (current) => current + 1);
                yield* Deferred.succeed(secondDelivery, undefined);
                if (count === 2) yield* Deferred.succeed(survivingDelivery, undefined);
              }),
            )
            .pipe(Scope.provide(secondScope));

          yield* controls.triggerMutation(target, mutationRecords);
          yield* Deferred.await(firstDelivery);
          yield* Deferred.await(secondDelivery);
          assert.deepStrictEqual([yield* Ref.get(firstCount), yield* Ref.get(secondCount)], [1, 1]);

          yield* Scope.close(firstScope, Exit.void);
          yield* controls.triggerMutation(target, mutationRecords);
          yield* Deferred.await(survivingDelivery);
          assert.deepStrictEqual([yield* Ref.get(firstCount), yield* Ref.get(secondCount)], [1, 2]);

          yield* Scope.close(secondScope, Exit.void);
          yield* controls.triggerMutation(target, mutationRecords);
          yield* controls.drain;
          yield* flushHostMicrotasks;
          yield* Effect.yieldNow;
          assert.deepStrictEqual([yield* Ref.get(firstCount), yield* Ref.get(secondCount)], [1, 2]);

          const disconnects = harness.mutationDisconnectCount();
          if (disconnects !== null) assert.strictEqual(disconnects, 2);
        }).pipe(Effect.provide(harness.layer));
      }),
    );

    for (const kind of observerKinds) {
      it.effect(`should preserve the configured Scheduler in an ${kind} callback`, () =>
        Effect.gen(function* () {
          // Scope: callback context must agree between native and controlled observers.
          // Assertion: each handler observes the original Scheduler after scoped admission.
          const harness = yield* setupObserverConformance(adapter);
          yield* Effect.gen(function* () {
            const observers = yield* Observer;
            const controls = yield* TestObserver;
            const target = document.createElement("div");
            const scheduler = new Scheduler.MixedScheduler("async");
            const observed = yield* Deferred.make<Scheduler.Scheduler>();
            const handler = () =>
              Effect.flatMap(Scheduler.Scheduler, (value) => Deferred.succeed(observed, value));
            if (kind === "intersection") {
              const handle = yield* observers
                .intersection({ onIntersect: handler })
                .pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
              yield* handle.observe(target);
              yield* controls.triggerIntersection(target);
            } else {
              yield* observers
                .mutation(target, { childList: true }, handler)
                .pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
              yield* controls.triggerMutation(target, []);
            }
            assert.strictEqual(yield* Deferred.await(observed), scheduler);
          }).pipe(Effect.provide(harness.layer));
        }),
      );

      it.effect(`should supervise active ${kind} fail, die, and owner interruption`, () =>
        Effect.gen(function* () {
          // Test: should report callback failure and defect while treating owner interruption as cleanup.
          // Scope: runs the same active-handler Cause matrix through controlled and native delivery.
          // Assertion: triggers stay successful, fail/die report once each, and close interruption is silent.
          const mutationRecords = yield* makeMutationRecords;
          const harness = yield* setupObserverConformance(adapter);
          const messages: Array<unknown> = [];
          const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
            if (logLevel === "Error") messages.push(message);
          });

          yield* Effect.gen(function* () {
            const observer = yield* Observer;
            const controls = yield* TestObserver;
            const scope = yield* Scope.make();
            const target = document.createElement("div");
            const deliveryCount = yield* Ref.make(0);
            const interrupted = yield* Ref.make(false);
            const activeStarted = yield* Deferred.make<void>();
            const typedFailure = new Error(`${kind} typed failure`);
            const defect = new Error(`${kind} defect`);

            const handler = Effect.fnUntraced(function* () {
              const delivery = yield* Ref.updateAndGet(deliveryCount, (count) => count + 1);
              if (delivery === 1) return yield* Effect.fail(typedFailure);
              // oxlint-disable-next-line effect/no-effect-escape-hatch -- The callback deliberately defects to verify supervision.
              if (delivery === 2) return yield* Effect.die(defect);
              yield* Deferred.succeed(activeStarted, undefined);
              return yield* Effect.never.pipe(Effect.onInterrupt(() => Ref.set(interrupted, true)));
            });
            const hostileHandler = handler as unknown as () => Effect.Effect<void>;

            if (kind === "intersection") {
              const handle = yield* observer
                .intersection({ onIntersect: hostileHandler })
                .pipe(Scope.provide(scope));
              yield* handle.observe(target);
            } else {
              yield* observer
                .mutation(target, { childList: true }, hostileHandler)
                .pipe(Scope.provide(scope));
            }

            const trigger =
              kind === "intersection"
                ? controls.triggerIntersection(target)
                : controls.triggerMutation(target, mutationRecords);

            assert.isTrue(Exit.isSuccess(yield* Effect.exit(trigger)));
            yield* controls.drain;
            assert.strictEqual(messages.length, 1);

            assert.isTrue(Exit.isSuccess(yield* Effect.exit(trigger)));
            yield* controls.drain;
            assert.strictEqual(messages.length, 2);

            assert.isTrue(Exit.isSuccess(yield* Effect.exit(trigger)));
            yield* Deferred.await(activeStarted);
            yield* Scope.close(scope, Exit.void);
            assert.isTrue(yield* Ref.get(interrupted));
            yield* controls.drain;
            assert.strictEqual(messages.length, 2);
          }).pipe(Effect.provide(Layer.merge(harness.layer, Logger.layer([logger]))));
        }),
      );

      it.effect(`should contain a ${kind} callback construction throw and report it once`, () =>
        Effect.gen(function* () {
          // Scope: the production observer bridge receives a thunk that throws before returning Effect.
          // Assertion: host delivery succeeds, one defect is reported, and no throw escapes the callback.
          const harness = yield* setupObserverConformance(adapter);
          const messages: Array<unknown> = [];
          const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
            if (logLevel === "Error") messages.push(message);
          });
          yield* Effect.gen(function* () {
            const observer = yield* Observer;
            const controls = yield* TestObserver;
            const target = document.createElement("div");
            const handler = () => {
              throw new Error(`${kind} constructor defect`);
            };
            if (kind === "intersection") {
              const handle = yield* observer.intersection({ onIntersect: handler });
              yield* handle.observe(target);
            } else {
              yield* observer.mutation(target, { childList: true }, handler);
            }
            const trigger =
              kind === "intersection"
                ? controls.triggerIntersection(target)
                : controls.triggerMutation(target, []);
            assert.isTrue(Exit.isSuccess(yield* Effect.exit(trigger)));
            yield* controls.drain;
            assert.strictEqual(messages.length, 1);
          }).pipe(Effect.provide(Layer.merge(harness.layer, Logger.layer([logger]))));
        }),
      );

      it.effect(`should interrupt and await active ${kind} handlers on close`, () =>
        Effect.gen(function* () {
          // Test: should keep close pending until an interrupted handler finishes its own cleanup.
          // Scope: compares registration-scope ownership for active controlled and native handlers.
          // Assertion: interruption starts, close remains pending, and close completes only after release.
          const mutationRecords = yield* makeMutationRecords;
          const harness = yield* setupObserverConformance(adapter);

          yield* Effect.gen(function* () {
            const observer = yield* Observer;
            const controls = yield* TestObserver;
            const scope = yield* Scope.make();
            const target = document.createElement("div");
            const started = yield* Deferred.make<void>();
            const finalizerStarted = yield* Deferred.make<void>();
            const allowFinalizer = yield* Deferred.make<void>();
            const interrupted = yield* Ref.make(false);
            const closeCompleted = yield* Ref.make(false);

            const handler = () =>
              Effect.scoped(
                Effect.gen(function* () {
                  yield* Effect.addFinalizer(() =>
                    Effect.gen(function* () {
                      yield* Deferred.succeed(finalizerStarted, undefined);
                      yield* Deferred.await(allowFinalizer);
                    }),
                  );
                  yield* Deferred.succeed(started, undefined);
                  return yield* Effect.never;
                }),
              ).pipe(Effect.onInterrupt(() => Ref.set(interrupted, true)));

            if (kind === "intersection") {
              const handle = yield* observer
                .intersection({ onIntersect: handler })
                .pipe(Scope.provide(scope));
              yield* handle.observe(target);
            } else {
              yield* observer
                .mutation(target, { childList: true }, handler)
                .pipe(Scope.provide(scope));
            }

            yield* kind === "intersection"
              ? controls.triggerIntersection(target)
              : controls.triggerMutation(target, mutationRecords);
            yield* Deferred.await(started);

            const closing = yield* Scope.close(scope, Exit.void).pipe(
              Effect.ensuring(Ref.set(closeCompleted, true)),
              Effect.forkChild,
            );
            yield* Deferred.await(finalizerStarted);
            assert.isFalse(yield* Ref.get(closeCompleted));

            yield* Deferred.succeed(allowFinalizer, undefined);
            yield* Fiber.join(closing);
            assert.isTrue(yield* Ref.get(interrupted));
            assert.isTrue(yield* Ref.get(closeCompleted));
          }).pipe(Effect.provide(harness.layer));
        }),
      );
    }
  });
}

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
      yield* testObs.drain;

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
      yield* testObs.drain;

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
      yield* testObs.drain;
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
      yield* testObs.drain;

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
      yield* testObs.drain;
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
      yield* testObs.drain;

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
      yield* testObs.drain;

      assert.deepStrictEqual(received, []);
    }).pipe(Effect.provide(observerTest)),
  );
});

describe("TestObserver", () => {
  it.effect("trigger should admit work without joining it while drain awaits completion", () =>
    Effect.gen(function* () {
      // Test: should separate controlled delivery admission from deterministic handler draining.
      // Scope: prevents callback ownership from being transferred to the trigger fiber.
      // Assertion: trigger returns while work is blocked, drain waits, then settles after release.
      const observer = yield* Observer;
      const controls = yield* TestObserver;
      const scope = yield* Scope.make();
      const target = document.createElement("div");
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const triggerReturned = yield* Ref.make(false);
      const drainCompleted = yield* Ref.make(false);

      const handle = yield* observer
        .intersection({
          onIntersect: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
            }),
        })
        .pipe(Scope.provide(scope));
      yield* handle.observe(target);

      const triggering = yield* controls
        .triggerIntersection(target)
        .pipe(Effect.ensuring(Ref.set(triggerReturned, true)), Effect.forkChild);
      yield* Deferred.await(started);
      yield* Effect.yieldNow;
      assert.isTrue(yield* Ref.get(triggerReturned));
      yield* Fiber.join(triggering);

      const draining = yield* controls.drain.pipe(
        Effect.ensuring(Ref.set(drainCompleted, true)),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      assert.isFalse(yield* Ref.get(drainCompleted));

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(draining);
      assert.isTrue(yield* Ref.get(drainCompleted));
      yield* Scope.close(scope, Exit.void);
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

      yield* Effect.gen(function* () {
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
      }).pipe(Effect.provide(observerBrowser));
    }),
  );

  it.effect("queued native callbacks after close should drain and do zero work", () =>
    Effect.gen(function* () {
      // Test: should reject retained native callbacks after both registrations have closed.
      // Scope: reproduces queued IntersectionObserver and MutationObserver delivery after disconnect.
      // Assertion: release drains before disconnect and neither retained callback starts an Effect.
      const mutationRecords = yield* makeMutationRecords;
      const originalIntersectionObserver = globalThis.IntersectionObserver;
      const originalMutationObserver = globalThis.MutationObserver;
      const releaseOrder: Array<string> = [];
      let intersectionCallback: IntersectionObserverCallback | null = null;
      let mutationCallback: MutationCallback | null = null;
      let queuedIntersectionEntries: Array<IntersectionObserverEntry> = [];

      class RetainedIntersectionObserver implements IntersectionObserver {
        readonly root = null;
        readonly rootMargin = "0px";
        readonly scrollMargin = "0px";
        readonly thresholds = [0];

        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }

        disconnect(): void {
          releaseOrder.push("intersection.disconnect");
        }
        observe(_target: Element): void {}
        takeRecords(): Array<IntersectionObserverEntry> {
          releaseOrder.push("intersection.takeRecords");
          return queuedIntersectionEntries;
        }
        unobserve(_target: Element): void {}
      }

      class RetainedMutationObserver implements MutationObserver {
        constructor(callback: MutationCallback) {
          mutationCallback = callback;
        }

        disconnect(): void {
          releaseOrder.push("mutation.disconnect");
        }
        observe(_target: Node, _options?: MutationObserverInit): void {}
        takeRecords(): Array<MutationRecord> {
          releaseOrder.push("mutation.takeRecords");
          return mutationRecords;
        }
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.IntersectionObserver = originalIntersectionObserver;
          globalThis.MutationObserver = originalMutationObserver;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.IntersectionObserver = RetainedIntersectionObserver;
        globalThis.MutationObserver = RetainedMutationObserver;
      });

      yield* Effect.gen(function* () {
        const observer = yield* Observer;
        const target = document.createElement("div");
        const intersectionScope = yield* Scope.make();
        const mutationScope = yield* Scope.make();
        let intersectionDeliveries = 0;
        let mutationDeliveries = 0;
        const rect = target.getBoundingClientRect();
        queuedIntersectionEntries = [
          {
            target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
            time: 0,
          },
        ];

        const handle = yield* observer
          .intersection({
            onIntersect: () =>
              Effect.sync(() => {
                intersectionDeliveries++;
              }),
          })
          .pipe(Scope.provide(intersectionScope));
        yield* handle.observe(target);
        yield* observer
          .mutation(target, { childList: true }, () =>
            Effect.sync(() => {
              mutationDeliveries++;
            }),
          )
          .pipe(Scope.provide(mutationScope));

        yield* Scope.close(intersectionScope, Exit.void);
        yield* Scope.close(mutationScope, Exit.void);
        assert.deepStrictEqual(releaseOrder, [
          "intersection.takeRecords",
          "intersection.disconnect",
          "mutation.takeRecords",
          "mutation.disconnect",
        ]);

        yield* Effect.sync(() => {
          if (intersectionCallback !== null) {
            const retainedCallback = intersectionCallback;
            retainedCallback(
              queuedIntersectionEntries,
              new RetainedIntersectionObserver(() => undefined),
            );
          }
          if (mutationCallback !== null) {
            const retainedCallback = mutationCallback;
            retainedCallback(mutationRecords, new RetainedMutationObserver(() => undefined));
          }
        });
        yield* Effect.yieldNow;

        assert.strictEqual(intersectionDeliveries, 0);
        assert.strictEqual(mutationDeliveries, 0);
      }).pipe(Effect.provide(observerBrowser));
    }),
  );

  it.effect("layer acquisition fails while a required observer API is unavailable", () =>
    Effect.gen(function* () {
      // Test: should fail layer acquisition while a required observer API is unavailable.
      // Scope: covers browser capability readiness before publishing Observer.
      // Assertion: acquisition fails with ObserverError operation initialize.
      const OriginalIntersectionObserver = globalThis.IntersectionObserver;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.IntersectionObserver = OriginalIntersectionObserver;
        }),
      );
      yield* Effect.sync(() => {
        Object.defineProperty(globalThis, "IntersectionObserver", {
          configurable: true,
          writable: true,
          value: undefined,
        });
      });

      const exit = yield* Effect.exit(Observer.pipe(Effect.provide(observerBrowser)));
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
        assert.instanceOf(error, ObserverError);
        assert.strictEqual(error?.operation, "initialize");
      }
    }),
  );

  it.effect("intersection constructor throws fail with typed operation", () =>
    Effect.gen(function* () {
      // Test: should translate IntersectionObserver constructor throws into ObserverError.
      // Scope: covers native resource construction after browser capability readiness succeeds.
      // Assertion: intersection fails with operation intersection.create and preserves the cause.
      const OriginalIntersectionObserver = globalThis.IntersectionObserver;
      const failure = new Error("constructor failed");

      class ThrowingIntersectionObserver implements IntersectionObserver {
        readonly root = null;
        readonly rootMargin = "0px";
        readonly scrollMargin = "0px";
        readonly thresholds = [0];
        constructor() {
          throw failure;
        }
        disconnect(): void {}
        observe(): void {}
        takeRecords(): Array<IntersectionObserverEntry> {
          return [];
        }
        unobserve(): void {}
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.IntersectionObserver = OriginalIntersectionObserver;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.IntersectionObserver = ThrowingIntersectionObserver;
      });

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const observer = yield* Observer;
          yield* observer.intersection({ onIntersect: () => Effect.void });
        }).pipe(Effect.provide(observerBrowser)),
      );
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
        assert.instanceOf(error, ObserverError);
        assert.strictEqual(error?.operation, "intersection.create");
        assert.strictEqual(error?.cause, failure);
      }
    }),
  );

  it.effect("intersection observe throws fail with typed operation", () =>
    Effect.gen(function* () {
      // Test: should translate IntersectionObserver.observe throws into ObserverError.
      // Scope: covers normal handle use after successful scoped acquisition.
      // Assertion: observe fails with the precise operation and disconnect still runs once.
      const OriginalIntersectionObserver = globalThis.IntersectionObserver;
      const failure = new Error("observe failed");
      let disconnects = 0;

      class ThrowingIntersectionObserver implements IntersectionObserver {
        readonly root = null;
        readonly rootMargin = "0px";
        readonly scrollMargin = "0px";
        readonly thresholds = [0];
        disconnect(): void {
          disconnects++;
        }
        observe(): void {
          throw failure;
        }
        takeRecords(): Array<IntersectionObserverEntry> {
          return [];
        }
        unobserve(): void {}
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.IntersectionObserver = OriginalIntersectionObserver;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.IntersectionObserver = ThrowingIntersectionObserver;
      });

      yield* Effect.gen(function* () {
        const observer = yield* Observer;
        const scope = yield* Scope.make();
        const handle = yield* observer
          .intersection({ onIntersect: () => Effect.void })
          .pipe(Scope.provide(scope));
        const exit = yield* Effect.exit(handle.observe(document.createElement("div")));
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
          assert.instanceOf(error, ObserverError);
          assert.strictEqual(error?.operation, "intersection.observe");
          assert.strictEqual(error?.cause, failure);
        }
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.provide(observerBrowser));

      assert.strictEqual(disconnects, 1);
    }),
  );

  it.effect("intersection unobserve throws fail with typed operation", () =>
    Effect.gen(function* () {
      // Test: should translate IntersectionObserver.unobserve throws into ObserverError.
      // Scope: covers the second normal operation exposed by IntersectionHandle.
      // Assertion: unobserve preserves the native cause and scoped disconnect still runs once.
      const OriginalIntersectionObserver = globalThis.IntersectionObserver;
      const failure = new Error("unobserve failed");
      let disconnects = 0;

      class ThrowingIntersectionObserver implements IntersectionObserver {
        readonly root = null;
        readonly rootMargin = "0px";
        readonly scrollMargin = "0px";
        readonly thresholds = [0];
        disconnect(): void {
          disconnects++;
        }
        observe(): void {}
        takeRecords(): Array<IntersectionObserverEntry> {
          return [];
        }
        unobserve(): void {
          throw failure;
        }
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.IntersectionObserver = OriginalIntersectionObserver;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.IntersectionObserver = ThrowingIntersectionObserver;
      });

      yield* Effect.gen(function* () {
        const observer = yield* Observer;
        const scope = yield* Scope.make();
        const handle = yield* observer
          .intersection({ onIntersect: () => Effect.void })
          .pipe(Scope.provide(scope));
        const exit = yield* Effect.exit(handle.unobserve(document.createElement("div")));
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
          assert.instanceOf(error, ObserverError);
          assert.strictEqual(error?.operation, "intersection.unobserve");
          assert.strictEqual(error?.cause, failure);
        }
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.provide(observerBrowser));

      assert.strictEqual(disconnects, 1);
    }),
  );

  it.effect("mutation constructor throws fail with typed operation", () =>
    Effect.gen(function* () {
      // Test: should translate MutationObserver constructor throws into ObserverError.
      // Scope: covers native mutation resource acquisition before observe is attempted.
      // Assertion: mutation fails with operation mutation.create and preserves the cause.
      const OriginalMutationObserver = globalThis.MutationObserver;
      const failure = new Error("mutation constructor failed");

      class ThrowingMutationObserver implements MutationObserver {
        constructor() {
          throw failure;
        }
        disconnect(): void {}
        observe(): void {}
        takeRecords(): Array<MutationRecord> {
          return [];
        }
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.MutationObserver = OriginalMutationObserver;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.MutationObserver = ThrowingMutationObserver;
      });

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const observer = yield* Observer;
          yield* observer.mutation(document.body, { childList: true }, () => Effect.void);
        }).pipe(Effect.provide(observerBrowser)),
      );
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
        assert.instanceOf(error, ObserverError);
        assert.strictEqual(error?.operation, "mutation.create");
        assert.strictEqual(error?.cause, failure);
      }
    }),
  );

  it.effect("mutation observe failure retains bracketed disconnect ownership", () =>
    Effect.gen(function* () {
      // Test: should retain disconnect ownership while MutationObserver.observe fails.
      // Scope: regression coverage for the former observe-before-finalizer interruption window.
      // Assertion: mutation fails with a typed operation and closing the scope disconnects exactly once.
      const OriginalMutationObserver = globalThis.MutationObserver;
      const failure = new Error("mutation observe failed");
      let disconnects = 0;

      class ThrowingMutationObserver implements MutationObserver {
        disconnect(): void {
          disconnects++;
        }
        observe(): void {
          throw failure;
        }
        takeRecords(): Array<MutationRecord> {
          return [];
        }
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.MutationObserver = OriginalMutationObserver;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.MutationObserver = ThrowingMutationObserver;
      });

      yield* Effect.gen(function* () {
        const observer = yield* Observer;
        const scope = yield* Scope.make();
        const exit = yield* Effect.exit(
          observer
            .mutation(document.body, { childList: true }, () => Effect.void)
            .pipe(Scope.provide(scope)),
        );
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
          assert.instanceOf(error, ObserverError);
          assert.strictEqual(error?.operation, "mutation.observe");
          assert.strictEqual(error?.cause, failure);
        }
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.provide(observerBrowser));

      assert.strictEqual(disconnects, 1);
    }),
  );

  it.effect("callback throws are supervised and every release step is attempted", () =>
    Effect.gen(function* () {
      // Test: should supervise callback throws and attempt disconnect after takeRecords throws.
      // Scope: covers callback ownership and infallible native release in one observer lifecycle.
      // Assertion: no throw escapes, both release failures report, and disconnect still runs once.
      const OriginalIntersectionObserver = globalThis.IntersectionObserver;
      let callback: IntersectionObserverCallback | undefined;
      let disconnects = 0;
      const messages: Array<unknown> = [];
      const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
        if (logLevel === "Error") messages.push(message);
      });

      class HostileIntersectionObserver implements IntersectionObserver {
        readonly root = null;
        readonly rootMargin = "0px";
        readonly scrollMargin = "0px";
        readonly thresholds = [0];
        constructor(current: IntersectionObserverCallback) {
          callback = current;
        }
        disconnect(): void {
          disconnects++;
          throw new Error("disconnect failed");
        }
        observe(): void {}
        takeRecords(): Array<IntersectionObserverEntry> {
          throw new Error("takeRecords failed");
        }
        unobserve(): void {}
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          globalThis.IntersectionObserver = OriginalIntersectionObserver;
        }),
      );
      yield* Effect.sync(() => {
        globalThis.IntersectionObserver = HostileIntersectionObserver;
      });

      yield* Effect.gen(function* () {
        const observer = yield* Observer;
        const scope = yield* Scope.make();
        const element = document.createElement("div");
        const handle = yield* observer
          .intersection({
            onIntersect: () => {
              throw new Error("callback failed");
            },
          })
          .pipe(Scope.provide(scope));
        yield* handle.observe(element);

        const callbackExit = yield* Effect.exit(
          Effect.sync(() =>
            callback?.(
              [
                {
                  target: element,
                  isIntersecting: true,
                  intersectionRatio: 1,
                  boundingClientRect: element.getBoundingClientRect(),
                  intersectionRect: element.getBoundingClientRect(),
                  rootBounds: null,
                  time: 0,
                },
              ],
              new HostileIntersectionObserver(() => undefined),
            ),
          ),
        );
        assert.isTrue(Exit.isSuccess(callbackExit));
        yield* Effect.yieldNow;
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.provide(Layer.merge(observerBrowser, Logger.layer([logger]))));

      assert.strictEqual(disconnects, 1);
      assert.strictEqual(messages.length, 3);
    }),
  );
});
