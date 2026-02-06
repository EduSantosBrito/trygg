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
import { Effect } from "effect";
import * as Signal from "../signal.js";
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
            (item: string) => <div data-item={item}>{item}</div>,
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
});
