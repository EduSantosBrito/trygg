/**
 * KeyedList Rendering Tests
 *
 * Tests for KeyedList (Signal.each) rendering behavior.
 *
 * Test Categories:
 * - Initial render: Render items correctly
 * - Reorder: DOM nodes move correctly
 * - Fragment items: Multi-node items (Fragments) move as complete units
 *
 * Critical Bug Covered:
 * - Fragment items break moveRange: Fragment returns first child as result.node,
 *   so moveRange(startMarker, firstChild, ref) orphans subsequent siblings.
 */
import { describe, it, expect } from "@effect/vitest";
import { Data, Effect, TestClock } from "effect";
import * as Signal from "../signal.js";
import * as Resource from "../resource.js";
import * as Component from "../component.js";
import * as ErrorBoundary from "../error-boundary.js";
import { render } from "../../testing/index.js";

// Note: Signal.each accepts Element | Effect<Element>, so Effect.succeed is optional

// Type aliases for readonly arrays to satisfy Signal.each signature
interface Item {
  readonly id: string;
  readonly parts: readonly string[];
}
interface ItemValues {
  readonly id: string;
  readonly values: readonly string[];
}
interface ItemNums {
  readonly id: string;
  readonly nums: readonly number[];
}

const findKeyedListAnchor = (root: Node): Comment | null => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let current = walker.nextNode();
  while (current !== null) {
    if (current instanceof Comment && current.data === "keyed-list") {
      return current;
    }
    current = walker.nextNode();
  }
  return null;
};

// =============================================================================
// Fragment items reorder - Bug #1 (CRITICAL)
// =============================================================================
// Scope: Fragment items must move as complete units during reorder.
// Bug: moveRange(startMarker, result.node, ref) only moves [startMarker, firstChild]
//      when result.node is the first child of a Fragment, orphaning remaining children.

describe("KeyedList Fragment reorder", () => {
  it.scoped("should move all Fragment children during reorder", () =>
    Effect.gen(function* () {
      // Items that render to Fragments with multiple children
      const items = yield* Signal.make<readonly Item[]>([
        { id: "a", parts: ["A1", "A2", "A3"] },
        { id: "b", parts: ["B1", "B2", "B3"] },
        { id: "c", parts: ["C1", "C2", "C3"] },
      ]);

      // Render a KeyedList where each item is a Fragment with 3 <span> children
      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item: Item) =>
              Effect.succeed(
                <>
                  {item.parts.map((part) => (
                    <span className="part">{part}</span>
                  ))}
                </>,
              ),
            { key: (item) => item.id },
          )}
        </div>,
      );

      // Initial order: A1 A2 A3 B1 B2 B3 C1 C2 C3
      const getSpanTexts = () =>
        Array.from(container.querySelectorAll("span.part")).map((el) => el.textContent);

      expect(getSpanTexts()).toEqual(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);

      // Reorder: move 'c' to front
      yield* Signal.set(items, [
        { id: "c", parts: ["C1", "C2", "C3"] },
        { id: "a", parts: ["A1", "A2", "A3"] },
        { id: "b", parts: ["B1", "B2", "B3"] },
      ]);

      // Allow microtask for update
      yield* Effect.yieldNow();

      // Expected after reorder: C1 C2 C3 A1 A2 A3 B1 B2 B3
      // BUG: Without fix, only C1 moves, C2 and C3 orphaned at end
      expect(getSpanTexts()).toEqual(["C1", "C2", "C3", "A1", "A2", "A3", "B1", "B2", "B3"]);
    }),
  );

  it.scoped("should handle reverse order of Fragment items", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<readonly ItemValues[]>([
        { id: "1", values: ["X", "Y"] },
        { id: "2", values: ["P", "Q"] },
        { id: "3", values: ["M", "N"] },
      ]);

      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item: ItemValues) =>
              Effect.succeed(
                <>
                  {item.values.map((v) => (
                    <span data-value={v}>{v}</span>
                  ))}
                </>,
              ),
            { key: (item) => item.id },
          )}
        </div>,
      );

      const getValues = () =>
        Array.from(container.querySelectorAll("span[data-value]")).map((el) => el.textContent);

      expect(getValues()).toEqual(["X", "Y", "P", "Q", "M", "N"]);

      // Complete reverse
      yield* Signal.set(items, [
        { id: "3", values: ["M", "N"] },
        { id: "2", values: ["P", "Q"] },
        { id: "1", values: ["X", "Y"] },
      ]);

      yield* Effect.yieldNow();

      expect(getValues()).toEqual(["M", "N", "P", "Q", "X", "Y"]);
    }),
  );

  it.scoped("should handle interleaved reorder of Fragment items", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<readonly ItemNums[]>([
        { id: "a", nums: [1, 2] },
        { id: "b", nums: [3, 4] },
        { id: "c", nums: [5, 6] },
        { id: "d", nums: [7, 8] },
      ]);

      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item: ItemNums) =>
              Effect.succeed(
                <>
                  {item.nums.map((n) => (
                    <span data-n={String(n)}>{n}</span>
                  ))}
                </>,
              ),
            { key: (item) => item.id },
          )}
        </div>,
      );

      const getNums = () =>
        Array.from(container.querySelectorAll("span[data-n]")).map((el) => el.textContent);

      expect(getNums()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);

      // Interleave: a, c, b, d -> 1,2, 5,6, 3,4, 7,8
      yield* Signal.set(items, [
        { id: "a", nums: [1, 2] },
        { id: "c", nums: [5, 6] },
        { id: "b", nums: [3, 4] },
        { id: "d", nums: [7, 8] },
      ]);

      yield* Effect.yieldNow();

      expect(getNums()).toEqual(["1", "2", "5", "6", "3", "4", "7", "8"]);
    }),
  );
});

// =============================================================================
// Fragment items removal - Ensure cleanup works
// =============================================================================

describe("KeyedList Fragment removal", () => {
  it.scoped("should remove all Fragment children when item removed", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<readonly Item[]>([
        { id: "a", parts: ["A1", "A2"] },
        { id: "b", parts: ["B1", "B2"] },
      ]);

      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item: Item) =>
              Effect.succeed(
                <>
                  {item.parts.map((p) => (
                    <span>{p}</span>
                  ))}
                </>,
              ),
            { key: (item) => item.id },
          )}
        </div>,
      );

      expect(container.querySelectorAll("span").length).toBe(4);

      // Remove first item
      yield* Signal.set(items, [{ id: "b", parts: ["B1", "B2"] }]);
      yield* Effect.yieldNow();

      // Should only have B1, B2
      const texts = Array.from(container.querySelectorAll("span")).map((el) => el.textContent);
      expect(texts).toEqual(["B1", "B2"]);
    }),
  );
});

// =============================================================================
// Single-element items reorder (baseline - should already work)
// =============================================================================
// Single elements use their own node as result.node, so moveRange works correctly.

describe("KeyedList single-element reorder (baseline)", () => {
  it.scoped("should reorder single-element items correctly", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<readonly string[]>(["alpha", "beta", "gamma"]);

      // Using single elements (not Fragments) - simpler API without Effect.succeed
      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item: string) => (
              <div data-item={item}>{item}</div>
            ),
            { key: (item) => item },
          )}
        </div>,
      );

      const getItems = () =>
        Array.from(container.querySelectorAll("[data-item]")).map((el) => el.textContent);

      expect(getItems()).toEqual(["alpha", "beta", "gamma"]);

      // Reverse order
      yield* Signal.set(items, ["gamma", "beta", "alpha"]);
      yield* Effect.yieldNow();

      expect(getItems()).toEqual(["gamma", "beta", "alpha"]);
    }),
  );

  it.scoped("should keep rendering after keyed-list anchor reparent", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<readonly string[]>([]);

      const { container } = yield* render(
        <div data-testid="root">
          {Signal.each(
            items,
            (item: string) => (
              <div data-id={item}>{item}</div>
            ),
            { key: (item) => item },
          )}
        </div>,
      );

      const anchor = findKeyedListAnchor(container);
      expect(anchor).not.toBeNull();

      if (anchor === null) {
        return;
      }

      const newParent = document.createElement("div");
      container.appendChild(newParent);
      newParent.appendChild(anchor);

      yield* Signal.set(items, ["a", "b", "c"]);
      yield* Effect.yieldNow();

      expect(newParent.querySelectorAll("[data-id]").length).toBe(3);
    }),
  );

  it.scoped("should preserve order after filter roundtrip with nested component", () =>
    Effect.gen(function* () {
      interface IncidentLike {
        readonly id: number;
        readonly title: string;
        readonly severity: "SEV-1" | "SEV-2" | "SEV-3";
      }

      const incidents = yield* Signal.make<ReadonlyArray<IncidentLike>>([
        { id: 1, title: "A", severity: "SEV-2" },
        { id: 2, title: "B", severity: "SEV-1" },
        { id: 3, title: "C", severity: "SEV-3" },
      ]);
      const filter = yield* Signal.make<"all" | "SEV-1">("all");

      const filtered = yield* Signal.deriveAll([incidents, filter], (items, currentFilter) =>
        currentFilter === "all" ? items : items.filter((item) => item.severity === currentFilter),
      );

      const Row = Component.gen(function* (
        Props: Component.ComponentProps<{ readonly item: IncidentLike }>,
      ) {
        const { item } = yield* Props;
        const expanded = yield* Signal.make(false);
        const details = yield* Signal.derive(expanded, (isExpanded) =>
          isExpanded ? <div className="details">details</div> : <></>,
        );

        return (
          <article data-id={String(item.id)}>
            <h3>{item.title}</h3>
            {details}
          </article>
        );
      });

      const { container } = yield* render(
        <div>
          {Signal.each(
            filtered,
            (item) => (
              <Row item={item} />
            ),
            { key: (item) => item.id },
          )}
        </div>,
      );

      const ids = () =>
        Array.from(container.querySelectorAll("[data-id]"))
          .map((el) => el.getAttribute("data-id"))
          .filter((id): id is string => id !== null);

      // KeyedList update runs in forked effect; allow mount to settle.
      yield* Effect.yieldNow();
      yield* Effect.yieldNow();

      expect(ids()).toEqual(["1", "2", "3"]);

      yield* Signal.set(filter, "SEV-1");
      yield* Effect.yieldNow();
      yield* Effect.yieldNow();
      expect(ids()).toEqual(["2"]);

      yield* Signal.set(filter, "all");
      yield* Effect.yieldNow();
      yield* Effect.yieldNow();
      expect(ids()).toEqual(["1", "2", "3"]);

      // Rapid toggles should still converge to stable order.
      for (let i = 0; i < 3; i++) {
        yield* Signal.set(filter, "SEV-1");
        yield* Signal.set(filter, "all");
      }

      yield* Effect.yieldNow();
      yield* Effect.yieldNow();
      yield* Effect.yieldNow();
      expect(ids()).toEqual(["1", "2", "3"]);
    }),
  );
});

// =============================================================================
// Stable-order updates - rerender changed item only
// =============================================================================

describe("KeyedList stable-order updates", () => {
  it.scoped("should rerender existing key when item value changes", () =>
    Effect.gen(function* () {
      const items = yield* Signal.make<
        ReadonlyArray<{ readonly id: string; readonly label: string }>
      >([
        { id: "a", label: "Alpha" },
        { id: "b", label: "Bravo" },
      ]);

      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item) => (
              <div data-id={item.id} data-label={item.label}>
                {item.label}
              </div>
            ),
            { key: (item) => item.id },
          )}
        </div>,
      );

      const getLabels = () =>
        Array.from(container.querySelectorAll("[data-id]")).map((el) => el.textContent);

      expect(getLabels()).toEqual(["Alpha", "Bravo"]);

      // Same keys, same order, one item changed
      yield* Signal.set(items, [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Bravo 2" },
      ]);
      yield* Effect.yieldNow();

      expect(getLabels()).toEqual(["Alpha", "Bravo 2"]);
    }),
  );

  it.scoped("should converge to source order under rapid filter toggles", () =>
    Effect.gen(function* () {
      interface Item {
        readonly id: number;
        readonly severity: "SEV-1" | "SEV-2" | "SEV-3";
      }

      const items = yield* Signal.make<ReadonlyArray<Item>>([
        { id: 1, severity: "SEV-2" },
        { id: 2, severity: "SEV-1" },
        { id: 3, severity: "SEV-3" },
      ]);
      const filter = yield* Signal.make<"all" | "SEV-1">("all");

      const filtered = yield* Signal.deriveAll([items, filter], (allItems, currentFilter) =>
        currentFilter === "all"
          ? allItems
          : allItems.filter((item) => item.severity === currentFilter),
      );

      const { container } = yield* render(
        <div>
          {Signal.each(
            filtered,
            (item, index) =>
              Effect.gen(function* () {
                if (index > 0) {
                  yield* Effect.sleep("10 millis");
                }
                return <div data-id={String(item.id)}>{item.id}</div>;
              }),
            { key: (item) => item.id },
          )}
        </div>,
      );

      yield* TestClock.adjust("30 millis");
      yield* Effect.yieldNow();

      // Rapid toggles while update work is in-flight.
      yield* Signal.set(filter, "SEV-1");
      yield* Signal.set(filter, "all");
      yield* Signal.set(filter, "SEV-1");
      yield* Signal.set(filter, "all");

      yield* TestClock.adjust("60 millis");
      yield* Effect.yieldNow();
      yield* Effect.yieldNow();

      const ids = Array.from(container.querySelectorAll("[data-id]")).map((el) =>
        el.getAttribute("data-id"),
      );

      expect(ids).toEqual(["1", "2", "3"]);
    }),
  );

  it.scoped("should preserve order with incident-card-like nested structure", () =>
    Effect.gen(function* () {
      type Severity = "SEV-1" | "SEV-2" | "SEV-3";
      interface IncidentLike {
        readonly id: number;
        readonly title: string;
        readonly severity: Severity;
        readonly status: "Detected" | "Investigating" | "Resolved";
      }

      const incidents = yield* Signal.make<ReadonlyArray<IncidentLike>>([
        { id: 1, title: "API", severity: "SEV-2", status: "Investigating" },
        { id: 2, title: "DB", severity: "SEV-1", status: "Detected" },
        { id: 3, title: "Auth", severity: "SEV-3", status: "Resolved" },
      ]);
      const expandedIds = yield* Signal.make<ReadonlySet<number>>(new Set());
      const filter = yield* Signal.make<"all" | "SEV-1">("all");

      const filtered = yield* Signal.deriveAll([incidents, filter], (allItems, currentFilter) =>
        currentFilter === "all"
          ? allItems
          : allItems.filter((item) => item.severity === currentFilter),
      );

      const Row = Component.gen(function* (
        Props: Component.ComponentProps<{
          readonly incident: IncidentLike;
          readonly expandedIds: Signal.Signal<ReadonlySet<number>>;
        }>,
      ) {
        const { incident, expandedIds: expandedSet } = yield* Props;
        const expanded = yield* Signal.derive(expandedSet, (set) => set.has(incident.id));
        const ariaExpanded = yield* Signal.derive(expanded, (v) => (v ? "true" : "false"));
        const chevron = yield* Signal.derive(expanded, (v) => (v ? "▲" : "▼"));
        const body = yield* Signal.derive(expanded, (isExpanded) =>
          isExpanded ? <div className="body">expanded</div> : <></>,
        );

        return (
          <article data-id={String(incident.id)}>
            <div className="header">
              <button aria-expanded={ariaExpanded}>
                <h3>{incident.title}</h3>
                <span>{incident.severity}</span>
                <span>{incident.status}</span>
                <span>{chevron}</span>
              </button>
              <a href={`/${String(incident.id)}`}>View details</a>
            </div>
            {body}
          </article>
        );
      });

      const { container } = yield* render(
        <div>
          {Signal.each(
            filtered,
            (incident, index) =>
              Effect.gen(function* () {
                if (index > 0) {
                  yield* Effect.sleep("5 millis");
                }
                return <Row incident={incident} expandedIds={expandedIds} />;
              }),
            { key: (incident) => incident.id },
          )}
        </div>,
      );

      const readOrder = () =>
        Array.from(container.querySelectorAll("[data-id]"))
          .map((el) => el.getAttribute("data-id"))
          .filter((id): id is string => id !== null);

      yield* TestClock.adjust("20 millis");
      yield* Effect.yieldNow();
      expect(readOrder()).toEqual(["1", "2", "3"]);

      yield* Signal.set(filter, "SEV-1");
      yield* Effect.yieldNow();
      yield* TestClock.adjust("10 millis");
      expect(readOrder()).toEqual(["2"]);

      yield* Signal.set(filter, "all");
      yield* Effect.yieldNow();
      yield* TestClock.adjust("20 millis");
      yield* Effect.yieldNow();
      expect(readOrder()).toEqual(["1", "2", "3"]);
    }),
  );

  it.scoped("should not expose partial intermediate order while rebuilding from filter", () =>
    Effect.gen(function* () {
      interface Item {
        readonly id: number;
        readonly severity: "SEV-1" | "SEV-2" | "SEV-3";
      }

      const items = yield* Signal.make<ReadonlyArray<Item>>([
        { id: 1, severity: "SEV-2" },
        { id: 2, severity: "SEV-1" },
        { id: 3, severity: "SEV-3" },
      ]);
      const filter = yield* Signal.make<"all" | "SEV-1">("SEV-1");

      const filtered = yield* Signal.deriveAll([items, filter], (allItems, currentFilter) =>
        currentFilter === "all"
          ? allItems
          : allItems.filter((item) => item.severity === currentFilter),
      );

      const { container } = yield* render(
        <div>
          {Signal.each(
            filtered,
            (item) =>
              Effect.gen(function* () {
                // Make last item slow so we can observe intermediate DOM.
                if (item.id === 3) {
                  yield* Effect.sleep("50 millis");
                }
                return <div data-id={String(item.id)}>{item.id}</div>;
              }),
            { key: (item) => item.id },
          )}
        </div>,
      );

      const ids = () =>
        Array.from(container.querySelectorAll("[data-id]"))
          .map((el) => el.getAttribute("data-id"))
          .filter((id): id is string => id !== null);

      yield* Effect.yieldNow();
      expect(ids()).toEqual(["2"]);

      yield* Signal.set(filter, "all");
      yield* TestClock.adjust("10 millis");
      yield* Effect.yieldNow();

      // Should not show partial rebuild like [2,1] while id=3 is still rendering.
      expect(ids()).toEqual(["2"]);

      yield* TestClock.adjust("60 millis");
      yield* Effect.yieldNow();
      expect(ids()).toEqual(["1", "2", "3"]);
    }),
  );
});

describe("KeyedList with SignalElement swap", () => {
  it.scoped("should render all keyed items after Pending -> Success swap", () =>
    Effect.gen(function* () {
      const EMPTY_ITEMS: ReadonlyArray<{ readonly id: number; readonly label: string }> = [];

      const state = yield* Signal.make<
        Resource.ResourceState<
          ReadonlyArray<{ readonly id: number; readonly label: string }>,
          never
        >
      >(Resource.Pending());

      const items = yield* Signal.derive(state, (s) =>
        s._tag === "Success" ? s.value : EMPTY_ITEMS,
      );

      const dataRegion = yield* Resource.match(state, {
        Pending: () => <div data-testid="pending">pending</div>,
        Success: () => (
          <section>
            {Signal.each(
              items,
              (item, index) =>
                Effect.gen(function* () {
                  if (index > 0) {
                    yield* Effect.sleep("10 millis");
                  }
                  return <div data-id={String(item.id)}>{item.label}</div>;
                }),
              { key: (item) => item.id },
            )}
          </section>
        ),
        Failure: () => <div data-testid="error">error</div>,
      });

      const { container } = yield* render(<div>{dataRegion}</div>);

      yield* Signal.set(
        state,
        Resource.Success(
          [
            { id: 1, label: "A" },
            { id: 2, label: "B" },
            { id: 3, label: "C" },
          ],
          false,
        ),
      );

      yield* TestClock.adjust("30 millis");
      yield* Effect.yieldNow();

      expect(container.querySelectorAll("[data-id]").length).toBe(3);
    }),
  );

  it.scoped("renders list after Pending -> Success with nested SignalElement in item", () =>
    Effect.gen(function* () {
      const EMPTY_ITEMS: ReadonlyArray<{ readonly id: number; readonly label: string }> = [];

      const ItemRow = Component.gen(function* (
        Props: Component.ComponentProps<{
          readonly item: { readonly id: number; readonly label: string };
        }>,
      ) {
        const { item } = yield* Props;
        const expanded = yield* Signal.make(false);
        const body = yield* Signal.derive(expanded, (isExpanded) =>
          isExpanded ? <div className="body">expanded</div> : <></>,
        );

        return (
          <article data-id={String(item.id)}>
            <h3>{item.label}</h3>
            {body}
          </article>
        );
      });

      const state = yield* Signal.make<
        Resource.ResourceState<
          ReadonlyArray<{ readonly id: number; readonly label: string }>,
          never
        >
      >(Resource.Pending());

      const items = yield* Signal.derive(state, (s) =>
        s._tag === "Success" ? s.value : EMPTY_ITEMS,
      );
      const showContent = yield* Signal.derive(state, (s) => s._tag === "Success");

      const fallbackRegion = yield* Resource.match(state, {
        Pending: () => <div data-testid="skeleton">loading</div>,
        Success: () => <></>,
        Failure: () => <div data-testid="error">error</div>,
      });

      const contentRegion = yield* Signal.derive(showContent, (visible) =>
        visible ? (
          <section>
            {Signal.each(
              items,
              (item) => (
                <ItemRow item={item} />
              ),
              { key: (item) => item.id },
            )}
          </section>
        ) : (
          <></>
        ),
      );

      const { container } = yield* render(
        <div>
          {fallbackRegion}
          {contentRegion}
        </div>,
      );

      yield* Signal.set(
        state,
        Resource.Success(
          [
            { id: 1, label: "A" },
            { id: 2, label: "B" },
            { id: 3, label: "C" },
          ],
          false,
        ),
      );

      yield* Effect.yieldNow();
      yield* Effect.yieldNow();

      expect(container.querySelectorAll("[data-id]").length).toBe(3);
    }),
  );

  it.scoped("recovers list after interrupted Pending -> Success -> Pending -> Success", () =>
    Effect.gen(function* () {
      const EMPTY_ITEMS: ReadonlyArray<{ readonly id: number; readonly label: string }> = [];
      const shouldInterrupt = yield* Signal.make(true);

      const state = yield* Signal.make<
        Resource.ResourceState<
          ReadonlyArray<{ readonly id: number; readonly label: string }>,
          never
        >
      >(Resource.Pending());

      const ItemRow = Component.gen(function* (
        Props: Component.ComponentProps<{
          readonly item: { readonly id: number; readonly label: string };
        }>,
      ) {
        const { item } = yield* Props;

        // Deterministic race: unmount list while first item is rendering.
        const interrupt = yield* Signal.get(shouldInterrupt);
        if (interrupt && item.id === 1) {
          yield* Signal.set(shouldInterrupt, false);
          yield* Signal.set(state, Resource.Pending());
        }

        yield* Effect.sleep("10 millis");
        return <div data-id={String(item.id)}>{item.label}</div>;
      });

      const items = yield* Signal.derive(state, (s) =>
        s._tag === "Success" ? s.value : EMPTY_ITEMS,
      );
      const showContent = yield* Signal.derive(state, (s) => s._tag === "Success");

      const contentRegion = yield* Signal.derive(showContent, (visible) =>
        visible ? (
          <section>
            {Signal.each(
              items,
              (item) => (
                <ItemRow item={item} />
              ),
              { key: (item) => item.id },
            )}
          </section>
        ) : (
          <div data-testid="pending">pending</div>
        ),
      );

      const { container } = yield* render(<div>{contentRegion}</div>);

      yield* Signal.set(
        state,
        Resource.Success(
          [
            { id: 1, label: "A" },
            { id: 2, label: "B" },
          ],
          false,
        ),
      );

      yield* TestClock.adjust("20 millis");
      yield* Effect.yieldNow();

      yield* Signal.set(
        state,
        Resource.Success(
          [
            { id: 1, label: "A2" },
            { id: 2, label: "B2" },
          ],
          false,
        ),
      );

      yield* TestClock.adjust("30 millis");
      yield* Effect.yieldNow();

      expect(container.querySelectorAll("[data-id]").length).toBe(2);
      expect(container.querySelector('[data-id="1"]')?.textContent).toBe("A2");
    }),
  );

  it.scoped("recovers from NotFoundError during component anchor insert", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const originalInsertBefore = Node.prototype.insertBefore;
        let armed = false;
        let injected = false;

        const patchedInsertBefore: typeof Node.prototype.insertBefore = function <T extends Node>(
          this: Node,
          node: T,
          child: Node | null,
        ): T {
          if (armed && !injected && child instanceof Comment && child.data === "component") {
            injected = true;
            if (child.parentNode === this) {
              child.remove();
            }
            throw new DOMException("simulated race", "NotFoundError");
          }

          originalInsertBefore.call(this, node, child);
          return node;
        };

        Node.prototype.insertBefore = patchedInsertBefore;
        return {
          arm: () => {
            armed = true;
          },
          restore: () => {
            Node.prototype.insertBefore = originalInsertBefore;
          },
        };
      }),
      ({ arm }) =>
        Effect.gen(function* () {
          const ItemRow = Component.gen(function* (
            Props: Component.ComponentProps<{
              readonly item: { readonly id: number; readonly label: string };
            }>,
          ) {
            const { item } = yield* Props;
            return <div data-id={String(item.id)}>{item.label}</div>;
          });

          const items = yield* Signal.make<
            ReadonlyArray<{ readonly id: number; readonly label: string }>
          >([]);

          const { container } = yield* render(
            <div>
              {Signal.each(
                items,
                (item) => (
                  <ItemRow item={item} />
                ),
                { key: (item) => item.id },
              )}
            </div>,
          );

          arm();
          yield* Signal.set(items, [{ id: 1, label: "A" }]);
          yield* Effect.yieldNow();

          // Subsequent update should still render correctly.
          yield* Signal.set(items, [{ id: 1, label: "A2" }]);
          yield* Effect.yieldNow();

          expect(container.querySelectorAll("[data-id]").length).toBe(1);
          expect(container.querySelector('[data-id="1"]')?.textContent).toBe("A2");
        }),
      ({ restore }) => Effect.sync(restore),
    ),
  );

  it.scoped("renders ErrorBoundary fallback when keyed list item rerender fails", () =>
    Effect.gen(function* () {
      class ItemError extends Data.TaggedError("ItemError")<{ readonly reason: "fail" }> {}

      interface ItemRowData {
        readonly id: number;
        readonly label: string;
      }

      const items = yield* Signal.make<ReadonlyArray<ItemRowData>>([{ id: 1, label: "A" }]);
      const shouldFail = yield* Signal.make(false);

      const RiskyItem = Component.gen(function* (
        Props: Component.ComponentProps<{ readonly item: ItemRowData }>,
      ) {
        const { item } = yield* Props;
        const fail = yield* Signal.get(shouldFail);
        if (fail) {
          return yield* new ItemError({ reason: "fail" });
        }
        return <div data-id={String(item.id)}>{item.label}</div>;
      });

      const ErrorFallback = Component.gen(function* (
        Props: Component.ComponentProps<{ readonly error: ItemError }>,
      ) {
        yield* Props;
        return <div data-testid="item-fallback">fallback</div>;
      });

      const SafeItem = yield* ErrorBoundary.catch(RiskyItem)
        .on("ItemError", ErrorFallback)
        .catchAll(() => <div data-testid="item-fallback-generic">generic</div>);

      const { container } = yield* render(
        <div>
          {Signal.each(
            items,
            (item) => (
              <SafeItem item={item} />
            ),
            { key: (item) => item.id },
          )}
        </div>,
      );

      for (let i = 0; i < 10; i++) {
        yield* Effect.yieldNow();
      }
      expect(container.querySelector('[data-id="1"]')).not.toBeNull();

      yield* Signal.set(shouldFail, true);
      for (let i = 0; i < 10; i++) {
        yield* Effect.yieldNow();
      }

      expect(container.querySelector('[data-testid="item-fallback"]')).not.toBeNull();
    }),
  );

  it.scoped("renders on first update when initial anchor insert throws once", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const originalInsertBefore = Node.prototype.insertBefore;
        let injected = false;

        const patchedInsertBefore: typeof Node.prototype.insertBefore = function <T extends Node>(
          this: Node,
          node: T,
          child: Node | null,
        ): T {
          if (!injected && child instanceof Comment && child.data === "component") {
            injected = true;
            throw new DOMException("simulated transient race", "NotFoundError");
          }

          originalInsertBefore.call(this, node, child);
          return node;
        };

        Node.prototype.insertBefore = patchedInsertBefore;
        return {
          restore: () => {
            Node.prototype.insertBefore = originalInsertBefore;
          },
        };
      }),
      () =>
        Effect.gen(function* () {
          const ItemRow = Component.gen(function* (
            Props: Component.ComponentProps<{
              readonly item: { readonly id: number; readonly label: string };
            }>,
          ) {
            const { item } = yield* Props;
            return <div data-id={String(item.id)}>{item.label}</div>;
          });

          const items = yield* Signal.make<
            ReadonlyArray<{ readonly id: number; readonly label: string }>
          >([]);

          const { container } = yield* render(
            <div>
              {Signal.each(
                items,
                (item) => (
                  <ItemRow item={item} />
                ),
                { key: (item) => item.id },
              )}
            </div>,
          );

          yield* Signal.set(items, [{ id: 1, label: "A" }]);
          yield* Effect.yieldNow();

          expect(container.querySelectorAll("[data-id]").length).toBe(1);
          expect(container.querySelector('[data-id="1"]')?.textContent).toBe("A");
        }),
      ({ restore }) => Effect.sync(restore),
    ),
  );
});
