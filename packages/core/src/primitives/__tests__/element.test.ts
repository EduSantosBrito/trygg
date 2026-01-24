/**
 * Element Unit Tests
 *
 * Element is the virtual DOM representation for trygg.
 * Tagged enum with: Intrinsic, Text, SignalText, SignalElement, Component, Fragment, Portal, KeyedList
 *
 * Test Categories:
 * - Constructors: intrinsic, text, fragment, portal, keyedList, empty
 * - normalizeChild: Converting various inputs to Element
 * - normalizeChildren: Handling arrays and nested arrays
 * - Utilities: isElement, isEmpty, getKey, keyed
 *
 * Goals: Reliability, stability
 * - Verify all element types construct correctly
 * - Verify normalization handles edge cases
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
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
  normalizeChild,
  normalizeChildren,
  portal,
  text,
} from "../element.js";
import * as Signal from "../signal.js";

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
    assert.strictEqual(element.children.length, 2);
  });
});

// =============================================================================
// keyedList - KeyedList constructor
// =============================================================================
// Scope: Creating KeyedList elements (efficient list rendering)

describe("keyedList", () => {
  it.scoped("should create KeyedList with source signal", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make<ReadonlyArray<string>>([]);
      const renderFn = (item: string) => Effect.succeed(text(item));
      const keyFn = (item: string) => item;

      const element = keyedList(source, renderFn, keyFn);

      assert.strictEqual(element._tag, "KeyedList");
      assert.isDefined(element.source);
    }),
  );

  it.scoped("should store render function", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make<ReadonlyArray<number>>([]);
      const renderFn = (item: number) => Effect.succeed(text(String(item)));
      const keyFn = (item: number) => item;

      const element = keyedList(source, renderFn, keyFn);

      assert.strictEqual(element._tag, "KeyedList");
      assert.isDefined(element.renderFn);
    }),
  );

  it.scoped("should store key function", () =>
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
// normalizeChild - Convert values to Element
// =============================================================================
// Scope: Normalizing various child types to Element

describe("normalizeChild", () => {
  it("should convert string to Text element", () => {
    const element = normalizeChild("hello");

    if (!Element.$is("Text")(element)) {
      return assert.fail("Expected Text element");
    }
    assert.strictEqual(element.content, "hello");
  });

  it("should convert number to Text element", () => {
    const element = normalizeChild(42);

    if (!Element.$is("Text")(element)) {
      return assert.fail("Expected Text element");
    }
    assert.strictEqual(element.content, "42");
  });

  it("should convert null to empty element", () => {
    const element = normalizeChild(null);

    assert.isTrue(isEmpty(element));
  });

  it("should convert undefined to empty element", () => {
    const element = normalizeChild(undefined);

    assert.isTrue(isEmpty(element));
  });

  it("should convert false to empty element", () => {
    const element = normalizeChild(false);

    assert.isTrue(isEmpty(element));
  });

  it("should convert true to empty element", () => {
    const element = normalizeChild(true);

    assert.isTrue(isEmpty(element));
  });

  it("should pass through Element unchanged", () => {
    const original = intrinsic("div", {}, []);
    const element = normalizeChild(original);

    assert.strictEqual(element, original);
  });

  it.scoped("should convert Signal of primitive to SignalText", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make("text value");
      const element = normalizeChild(signal);

      assert.strictEqual(element._tag, "SignalText");
    }),
  );

  it.scoped("should convert Signal of Element to SignalElement", () =>
    Effect.gen(function* () {
      const signal = yield* Signal.make(intrinsic("span", {}, [text("content")]));
      const element = normalizeChild(signal);

      assert.strictEqual(element._tag, "SignalElement");
    }),
  );

  it("should convert Effect to Component element", () => {
    const effect = Effect.succeed(intrinsic("div", {}, []));
    const element = normalizeChild(effect);

    assert.strictEqual(element._tag, "Component");
  });
});

// =============================================================================
// normalizeChildren - Convert array of values to Elements
// =============================================================================
// Scope: Normalizing children arrays including nested arrays

describe("normalizeChildren", () => {
  it("should normalize array of children", () => {
    const children = normalizeChildren(["one", "two", "three"]);

    assert.strictEqual(children.length, 3);
    assert.strictEqual(children[0]?._tag, "Text");
    assert.strictEqual(children[1]?._tag, "Text");
    assert.strictEqual(children[2]?._tag, "Text");
  });

  it("should flatten nested arrays", () => {
    const children = normalizeChildren([["a", "b"], "c"]);

    assert.strictEqual(children.length, 3);
    const [c0, c1, c2] = children;
    if (!Element.$is("Text")(c0) || !Element.$is("Text")(c1) || !Element.$is("Text")(c2)) {
      return assert.fail("Expected Text elements");
    }
    assert.strictEqual(c0.content, "a");
    assert.strictEqual(c1.content, "b");
    assert.strictEqual(c2.content, "c");
  });

  it("should filter out empty elements", () => {
    const children = normalizeChildren(["text", null, undefined, false, "more"]);

    assert.strictEqual(children.length, 2);
    const [c0, c1] = children;
    if (!Element.$is("Text")(c0) || !Element.$is("Text")(c1)) {
      return assert.fail("Expected Text elements");
    }
    assert.strictEqual(c0.content, "text");
    assert.strictEqual(c1.content, "more");
  });

  it("should return empty array for null input", () => {
    const children = normalizeChildren(null);

    assert.strictEqual(children.length, 0);
  });

  it("should wrap single child in array", () => {
    const children = normalizeChildren("single");

    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0]?._tag, "Text");
  });
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

  it("should return true for Component element", () => {
    const element = Element.Component({
      run: () => Effect.succeed(text("component")),
      key: null,
    });

    assert.isTrue(isElement(element));
  });

  it("should return false for plain objects", () => {
    const obj = { _tag: "Custom", value: 42 };

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

  it("should return key from Component element", () => {
    const element = Element.Component({
      run: () => Effect.succeed(text("comp")),
      key: "component-key",
    });

    assert.strictEqual(getKey(element), "component-key");
  });

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

  it("should add key to Component element", () => {
    const original = Element.Component({
      run: () => Effect.succeed(text("comp")),
      key: null,
    });
    const withKey = keyed("comp-key", original);

    assert.strictEqual(withKey._tag, "Component");
    assert.strictEqual(getKey(withKey), "comp-key");
  });

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
