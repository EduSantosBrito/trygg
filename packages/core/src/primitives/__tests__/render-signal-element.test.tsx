import { assert, describe } from "@effect/vitest";
import { Effect, Exit, Option, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import * as Component from "../component.js";
import type { ComponentProps } from "../component.js";
import type { Element } from "../element.js";
import * as Signal from "../signal.js";

class SyntheticReconcileFailure extends Schema.TaggedError<SyntheticReconcileFailure>()(
  "SyntheticReconcileFailure",
  {
    detail: Schema.String,
  },
) {}

describe("render-signal-element", () => {
  scoped("swaps DOM content when signal changes", () =>
    Effect.gen(function* () {
      const view = yield* Signal.make(<span data-testid="before">before</span>);
      const { getByTestId, queryByTestId } = yield* render(<div>{view}</div>);

      assert.strictEqual((yield* getByTestId("before")).textContent, "before");
      yield* Signal.set(view, <strong data-testid="after">after</strong>);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("after")).textContent, "after");
      assert.isTrue(Option.isNone(yield* queryByTestId("before")));
    }),
  );

  scoped("does not miss updates that land while initial content is rendering", () =>
    Effect.gen(function* () {
      let view: Signal.Signal<Element>;

      const Initial = Component.gen(function* () {
        yield* Signal.set(view, <strong data-testid="after">after</strong>);
        return <span data-testid="before">before</span>;
      });

      view = yield* Signal.make<Element>(<Initial />);
      const { getByTestId, queryByTestId } = yield* render(<div>{view}</div>);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(20);
      yield* Effect.yieldNow;

      assert.strictEqual((yield* getByTestId("after")).textContent, "after");
      assert.isTrue(Option.isNone(yield* queryByTestId("before")));
    }),
  );

  scoped(
    "keeps the replacement content visible while cleaning the previous content during swap",
    () =>
      Effect.gen(function* () {
        const cleanupSnapshots: Array<string> = [];
        let container: HTMLElement | null = null;

        const Previous = Component.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              cleanupSnapshots.push(container?.textContent?.replace(/\s+/g, " ").trim() ?? "");
            }),
          );

          return <section data-testid="previous">previous docs shell</section>;
        });

        const Replacement = Component.gen(function* () {
          return <section data-testid="replacement">replacement docs shell</section>;
        });

        const view = yield* Signal.make(<Previous />);
        const result = yield* render(<main>{view}</main>);
        container = result.container;

        assert.include(result.container.textContent ?? "", "previous docs shell");

        yield* Signal.set(view, <Replacement />);
        yield* TestClock.adjust(20);

        assert.include(result.container.textContent ?? "", "replacement docs shell");
        assert.deepStrictEqual(
          cleanupSnapshots,
          ["replacement docs shell"],
          "The old tree cleanup must not expose a blank frame before the replacement is inserted",
        );
      }),
  );

  scoped("falls back to a fresh mount when component reconciliation fails during a swap", () =>
    Effect.gen(function* () {
      let nextRenderAttempts = 0;
      const cleanupSnapshots: Array<string> = [];
      let container: HTMLElement | null = null;

      const FragilePanel = Component.gen(function* (
        Props: ComponentProps<{ readonly label: "previous" | "next" }>,
      ) {
        const { label } = yield* Props;

        if (label === "previous") {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              cleanupSnapshots.push(container?.textContent?.replace(/\s+/g, " ").trim() ?? "");
            }),
          );
        }

        if (label === "next") {
          nextRenderAttempts += 1;
          if (nextRenderAttempts === 1) {
            return yield* new SyntheticReconcileFailure({
              detail: "synthetic reconcile-only failure",
            });
          }
        }

        return <section data-testid={label}>{label} panel</section>;
      });

      const view = yield* Signal.make(<FragilePanel label="previous" />);
      const result = yield* render(<main>{view}</main>);
      container = result.container;

      assert.include(result.container.textContent ?? "", "previous panel");

      yield* Signal.set(view, <FragilePanel label="next" />);
      yield* TestClock.adjust(20);

      assert.include(
        result.container.textContent ?? "",
        "next panel",
        `Signal element should recover by mounting the replacement after reconcile fails. DOM: ${result.container.innerHTML}`,
      );
      assert.notInclude(result.container.textContent ?? "", "previous panel");
      assert.isAtLeast(nextRenderAttempts, 2);
      assert.deepStrictEqual(
        cleanupSnapshots,
        ["next panel"],
        "The failed reconcile must not clean the old tree until the fallback replacement is visible",
      );
    }),
  );

  scoped("cleans current content on unmount", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const view = yield* Signal.make(<span id="signal-element-cleanup" />);

      yield* render(<div>{view}</div>).pipe(Scope.provide(scope));
      assert.isNotNull(document.querySelector("#signal-element-cleanup"));

      yield* Scope.close(scope, Exit.void);
      assert.isNull(document.querySelector("#signal-element-cleanup"));
    }),
  );
});
