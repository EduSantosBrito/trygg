import { assert, describe } from "@effect/vitest";
import { Cause, Data, Effect } from "effect";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Component from "../component.js";
import type { ComponentProps } from "../component.js";
import * as ErrorBoundary from "../error-boundary.js";
import * as Signal from "../signal.js";

class BoundaryError extends Data.TaggedError("BoundaryError")<{ readonly message: string }> {}

describe("render-error-boundary", () => {
  scoped("renders fallback for initial child failure", () =>
    Effect.gen(function* () {
      const Risky = Component.gen(function* () {
        return yield* new BoundaryError({ message: "boom" });
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
    }),
  );

  scoped("swaps to fallback for child update failure", () =>
    Effect.gen(function* () {
      const fail = Signal.makeSync(false);
      const Risky = Component.gen(function* () {
        if (yield* Signal.get(fail)) {
          return yield* new BoundaryError({ message: "boom" });
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
