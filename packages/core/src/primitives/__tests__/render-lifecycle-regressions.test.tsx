import { assert, describe } from "@effect/vitest";
import { Cause, Context, Deferred, Effect, Exit, Layer, Predicate, Scope } from "effect";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { click, render } from "../../testing/index.js";
import * as Component from "../component.js";
import * as ErrorBoundary from "../error-boundary.js";
import * as Signal from "../signal.js";

class Flavor extends Context.Service<Flavor, { readonly value: string }>()(
  "render-lifecycle-regressions/Flavor",
) {}

describe("render lifecycle regressions", () => {
  scoped("should retain a removed subtree's provider until its handler cleanup finishes", () =>
    Effect.gen(function* () {
      // Scope: remove a provided Component while its DOM handler is suspended.
      // Assertion: handler interruption and awaited cleanup precede provider release; the root stays live.
      const visible = yield* Signal.make(true);
      const handlerStarted = yield* Deferred.make<void>();
      const cleanupStarted = yield* Deferred.make<void>();
      const releaseCleanup = yield* Deferred.make<void>();
      const providerReleased = yield* Deferred.make<void>();
      const events: Array<string> = [];
      const localLayer = Layer.effect(
        Flavor,
        Effect.acquireRelease(Effect.succeed({ value: "local" }), () =>
          Effect.sync(() => {
            events.push("provider-release");
          }).pipe(Effect.andThen(Deferred.succeed(providerReleased, undefined))),
        ),
      );
      const Local = Component.gen(function* () {
        yield* Flavor;
        return (
          <button
            data-testid="owned-handler"
            onClick={() =>
              Deferred.succeed(handlerStarted, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() =>
                  Effect.gen(function* () {
                    const flavor = yield* Flavor;
                    events.push(`handler-cleanup:${flavor.value}`);
                    yield* Deferred.succeed(cleanupStarted, undefined);
                    yield* Deferred.await(releaseCleanup);
                    events.push("handler-released");
                  }),
                ),
              )
            }
          >
            local
          </button>
        );
      }).pipe(Component.provide(localLayer));
      const child = yield* Signal.derive(visible, (show) =>
        show ? <Local /> : <span>removed</span>,
      );
      const { getByTestId, container } = yield* render(<div data-testid="root">{child}</div>);
      yield* click(yield* getByTestId("owned-handler"));
      yield* Deferred.await(handlerStarted);
      yield* Signal.set(visible, false);
      yield* Deferred.await(cleanupStarted);
      const releasedEarly = yield* Deferred.isDone(providerReleased);
      yield* Deferred.succeed(releaseCleanup, undefined);
      yield* Deferred.await(providerReleased);
      assert.isFalse(releasedEarly);
      assert.deepStrictEqual(events, [
        "handler-cleanup:local",
        "handler-released",
        "provider-release",
      ]);
      assert.isNotNull(container.querySelector('[data-testid="root"]'));
      assert.isNull(container.querySelector('[data-testid="owned-handler"]'));
    }),
  );

  scoped("should release completed event fibers without accumulating owner finalizers", () =>
    Effect.gen(function* () {
      // Scope: the actual event handler owner remains live across 1,001 completed DOM events.
      // Assertion: every handler completes and both callback-owner and root finalizer counts stay bounded.
      const ownerSeen = yield* Deferred.make<Scope.Scope>();
      const root = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      let completed = 0;
      const Handler = Component.gen(function* () {
        return (
          <button
            data-testid="repeated-handler"
            onClick={() =>
              Effect.gen(function* () {
                yield* Deferred.succeed(ownerSeen, yield* Effect.scope);
                completed++;
              })
            }
          >
            click
          </button>
        );
      });
      const { getByTestId } = yield* render(<Handler />).pipe(Scope.provide(root));
      const button = yield* getByTestId("repeated-handler");
      yield* click(button);
      const owner = yield* Deferred.await(ownerSeen);
      const retained = (scope: Scope.Scope) => {
        const state = scope.state;
        assert.notStrictEqual(state._tag, "Closed");
        return Predicate.isTagged(state, "Open")
          ? (state.finalizer === undefined ? 0 : 1) + (state.finalizers?.size ?? 0)
          : 0;
      };
      const initialOwner = retained(owner);
      const initialRoot = retained(root);
      for (let index = 0; index < 1_000; index++) yield* click(button);
      assert.strictEqual(completed, 1_001);
      assert.strictEqual(retained(owner), initialOwner);
      assert.strictEqual(retained(root), initialRoot);
    }),
  );

  scoped("should interrupt a blocked rerender when its component unmounts", () =>
    Effect.gen(function* () {
      // Scope: covers ownership of a rerender fiber that is suspended during teardown.
      // Assertion: unmount interrupts the fiber and releasing its gate cannot resurrect DOM.
      const mountScope = yield* Scope.make();
      const trigger = yield* Signal.make(false);
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      let interrupted = false;

      const Blocking = Component.gen(function* () {
        if (yield* Signal.get(trigger)) {
          yield* Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(gate);
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
          );
          return <div data-testid="resurrected">late</div>;
        }
        return <div data-testid="stable">stable</div>;
      });

      const { container } = yield* render(<Blocking />).pipe(Scope.provide(mountScope));
      yield* Signal.set(trigger, true);
      yield* Deferred.await(started);

      yield* Scope.close(mountScope, Exit.void);
      yield* Deferred.succeed(gate, undefined);
      yield* Effect.yieldNow;

      assert.isTrue(interrupted);
      assert.isNull(container.querySelector('[data-testid="stable"]'));
      assert.isNull(container.querySelector('[data-testid="resurrected"]'));
    }),
  );

  scoped("should keep the nearest provider for body handler rerender and cleanup", () =>
    Effect.gen(function* () {
      // Scope: covers lexical service precedence across every delayed component phase.
      // Assertion: local identity wins while a root sibling remains isolated on the root service.
      const mountScope = yield* Scope.make();
      const rerender = yield* Signal.make(0);
      const observed: Array<string> = [];
      const localLayer = Layer.effect(
        Flavor,
        Effect.acquireRelease(Effect.succeed({ value: "local" }), (flavor) =>
          Effect.sync(() => {
            observed.push(`cleanup:${flavor.value}`);
          }),
        ),
      );

      const Local = Component.gen(function* () {
        const flavor = yield* Flavor;
        const value = yield* Signal.get(rerender);
        observed.push(`body:${flavor.value}:${value}`);
        return (
          <button
            data-testid="local-handler"
            onClick={() =>
              Effect.gen(function* () {
                const handlerFlavor = yield* Flavor;
                observed.push(`handler:${handlerFlavor.value}`);
              })
            }
          >
            local
          </button>
        );
      }).pipe(Component.provide(localLayer));

      const RootSibling = Component.gen(function* () {
        const flavor = yield* Flavor;
        observed.push(`sibling:${flavor.value}`);
        return <span>root</span>;
      });

      const { getByTestId } = yield* render(
        <div>
          <Local />
          <RootSibling />
        </div>,
      ).pipe(Scope.provide(mountScope), Effect.provideService(Flavor, { value: "root" }));

      yield* click(yield* getByTestId("local-handler"));
      yield* Signal.set(rerender, 1);
      yield* TestClock.adjust(0);
      yield* Scope.close(mountScope, Exit.void);

      assert.include(observed, "body:local:0");
      assert.include(observed, "handler:local");
      assert.include(observed, "body:local:1");
      assert.include(observed, "cleanup:local");
      assert.include(observed, "sibling:root");
      assert.notInclude(observed, "handler:root");
      assert.notInclude(observed, "body:root:1");
    }),
  );

  scoped("should contain a synchronously thrown event handler and report it once", () =>
    Effect.gen(function* () {
      // Scope: covers the native DOM callback to Effect runtime boundary.
      // Assertion: the throw does not escape click or window.error and reaches one terminal report.
      // oxlint-disable-next-line effect/no-built-in-error-constructor -- The test needs a native callback defect with stable identity.
      const defect = new Error("event-handler-defect");
      const originalConsoleError = console.error;
      let reports = 0;
      let windowErrors = 0;
      const onWindowError = () => {
        windowErrors++;
      };
      console.error = (...values: ReadonlyArray<unknown>) => {
        if (values.some((value) => String(value).includes("event-handler-defect"))) reports++;
      };
      window.addEventListener("error", onWindowError);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          console.error = originalConsoleError;
          window.removeEventListener("error", onWindowError);
        }),
      );

      const { getByTestId } = yield* render(
        <button
          data-testid="throwing-handler"
          onClick={() => {
            // oxlint-disable-next-line effect/no-raw-throw -- Verifies containment of a synchronous DOM callback throw.
            throw defect;
          }}
        >
          throw
        </button>,
      );
      const clickExit = yield* Effect.exit(click(yield* getByTestId("throwing-handler")));
      yield* Effect.yieldNow;

      assert.isTrue(Exit.isSuccess(clickExit));
      assert.strictEqual(windowErrors, 0);
      assert.strictEqual(reports, 1);
    }),
  );

  scoped("should not render an ErrorBoundary fallback for interruption", () =>
    Effect.gen(function* () {
      // Scope: covers Cause classification at the initial boundary render.
      // Assertion: interruption remains the render Exit and closes child resources with that Exit.
      let fallbackRendered = false;
      let finalizerExit: Exit.Exit<unknown, unknown> | null = null;
      const Interrupted = Component.gen(function* () {
        yield* Effect.addFinalizer((exit) =>
          Effect.sync(() => {
            finalizerExit = exit;
          }),
        );
        return yield* Effect.interrupt;
      });
      const Fallback = Component.gen(function* (
        Props: Component.ComponentProps<{ readonly cause: Cause.Cause<unknown> }>,
      ) {
        yield* Props;
        fallbackRendered = true;
        return <div>fallback</div>;
      });
      const Safe = yield* ErrorBoundary.catch(Interrupted).pipe(ErrorBoundary.catchAll(Fallback));

      const exit = yield* Effect.exit(render(<Safe />));

      assert.isTrue(Exit.hasInterrupts(exit));
      assert.isFalse(fallbackRendered);
      assert.isNotNull(finalizerExit);
      if (finalizerExit !== null) assert.isTrue(Exit.hasInterrupts(finalizerExit));
    }),
  );

  scoped("should not render an ErrorBoundary fallback for a defect", () =>
    Effect.gen(function* () {
      // Scope: covers defects at the same boundary where typed failures are recoverable.
      // Assertion: a Die Cause remains a defect and never executes fallback construction.
      let fallbackRendered = false;
      const Defective = Component.gen(function* () {
        // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately supplies the boundary Die case.
        return yield* Effect.die("boundary-defect");
      });
      const Fallback = Component.gen(function* (
        Props: Component.ComponentProps<{ readonly cause: Cause.Cause<unknown> }>,
      ) {
        yield* Props;
        fallbackRendered = true;
        return <div>fallback</div>;
      });
      const Safe = yield* ErrorBoundary.catch(Defective).pipe(ErrorBoundary.catchAll(Fallback));

      const exit = yield* Effect.exit(render(<Safe />));

      assert.isTrue(Exit.hasDies(exit));
      assert.isFalse(fallbackRendered);
      if (Exit.isFailure(exit)) assert.strictEqual(Cause.squash(exit.cause), "boundary-defect");
    }),
  );
});
