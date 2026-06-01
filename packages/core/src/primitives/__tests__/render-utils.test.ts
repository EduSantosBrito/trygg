import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ElementProps } from "../element.js";
import { moveRange, shallowPropsEqual } from "../render-utils.js";

const props = (value: ElementProps): ElementProps => value;
const eventEffect = Effect.void;

describe("render-utils", () => {
  describe("shallowPropsEqual", () => {
    it("treats the same object reference as equal", () => {
      const p = props({ className: "row" });
      assert.isTrue(shallowPropsEqual(p, p));
    });

    it("treats fresh objects with identical primitive values as equal", () => {
      // The update-10th hot path: each render allocates a new props literal with
      // the same interned className string. Structural Equal.equals paid a full
      // hash for this; Object.is short-circuits it to "equal" so reconcile skips.
      assert.isTrue(
        shallowPropsEqual(props({ className: "col-md-1" }), props({ className: "col-md-1" })),
      );
    });

    it("reports a changed primitive value", () => {
      assert.isFalse(
        shallowPropsEqual(props({ className: "row" }), props({ className: "row active" })),
      );
    });

    it("reports a new function identity (handler re-bind)", () => {
      const onClick = (_event: Event) => eventEffect;
      const nextOnClick = (_event: Event) => eventEffect;
      assert.isTrue(shallowPropsEqual(props({ onClick }), props({ onClick })));
      assert.isFalse(shallowPropsEqual(props({ onClick }), props({ onClick: nextOnClick })));
    });

    it("reports differing key sets", () => {
      assert.isFalse(
        shallowPropsEqual(props({ className: "a" }), props({ className: "a", id: "x" })),
      );
      assert.isFalse(
        shallowPropsEqual(props({ className: "a", id: "x" }), props({ className: "a" })),
      );
      // Same count, different key — caught by the per-key lookup.
      assert.isFalse(shallowPropsEqual(props({ id: "x" }), props({ className: "x" })));
    });

    it("reports a structurally-equal but freshly-allocated object prop as changed", () => {
      // Intentional divergence from structural Equal.equals: inline object props
      // (e.g. style literals) compare by reference, so an equal-but-fresh object
      // re-applies. Harmless because prop application is idempotent.
      assert.isFalse(
        shallowPropsEqual(props({ style: { color: "red" } }), props({ style: { color: "red" } })),
      );
    });
  });

  it("moves an inclusive DOM range before a reference node", () => {
    const parent = document.createElement("div");
    const start = document.createComment("start");
    const first = document.createElement("span");
    first.textContent = "first";
    const second = document.createElement("span");
    second.textContent = "second";
    const end = document.createComment("end");
    const before = document.createElement("strong");
    before.textContent = "before";

    parent.append(before, start, first, second, end);

    moveRange(start, end, before);

    assert.deepStrictEqual(Array.from(parent.childNodes), [start, first, second, end, before]);
  });
});
