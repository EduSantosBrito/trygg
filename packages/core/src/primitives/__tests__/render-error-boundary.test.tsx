import { assert, describe } from "@effect/vitest";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Component from "../component.js";
import type { ComponentProps } from "../component.js";
import * as ErrorBoundary from "../error-boundary.js";
import * as Signal from "../signal.js";

class BoundaryError extends Schema.TaggedError<BoundaryError>()("BoundaryError", {
  detail: Schema.String,
}) {}

describe("render-error-boundary", () => {
  scoped("renders fallback for initial child failure", () =>
    Effect.gen(function* () {
      // Scope: typed initial render failure is recoverable, but its resource lifetime still failed.
      // Assertion: fallback renders and the failed child's finalizer receives that typed Cause.
      const failure = new BoundaryError({ detail: "boom" });
      const exits: Array<Exit.Exit<unknown, unknown>> = [];
      const Risky = Component.gen(function* () {
        yield* Effect.addFinalizer((exit) =>
          Effect.sync(() => {
            exits.push(exit);
          }),
        );
        return yield* failure;
      });

      const Fallback = Component.gen(function* (
        Props: ComponentProps<{ readonly cause: Cause.Cause<unknown> }>,
      ) {
        yield* Props;
        return <div data-testid="fallback">fallback</div>;
      });

      const Safe = yield* ErrorBoundary.catch(Risky).pipe(ErrorBoundary.catchAll(Fallback));
      const { getByTestId } = yield* render(<Safe />);

      assert.strictEqual((yield* getByTestId("fallback")).textContent, "fallback");
      assert.strictEqual(exits.length, 1);
      const [exit] = exits;
      assert.isDefined(exit);
      if (exit !== undefined) {
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit))
          assert.strictEqual(Option.getOrUndefined(Cause.findErrorOption(exit.cause)), failure);
      }
    }),
  );

  for (const [name, terminal] of [
    ["defect", Cause.die("mixed-boundary-defect")],
    ["interruption", Cause.interrupt(77)],
  ] satisfies ReadonlyArray<readonly [string, Cause.Cause<never>]>) {
    scoped(`should retain mixed ${name} in both render and finalizer Exits without fallback`, () =>
      Effect.gen(function* () {
        // Scope: an expected failure accompanies a terminal reason at the actual rendered boundary.
        // Assertion: the full classification survives; no fallback is constructed and cleanup sees failure.
        const failure = new BoundaryError({ detail: "mixed" });
        const cause = Cause.combine(Cause.fail(failure), terminal);
        const exits: Array<Exit.Exit<unknown, unknown>> = [];
        let fallbacks = 0;
        const Risky = Component.gen(function* () {
          yield* Effect.addFinalizer((exit) =>
            Effect.sync(() => {
              exits.push(exit);
            }),
          );
          return yield* Effect.failCause(cause);
        });
        const Fallback = Component.gen(function* (
          Props: ComponentProps<{ readonly cause: Cause.Cause<unknown> }>,
        ) {
          yield* Props;
          fallbacks++;
          return <span>unexpected fallback</span>;
        });
        const Safe = yield* ErrorBoundary.catch(Risky).pipe(ErrorBoundary.catchAll(Fallback));
        const rendered = yield* Effect.exit(render(<Safe />));
        assert.strictEqual(fallbacks, 0);
        assert.strictEqual(exits.length, 1);
        for (const exit of [rendered, ...exits]) {
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            assert.strictEqual(Option.getOrUndefined(Cause.findErrorOption(exit.cause)), failure);
            assert.strictEqual(Cause.hasDies(exit.cause), Cause.hasDies(terminal));
            assert.strictEqual(Cause.hasInterrupts(exit.cause), Cause.hasInterrupts(terminal));
          }
        }
      }),
    );
  }

  scoped("swaps to fallback for child update failure", () =>
    Effect.gen(function* () {
      const fail = yield* Signal.make(false);
      const Risky = Component.gen(function* () {
        if (yield* Signal.get(fail)) {
          return yield* new BoundaryError({ detail: "boom" });
        }
        return <div data-testid="stable">stable</div>;
      });

      const Fallback = Component.gen(function* (
        Props: ComponentProps<{ readonly cause: Cause.Cause<unknown> }>,
      ) {
        yield* Props;
        return <div data-testid="fallback">fallback</div>;
      });

      const Safe = yield* ErrorBoundary.catch(Risky).pipe(ErrorBoundary.catchAll(Fallback));
      const { getByTestId } = yield* render(<Safe />);

      assert.strictEqual((yield* getByTestId("stable")).textContent, "stable");
      yield* Signal.set(fail, true);
      yield* TestClock.adjust(20);
      assert.strictEqual((yield* getByTestId("fallback")).textContent, "fallback");
    }),
  );
});
