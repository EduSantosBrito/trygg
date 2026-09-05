/**
 * Element Unit Tests
 *
 * Element is the virtual DOM representation for trygg.
 * Tagged enum with: Intrinsic, Text, SignalText, SignalElement, Component, Fragment, Portal, KeyedList
 *
 * Test Categories:
 * - Constructors: intrinsic, text, fragment, portal, keyedList, empty
 * - Element.fromUnknown: Converting various inputs to Element
 * - Element.fromChildren: Handling arrays and nested arrays
 * - Utilities: isElement, isEmpty, getKey, keyed
 *
 * Goals: Reliability, stability
 * - Verify all element types construct correctly
 * - Verify normalization handles edge cases
 */
import { assert, describe, effect, it } from "@effect/vitest";
import { Data, Effect, Predicate, Schema } from "effect";
import {
  Element,
  empty,
  fragment,
  getKey,
  intrinsic,
  isElement,
  isEmpty,
  keyed,
  keyedList,
  portal,
  text,
} from "../element.js";
import * as Signal from "../signal.js";

class BoomError extends Schema.TaggedError<BoomError>()("BoomError", {
  message: Schema.String,
}) {}

class Custom extends Data.TaggedClass("Custom")<{ readonly value: number }> {}

// =============================================================================
// intrinsic - HTML element constructor
// =============================================================================
// Scope: Creating Intrinsic elements for HTML tags

describe("intrinsic", () => {
  it("should create Intrinsic element with tag name", () => {
    const element = intrinsic("div", {}, []);

    assert.strictEqual(element._tag, "Intrinsic");
    assert.strictEqual(element.tag, "div");
  });

  it("should store props on element", () => {
    const props = { className: "test", id: "my-id" };
    const element = intrinsic("div", props, []);

    assert.strictEqual(element._tag, "Intrinsic");
    assert.strictEqual(element.props.className, "test");
    assert.strictEqual(element.props.id, "my-id");
  });

  it("should store children array on element", () => {
    const children = [text("child 1"), text("child 2")];
    const element = intrinsic("div", {}, children);

    assert.strictEqual(element._tag, "Intrinsic");
    assert.strictEqual(element.children.length, 2);
    assert.strictEqual(element.children[0]?._tag, "Text");
    assert.strictEqual(element.children[1]?._tag, "Text");
  });

  it("should store key for list reconciliation", () => {
    const element = intrinsic("div", {}, [], "my-key");

    assert.strictEqual(element._tag, "Intrinsic");
    assert.strictEqual(element.key, "my-key");
  });

  it("should default key to null when not provided", () => {
    const element = intrinsic("div", {}, []);

    assert.strictEqual(element._tag, "Intrinsic");
    assert.isNull(element.key);
  });
});

// =============================================================================
// text - Text node constructor
// =============================================================================
// Scope: Creating Text elements

describe("text", () => {
  it("should create Text element with content", () => {
    const element = text("Hello World");

    assert.strictEqual(element._tag, "Text");
    assert.strictEqual(element.content, "Hello World");
  });

  it("should handle empty string content", () => {
    const element = text("");

    assert.strictEqual(element._tag, "Text");
    assert.strictEqual(element.content, "");
  });
});

// =============================================================================
// Element.fromEffect - Effect-backed component constructor
// =============================================================================
// Scope: Constructing Component elements from Effect values without thunk-based DX

describe("Element.fromEffect", () => {
  it.effect("should create Component element while preserving reconciliation metadata", () =>
    Effect.sync(() => {
      // Test: should create Component element while preserving reconciliation metadata.
      // Scope: verifies the Effect-native constructor path for low-level component elements without exposing thunk-based call sites.
      // Assertion: returns a Component element and preserves the provided key, identity, and inputs.
      const identity = { name: "identity" };
      const inputs = { id: 1 };

      const element = Element.fromEffect(Effect.succeed(text("component")), {
        key: "component-key",
        identity,
        inputs,
      });

      assert.isTrue(Predicate.isTagged(element, "Component"));
      if (!Predicate.isTagged(element, "Component")) {
        return assert.fail("Expected Component element");
      }

      assert.strictEqual(element.key, "component-key");
      assert.strictEqual(element.identity, identity);
      assert.strictEqual(element.inputs, inputs);
    }),
  );

  it.effect("should create Component failure element while preserving explicit key metadata", () =>
    Effect.sync(() => {
      // Test: should create Component failure element while preserving explicit key metadata.
      // Scope: verifies the convenience failure constructor produces the same component shell shape used by lazy render-time failures.
      // Assertion: returns a Component element immediately and preserves the provided key metadata.
      const error = new BoomError({ message: "boom" });
      const element = Element.fail(error, { key: "boom-key" });

      assert.isTrue(Predicate.isTagged(element, "Component"));
      if (!Predicate.isTagged(element, "Component")) {
        return assert.fail("Expected Component element");
      }

      assert.strictEqual(element.key, "boom-key");
    }),
  );
});

describe("Element.fromUnknown", () => {
  it.effect("should create Text element while normalizing string child inputs", () =>
    Effect.gen(function* () {
      // Test: should create Text element while normalizing string child inputs.
      // Scope: verifies the new Effect-native child constructor keeps primitive child coercion inside the current Effect pipeline.
      // Assertion: normalizing a string yields a Text element with the same content.
      const element = yield* Element.fromUnknown("hello");

      assert.isTrue(Predicate.isTagged(element, "Text"));
      if (!Predicate.isTagged(element, "Text")) {
        return assert.fail("Expected Text element");
      }

      assert.strictEqual(element.content, "hello");
    }),
  );
});

describe("Element.fromChildren", () => {
  it.effect("should flatten nested child arrays while dropping empty values", () =>
    Effect.gen(function* () {
      // Test: should flatten nested child arrays while dropping empty values.
      // Scope: verifies the new Effect-native child collection constructor preserves the existing child-shaping rules used by JSX internals.
      // Assertion: nested children flatten into only the observable non-empty Text elements.
      const children = yield* Element.fromChildren(["a", [null, "b"], false]);

      assert.strictEqual(children.length, 2);
      assert.strictEqual(children[0]?._tag, "Text");
      assert.strictEqual(children[1]?._tag, "Text");
    }),
  );
});

// =============================================================================
// fragment - Fragment constructor
// =============================================================================
// Scope: Creating Fragment elements (multiple children, no wrapper)

describe("fragment", () => {
  it("should create Fragment element with children", () => {
    const children = [text("one"), text("two")];
    const element = fragment(children);

    assert.strictEqual(element._tag, "Fragment");
    assert.strictEqual(element.children.length, 2);
  });

  it("should create empty fragment with empty array", () => {
    const element = fragment([]);

    assert.strictEqual(element._tag, "Fragment");
    assert.strictEqual(element.children.length, 0);
  });
});

// =============================================================================
// portal - Portal constructor
// =============================================================================
// Scope: Creating Portal elements (render into different container)

describe("portal", () => {
  it("should create Portal with HTMLElement target", () => {
    const target = document.createElement("div");
    const children = [text("portal content")];
    const element = portal(target, children);

    assert.strictEqual(element._tag, "Portal");
    assert.strictEqual(element.target, target);
  });

  it("should create Portal with CSS selector target", () => {
    const selector = "#modal-root";
    const children = [text("portal content")];
    const element = portal(selector, children);

    assert.strictEqual(element._tag, "Portal");
    assert.strictEqual(element.target, selector);
  });

  it("should store children for portal", () => {
    const target = "#target";
    const children = [text("child 1"), text("child 2")];
    const element = portal(target, children);

    assert.strictEqual(element._tag, "Portal");
    assert.deepStrictEqual(element.children, children);
  });
});

// =============================================================================
// keyedList - KeyedList constructor
// =============================================================================
// Scope: Creating KeyedList elements (efficient list rendering)

describe("keyedList", () => {
  effect("should create KeyedList with source signal", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make<ReadonlyArray<string>>([]);
      const renderFn = (item: string) => Effect.succeed(text(item));
      const keyFn = (item: string) => item;

      const element = keyedList(source, renderFn, keyFn);

      assert.strictEqual(element._tag, "KeyedList");
      assert.isDefined(element.source);
    }),
  );

  effect("should store render function", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make<ReadonlyArray<number>>([]);
      const renderFn = (item: number) => Effect.succeed(text(String(item)));
      const keyFn = (item: number) => item;

      const element = keyedList(source, renderFn, keyFn);

      assert.strictEqual(element._tag, "KeyedList");
      assert.isDefined(element.renderFn);
    }),
  );

  effect("should store key function", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make<ReadonlyArray<{ id: number }>>([]);
      const renderFn = (item: { id: number }) => Effect.succeed(text(String(item.id)));
      const keyFn = (item: { id: number }) => item.id;

      const element = keyedList(source, renderFn, keyFn);

      assert.strictEqual(element._tag, "KeyedList");
      assert.isDefined(element.keyFn);
    }),
  );
});

// =============================================================================
// empty - Empty element singleton
// =============================================================================
// Scope: Empty fragment constant

describe("empty", () => {
  it("should be an empty Fragment", () => {
    if (!Element.$is("Fragment")(empty)) {
      return assert.fail("Expected Fragment element");
    }
    assert.strictEqual(empty.children.length, 0);
  });

  it("should be a singleton instance", () => {
    const empty1 = empty;
    const empty2 = empty;

    assert.strictEqual(empty1, empty2);
  });
});

// =============================================================================
// Element.fromUnknown - Convert values to Element
// =============================================================================
// Scope: Normalizing various child types to Element

describe("Element.fromUnknown", () => {
  it.effect("should convert number to Text element while normalizing primitive child inputs", () =>
    Effect.gen(function* () {
      // Test: should convert number to Text element while normalizing primitive child inputs.
      // Scope: verifies numeric child coercion stays inside the Effect-native child boundary.
      // Assertion: numeric children normalize to Text with stringified content.
      const element = yield* Element.fromUnknown(42);

      if (!Element.$is("Text")(element)) {
        return assert.fail("Expected Text element");
      }
      assert.strictEqual(element.content, "42");
    }),
  );

  it.effect("should convert nullish and boolean empties while normalizing child inputs", () =>
    Effect.gen(function* () {
      // Test: should convert nullish and boolean empties while normalizing child inputs.
      // Scope: verifies empty child cases still collapse to the canonical empty element under the Effect-native constructor.
      // Assertion: null, undefined, false, and true normalize to empty elements.
      const nullElement = yield* Element.fromUnknown(null);
      const undefinedElement = yield* Element.fromUnknown(undefined);
      const falseElement = yield* Element.fromUnknown(false);
      const trueElement = yield* Element.fromUnknown(true);

      assert.isTrue(isEmpty(nullElement));
      assert.isTrue(isEmpty(undefinedElement));
      assert.isTrue(isEmpty(falseElement));
      assert.isTrue(isEmpty(trueElement));
    }),
  );

  it.effect("should pass through existing Element values while normalizing child inputs", () =>
    Effect.gen(function* () {
      // Test: should pass through existing Element values while normalizing child inputs.
      // Scope: verifies the boundary does not rebuild already-normalized elements.
      // Assertion: existing Element values are returned by reference.
      const original = intrinsic("div", {}, []);
      const element = yield* Element.fromUnknown(original);

      assert.strictEqual(element, original);
    }),
  );

  it.effect("should convert Signal of primitive to SignalText while normalizing child inputs", () =>
    Effect.gen(function* () {
      // Test: should convert Signal of primitive to SignalText while normalizing child inputs.
      // Scope: verifies reactive primitive children still lower to SignalText inside the Effect-native boundary.
      // Assertion: primitive signals normalize to SignalText.
      const signal = yield* Signal.make("text value");
      const element = yield* Element.fromUnknown(signal);

      assert.strictEqual(element._tag, "SignalText");
    }),
  );

  it.effect(
    "should convert Signal of Element to SignalElement while normalizing child inputs",
    () =>
      Effect.gen(function* () {
        // Test: should convert Signal of Element to SignalElement while normalizing child inputs.
        // Scope: verifies reactive element children still lower to SignalElement inside the Effect-native boundary.
        // Assertion: element signals normalize to SignalElement.
        const signal = yield* Signal.make(intrinsic("span", {}, [text("content")]));
        const element = yield* Element.fromUnknown(signal);

        assert.strictEqual(element._tag, "SignalElement");
      }),
  );

  it.effect(
    "should convert raw Effect child inputs to lazy failure components while normalizing children",
    () =>
      Effect.gen(function* () {
        // Test: should convert raw Effect child inputs to lazy failure components while normalizing children.
        // Scope: verifies the child boundary keeps rejecting raw Effects while staying in the Effect pipeline.
        // Assertion: raw Effect child inputs normalize to Component failure shells.
        const effectChild = Effect.succeed(intrinsic("div", {}, []));
        const element = yield* Element.fromUnknown(effectChild);

        assert.strictEqual(element._tag, "Component");
      }),
  );
});

// =============================================================================
// Element.fromChildren - Convert array of values to Elements
// =============================================================================
// Scope: Normalizing children arrays including nested arrays

describe("Element.fromChildren", () => {
  it.effect("should normalize flat child arrays while preserving order", () =>
    Effect.gen(function* () {
      // Test: should normalize flat child arrays while preserving order.
      // Scope: verifies the collection constructor preserves sequential child ordering in the Effect-native path.
      // Assertion: flat primitive arrays normalize into ordered Text elements.
      const children = yield* Element.fromChildren(["one", "two", "three"]);

      assert.strictEqual(children.length, 3);
      assert.strictEqual(children[0]?._tag, "Text");
      assert.strictEqual(children[1]?._tag, "Text");
      assert.strictEqual(children[2]?._tag, "Text");
    }),
  );

  it.effect("should flatten nested child arrays while normalizing children", () =>
    Effect.gen(function* () {
      // Test: should flatten nested child arrays while normalizing children.
      // Scope: verifies nested child collections keep the same flattening semantics after moving to the Effect-native API.
      // Assertion: nested child arrays flatten into ordered Text elements.
      const children = yield* Element.fromChildren([["a", "b"], "c"]);

      assert.strictEqual(children.length, 3);
      const [c0, c1, c2] = children;
      if (!Element.$is("Text")(c0) || !Element.$is("Text")(c1) || !Element.$is("Text")(c2)) {
        return assert.fail("Expected Text elements");
      }
      assert.strictEqual(c0.content, "a");
      assert.strictEqual(c1.content, "b");
      assert.strictEqual(c2.content, "c");
    }),
  );

  it.effect("should drop empty child values while normalizing collections", () =>
    Effect.gen(function* () {
      // Test: should drop empty child values while normalizing collections.
      // Scope: verifies nullish and boolean empties are still removed from child arrays in the Effect-native collection boundary.
      // Assertion: only observable text children remain.
      const children = yield* Element.fromChildren(["text", null, undefined, false, "more"]);

      assert.strictEqual(children.length, 2);
      const [c0, c1] = children;
      if (!Element.$is("Text")(c0) || !Element.$is("Text")(c1)) {
        return assert.fail("Expected Text elements");
      }
      assert.strictEqual(c0.content, "text");
      assert.strictEqual(c1.content, "more");
    }),
  );

  it.effect("should return empty array while normalizing null child collections", () =>
    Effect.gen(function* () {
      // Test: should return empty array while normalizing null child collections.
      // Scope: verifies missing child collections stay empty in the Effect-native collection constructor.
      // Assertion: null child collections normalize to an empty array.
      const children = yield* Element.fromChildren(null);

      assert.strictEqual(children.length, 0);
    }),
  );

  it.effect("should wrap single child values while normalizing collections", () =>
    Effect.gen(function* () {
      // Test: should wrap single child values while normalizing collections.
      // Scope: verifies non-array child inputs still normalize into a one-element collection.
      // Assertion: a single primitive child normalizes into a single Text element.
      const children = yield* Element.fromChildren("single");

      assert.strictEqual(children.length, 1);
      assert.strictEqual(children[0]?._tag, "Text");
    }),
  );
});

// =============================================================================
// isElement - Type guard
// =============================================================================
// Scope: Checking if value is an Element

describe("isElement", () => {
  it("should return true for Intrinsic element", () => {
    const element = intrinsic("div", {}, []);

    assert.isTrue(isElement(element));
  });

  it("should return true for Text element", () => {
    const element = text("hello");

    assert.isTrue(isElement(element));
  });

  it("should return true for Fragment element", () => {
    const element = fragment([]);

    assert.isTrue(isElement(element));
  });

  it.effect("should return true for Component element", () =>
    Effect.sync(() => {
      const element = Element.Component({
        run: () => Effect.succeed(text("component")),
        key: null,
        identity: undefined,
        inputs: undefined,
      });

      assert.isTrue(isElement(element));
    }),
  );

  it("should return false for plain objects", () => {
    const obj = new Custom({ value: 42 });

    assert.isFalse(isElement(obj));
  });

  it("should return false for null", () => {
    assert.isFalse(isElement(null));
  });

  it("should return false for primitives", () => {
    assert.isFalse(isElement("string"));
    assert.isFalse(isElement(123));
    assert.isFalse(isElement(true));
  });
});

// =============================================================================
// isEmpty - Check for empty element
// =============================================================================
// Scope: Detecting empty fragments

describe("isEmpty", () => {
  it("should return true for empty fragment", () => {
    const element = fragment([]);

    assert.isTrue(isEmpty(element));
  });

  it("should return false for non-empty fragment", () => {
    const element = fragment([text("content")]);

    assert.isFalse(isEmpty(element));
  });

  it("should return false for non-fragment elements", () => {
    assert.isFalse(isEmpty(text("text")));
    assert.isFalse(isEmpty(intrinsic("div", {}, [])));
  });
});

// =============================================================================
// getKey - Extract key from element
// =============================================================================
// Scope: Getting reconciliation key from elements

describe("getKey", () => {
  it("should return key from Intrinsic element", () => {
    const element = intrinsic("div", {}, [], "my-key");

    assert.strictEqual(getKey(element), "my-key");
  });

  it.effect("should return key from Component element", () =>
    Effect.sync(() => {
      const element = Element.Component({
        run: () => Effect.succeed(text("comp")),
        key: "component-key",
        identity: undefined,
        inputs: undefined,
      });

      assert.strictEqual(getKey(element), "component-key");
    }),
  );

  it("should return null for unkeyed elements", () => {
    const element = intrinsic("div", {}, []);

    assert.isNull(getKey(element));
  });

  it("should return null for element types without key support", () => {
    assert.isNull(getKey(text("text")));
    assert.isNull(getKey(fragment([])));
  });
});

// =============================================================================
// keyed - Add key to element
// =============================================================================
// Scope: Adding reconciliation key to elements

describe("keyed", () => {
  it("should add key to Intrinsic element", () => {
    const original = intrinsic("div", {}, []);
    const withKey = keyed("new-key", original);

    assert.strictEqual(withKey._tag, "Intrinsic");
    assert.strictEqual(getKey(withKey), "new-key");
  });

  it.effect("should add key to Component element", () =>
    Effect.sync(() => {
      const original = Element.Component({
        run: () => Effect.succeed(text("comp")),
        key: null,
        identity: undefined,
        inputs: undefined,
      });
      const withKey = keyed("comp-key", original);

      assert.strictEqual(withKey._tag, "Component");
      assert.strictEqual(getKey(withKey), "comp-key");
    }),
  );

  it("should return element unchanged for unsupported types", () => {
    const original = text("text");
    const result = keyed("ignored", original);

    assert.strictEqual(result, original);
    assert.isNull(getKey(result));
  });

  it("should replace existing key", () => {
    const original = intrinsic("div", {}, [], "old-key");
    const withNewKey = keyed("new-key", original);

    assert.strictEqual(getKey(withNewKey), "new-key");
  });
});
