import { assert, describe } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Scope } from "effect";
import * as Context from "effect/Context";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Component from "../component.js";
import * as ErrorBoundary from "../error-boundary.js";
import * as Signal from "../signal.js";

describe("render-component", () => {
  scoped("mounts with provided services", () => {
    class Label extends Context.Service<Label, { readonly value: string }>()("test/Label") {}

    const labelLayer = Layer.succeed(Label, { value: "provided" });

    const App = Component.gen(function* () {
      const label = yield* Label;
      return <div data-testid="label">{label.value}</div>;
    });

    return Effect.gen(function* () {
      const { getByTestId } = yield* render(<App />).pipe(Effect.provide(labelLayer));

      assert.strictEqual((yield* getByTestId("label")).textContent, "provided");
    });
  });

  scoped("subscribes to signals and re-renders on change", () =>
    Effect.gen(function* () {
      const count = Signal.makeSync(0);

      const Counter = Component.gen(function* () {
        const value = yield* Signal.get(count);
        return <div data-testid="count">{String(value)}</div>;
      });

      const { getByTestId } = yield* render(<Counter />);
      assert.strictEqual((yield* getByTestId("count")).textContent, "0");

      yield* Signal.set(count, 1);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("count")).textContent, "1");
    }),
  );

  scoped("batches multiple signal writes into one microtask render", () =>
    Effect.gen(function* () {
      const count = Signal.makeSync(0);
      const Counter = Component.gen(function* () {
        const value = yield* Signal.get(count);
        return <div data-testid="batched">{String(value)}</div>;
      });

      const { getByTestId } = yield* render(<Counter />);

      yield* Signal.set(count, 1);
      yield* Signal.set(count, 2);
      yield* Signal.set(count, 3);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("batched")).textContent, "3");
    }),
  );

  scoped("preserves current DOM when signal re-render fails without boundary", () =>
    Effect.gen(function* () {
      const shouldFail = Signal.makeSync(false);

      const Risky = Component.gen(function* () {
        if (yield* Signal.get(shouldFail)) {
          yield* Effect.fail("boom");
        }
        return <div data-testid="stable">stable</div>;
      });

      const { getByTestId } = yield* render(<Risky />);
      yield* Signal.set(shouldFail, true);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("stable")).textContent, "stable");
    }),
  );

  scoped("propagates re-render failures to error boundaries", () =>
    Effect.gen(function* () {
      const shouldFail = Signal.makeSync(false);

      const Risky = Component.gen(function* () {
        if (yield* Signal.get(shouldFail)) {
          yield* Effect.fail("boom");
        }
        return <div data-testid="risky">ok</div>;
      });

      const Fallback = Component.gen(function* (
        Props: Component.ComponentProps<{ cause: Cause.Cause<unknown> }>,
      ) {
        yield* Props;
        return <div data-testid="fallback">fallback</div>;
      });

      const Safe = yield* ErrorBoundary.catch(Risky).pipe(ErrorBoundary.catchAll(Fallback));
      const { getByTestId } = yield* render(<Safe />);

      yield* Signal.set(shouldFail, true);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("fallback")).textContent, "fallback");
    }),
  );

  scoped("cleans subscriptions and DOM on unmount", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const count = Signal.makeSync(0);

      const Counter = Component.gen(function* () {
        const value = yield* Signal.get(count);
        return <div id="component-cleanup">{String(value)}</div>;
      });

      yield* render(<Counter />).pipe(Scope.provide(scope));
      const listenersBefore = count._listeners.size;

      yield* Scope.close(scope, Exit.void);

      assert.isNull(document.querySelector("#component-cleanup"));
      assert.isBelow(count._listeners.size, listenersBefore);
    }),
  );
});
