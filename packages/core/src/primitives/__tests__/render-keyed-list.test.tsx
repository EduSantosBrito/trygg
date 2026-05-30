import { assert, describe } from "@effect/vitest";
import { Effect, Exit, Scheduler, Scope } from "effect";
import * as Context from "effect/Context";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import { render } from "../../testing/index.js";
import { Element } from "../element.js";
import { computeLIS, renderKeyedList } from "../render-keyed-list.js";
import * as Signal from "../signal.js";
import type { RenderContext, RenderResult } from "../renderer.js";
import * as SafeUrl from "../../security/safe-url.js";
import { unsafeEraseR, unsafeWidenContext } from "../../internal/unsafe.js";

describe("computeLIS", () => {
  scoped("returns input indices for the longest increasing subsequence", () =>
    Effect.sync(() => {
      assert.deepEqual(computeLIS([]), []);
      assert.deepEqual(computeLIS([0, 1, 2]), [0, 1, 2]);
      assert.deepEqual(computeLIS([2, 0, 1]), [1, 2]);
      assert.deepEqual(computeLIS([3, 1, 2, 0]), [1, 2]);
    }),
  );
});

describe("renderKeyedList", () => {
  scoped("renders empty lists and inserts at head, tail, and middle", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<ReadonlyArray<string>>([]);
      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item) => (
              <span data-id={item}>{item}</span>
            ),
            { key: (item) => item },
          )}
        </div>,
      );

      const ids = () =>
        Array.from(container.querySelectorAll("[data-id]")).map((el) => el.textContent);

      assert.deepEqual(ids(), []);

      yield* Signal.set(items, ["b"]);
      yield* TestClock.adjust(10);
      assert.deepEqual(ids(), ["b"]);

      yield* Signal.set(items, ["a", "b", "d"]);
      yield* TestClock.adjust(10);
      assert.deepEqual(ids(), ["a", "b", "d"]);

      yield* Signal.set(items, ["a", "b", "c", "d"]);
      yield* TestClock.adjust(10);
      assert.deepEqual(ids(), ["a", "b", "c", "d"]);
    }),
  );

  scoped("removes items and preserves key-based DOM identity on reorder", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<ReadonlyArray<string>>(["a", "b", "c", "d"]);
      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item) => (
              <span data-id={item}>{item}</span>
            ),
            { key: (item) => item },
          )}
        </div>,
      );

      const ids = () =>
        Array.from(container.querySelectorAll("[data-id]")).map((el) => el.getAttribute("data-id"));
      const originalC = container.querySelector('[data-id="c"]');

      yield* Signal.set(items, ["d", "b", "c", "a"]);
      yield* TestClock.adjust(10);

      assert.deepEqual(ids(), ["d", "b", "c", "a"]);
      assert.strictEqual(container.querySelector('[data-id="c"]'), originalC);

      yield* Signal.set(items, ["d", "c"]);
      yield* TestClock.adjust(10);

      assert.deepEqual(ids(), ["d", "c"]);
      assert.strictEqual(container.querySelector('[data-id="c"]'), originalC);
    }),
  );

  scoped("renders the initial list without cooperative scheduler yields", () =>
    Effect.gen(function* () {
      // Test: should render the first non-empty keyed-list snapshot without yielding.
      // Scope: guards the js-framework-benchmark create path where an empty table receives
      // 10k rows and browser macrotask yields add a clamped ~4ms delay every few rows.
      // Assertion: an intentionally eager scheduler observes no scheduled tasks during the
      // empty-to-populated update, proving the first bulk create runs under PreventSchedulerYield.
      const initialItems = Array.from({ length: 96 }, (_, index) => index);
      const items = yield* Signal.make<ReadonlyArray<number>>([]);
      const parent = document.createElement("div");
      const scope = yield* Scope.make();
      let scheduledTasks = 0;

      const scheduler: Scheduler.Scheduler = {
        executionMode: "async",
        shouldYield: (fiber) => fiber.currentOpCount >= 2048,
        makeDispatcher: () => ({
          scheduleTask: () => {
            scheduledTasks++;
          },
          flush: () => {},
        }),
      };

      const renderContext: RenderContext = {
        services: unsafeWidenContext(yield* Effect.context<never>()),
        scope,
        safeUrlConfig: SafeUrl.defaultConfig,
      };

      const renderResult = yield* renderKeyedList(
        items,
        (item) => Effect.succeed(Element.Text({ content: String(item) })),
        (item) => Number(item),
        parent,
        renderContext,
        null,
        { errorHandler: null },
        {
          provideRenderContext: <A, E2, R2>(effect: Effect.Effect<A, E2, R2>) =>
            unsafeEraseR(effect),
          renderElement: (element, target): Effect.Effect<RenderResult> =>
            Effect.sync(() => {
              const node = document.createTextNode(
                Element.$is("Text")(element) ? element.content : "",
              );
              target.appendChild(node);
              return {
                node,
                cleanup: Effect.sync(() => {
                  node.remove();
                }),
              } satisfies RenderResult;
            }),
          runForkInRenderContext: <E2, R2>(
            effect: Effect.Effect<void, E2, R2>,
            currentRenderContext: RenderContext,
            _context: Context.Context<unknown> | null,
            options?: { readonly preventSchedulerYield?: boolean },
          ) => {
            const forkServices =
              options?.preventSchedulerYield === true
                ? Context.add(currentRenderContext.services, Scheduler.PreventSchedulerYield, true)
                : currentRenderContext.services;

            Effect.runForkWith(forkServices)(
              effect.pipe(Scope.provide(currentRenderContext.scope)),
              {
                scheduler,
              },
            );
          },
        },
      );

      assert.strictEqual(scheduledTasks, 0);
      assert.strictEqual(parent.textContent, "");

      scheduledTasks = 0;
      yield* Signal.set(items, initialItems);

      assert.strictEqual(scheduledTasks, 0);
      assert.strictEqual(parent.textContent, initialItems.map(String).join(""));

      yield* renderResult.cleanup;
      yield* Scope.close(scope, Exit.void);
    }),
  );

  scoped("batches full clear before per-row cleanup touches a live table", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const originalRemoveChild = Node.prototype.removeChild;
        let tbody: HTMLTableSectionElement | null = null;
        let liveRowRemovals = 0;

        const patchedRemoveChild: typeof Node.prototype.removeChild = function <T extends Node>(
          this: Node,
          child: T,
        ): T {
          if (tbody !== null && this === tbody && tbody.isConnected && child.nodeName === "TR") {
            liveRowRemovals++;
          }
          originalRemoveChild.call(this, child);
          return child;
        };

        Node.prototype.removeChild = patchedRemoveChild;

        return {
          observeTableBody: (node: HTMLTableSectionElement) => {
            tbody = node;
          },
          liveRowRemovals: () => liveRowRemovals,
          restore: () => {
            Node.prototype.removeChild = originalRemoveChild;
          },
        };
      }),
      ({ liveRowRemovals, observeTableBody }) =>
        Effect.gen(function* () {
          // Test: should clear a keyed table body without removing each row from the live tbody.
          // Scope: guards the js-framework-benchmark clear path where table layout makes
          // per-row live removals super-linear in Chrome.
          // Assertion: full clear performs zero per-row removeChild(tr) calls while the tbody
          // remains connected; row cleanup may still run after the range is off-document.
          const items = yield* Signal.make<ReadonlyArray<number>>(
            Array.from({ length: 20 }, (_, index) => index),
          );

          const { container } = yield* render(
            <table>
              <tbody>
                {Signal.each(
                  items,
                  (item) => (
                    <tr data-id={String(item)}>
                      <td>{item}</td>
                    </tr>
                  ),
                  { key: (item) => item },
                )}
              </tbody>
            </table>,
          );

          const tbody = container.querySelector("tbody");
          assert.instanceOf(tbody, HTMLTableSectionElement);
          observeTableBody(tbody);

          assert.strictEqual(container.querySelectorAll("tr").length, 20);

          yield* Signal.set(items, []);
          yield* TestClock.adjust(10);

          assert.strictEqual(container.querySelectorAll("tr").length, 0);
          assert.strictEqual(liveRowRemovals(), 0);
        }),
      ({ restore }) => Effect.sync(restore),
    ),
  );

  scoped("cleans source and item subscriptions on removal and unmount", () =>
    Effect.gen(function* () {
      const label = yield* Signal.make("A");
      const items = yield* Signal.make<ReadonlyArray<{ readonly id: string }>>([{ id: "a" }]);
      const scope = yield* Scope.make();

      yield* render(
        <div>
          {Signal.each(
            items,
            (item) =>
              Effect.gen(function* () {
                const value = yield* Signal.get(label);
                return <span data-id={item.id}>{value}</span>;
              }),
            { key: (item) => item.id },
          )}
        </div>,
      ).pipe(Scope.provide(scope));

      yield* TestClock.adjust(10);
      assert.isAbove(label._listeners.size, 0);
      assert.isAbove(items._listeners.size, 0);

      yield* Signal.set(items, []);
      yield* TestClock.adjust(10);
      assert.strictEqual(label._listeners.size, 0);

      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(items._listeners.size, 0);
    }),
  );
});
