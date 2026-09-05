/**
 * Dom Service Tests
 *
 * Shared conformance cases for the browser and test layers.
 */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { Dom, DomError, browser as domBrowser, test as domTest } from "../dom.js";

const adapters: ReadonlyArray<readonly [string, Layer.Layer<Dom>]> = [
  ["browser", domBrowser],
  ["test", domTest],
];

for (const [name, layer] of adapters) {
  describe(`Dom ${name} adapter conformance`, () => {
    it.effect("should perform observable tree mutations", () =>
      Effect.gen(function* () {
        // Test: should perform observable tree mutations through every Dom adapter.
        // Scope: verifies append, insert, replace, and remove semantics at the port boundary.
        // Assertion: each successful operation produces the corresponding native tree state.
        const dom = yield* Dom;
        const parent = yield* dom.createElement("div");
        const first = yield* dom.createElement("span");
        const second = yield* dom.createTextNode("second");
        const replacement = yield* dom.createComment("replacement");

        yield* dom.appendChild(parent, first);
        yield* dom.insertBefore(parent, second, first);
        assert.deepStrictEqual(Array.from(parent.childNodes), [second, first]);

        yield* dom.replaceChild(parent, replacement, first);
        assert.deepStrictEqual(Array.from(parent.childNodes), [second, replacement]);

        yield* dom.remove(second);
        assert.deepStrictEqual(Array.from(parent.childNodes), [replacement]);
      }).pipe(Effect.provide(layer)),
    );

    it.effect("should perform observable attribute property style and selector operations", () =>
      Effect.gen(function* () {
        // Test: should perform observable attribute property style and selector operations through every Dom adapter.
        // Scope: covers mutable element state and subtree-isolated query behavior.
        // Assertion: successful writes are readable and selectors return only matches from the supplied root.
        const dom = yield* Dom;
        const root = yield* dom.createElement("section");
        const child = yield* dom.createElement("input");
        yield* dom.setAttribute(child, "data-role", "field");
        yield* dom.setProperty(child, "value", "hello");
        yield* dom.assignStyle(child, { color: "red" });
        yield* dom.appendChild(root, child);

        assert.strictEqual(yield* dom.getAttribute(child, "data-role"), "field");
        if (!(child instanceof HTMLInputElement)) {
          return assert.fail(`Expected HTMLInputElement, got ${child.tagName}`);
        }
        assert.strictEqual(child.value, "hello");
        assert.strictEqual(child.style.color, "red");
        assert.strictEqual(yield* dom.querySelector('[data-role="field"]', root), child);
        assert.deepStrictEqual(Array.from(yield* dom.querySelectorAll("input", root)), [child]);
        assert.isTrue(yield* dom.matches(child, '[data-role="field"]'));

        yield* dom.removeAttribute(child, "data-role");
        assert.isNull(yield* dom.getAttribute(child, "data-role"));
      }).pipe(Effect.provide(layer)),
    );

    it.effect("should expose the current document structure and global lookup", () =>
      Effect.gen(function* () {
        // Test: should expose the current document structure and global lookup through every Dom adapter.
        // Scope: covers document-owned values that test doubles previously replaced with detached constants.
        // Assertion: getters return the live document nodes and getElementById observes attached elements.
        const dom = yield* Dom;
        const marker = yield* dom.createElement("div");
        marker.id = `dom-conformance-${name}`;
        document.body.appendChild(marker);
        yield* Effect.addFinalizer(() => Effect.sync(() => marker.remove()));

        assert.strictEqual(yield* dom.head, document.head);
        assert.strictEqual(yield* dom.body, document.body);
        assert.strictEqual(yield* dom.documentElement, document.documentElement);
        assert.strictEqual(yield* dom.activeElement, document.activeElement);
        assert.strictEqual(yield* dom.getElementById(marker.id), marker);
      }).pipe(Effect.provide(layer)),
    );
  });
}

describe("Dom browser failures", () => {
  it.effect("should fail with DomError while Reflect.set reports false", () =>
    Effect.gen(function* () {
      // Test: should fail with DomError while Reflect.set reports false.
      // Scope: covers the JavaScript property protocol where no throw accompanies a rejected write.
      // Assertion: setProperty does not report success and identifies the failed operation.
      const dom = yield* Dom;
      const target = Object.preventExtensions({});
      const exit = yield* Effect.exit(dom.setProperty(target, "missing", 1));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
        assert.instanceOf(error, DomError);
        assert.strictEqual(error?.operation, "setProperty");
      }
    }).pipe(Effect.provide(domBrowser)),
  );

  it.effect("should fail without widening an invalid query root to document", () =>
    Effect.gen(function* () {
      // Test: should fail without widening an invalid query root to document.
      // Scope: protects selector isolation when an untyped JavaScript caller supplies a hostile root.
      // Assertion: querySelectorAll fails with DomError and never returns the document-level sentinel.
      const dom = yield* Dom;
      const sentinel = document.createElement("div");
      sentinel.className = "document-only-sentinel";
      document.body.appendChild(sentinel);
      yield* Effect.addFinalizer(() => Effect.sync(() => sentinel.remove()));

      // oxlint-disable-next-line effect/no-type-casting -- Deliberately bypasses the typed ParentNode boundary to verify hostile JavaScript input containment.
      const invalidRoot = {} as ParentNode;
      const exit = yield* Effect.exit(dom.querySelectorAll(".document-only-sentinel", invalidRoot));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
        assert.instanceOf(error, DomError);
        assert.strictEqual(error?.operation, "querySelectorAll");
      }
    }).pipe(Effect.provide(domBrowser)),
  );

  it.effect("should fail when a required document structural element is absent", () =>
    Effect.gen(function* () {
      // Test: should fail when a required document structural element is absent.
      // Scope: verifies the non-null Dom service contract against a not-ready document.
      // Assertion: head produces a typed DomError instead of succeeding with a hidden null.
      const dom = yield* Dom;
      const originalDocument = globalThis.document;
      const notReady = document.implementation.createHTMLDocument("not-ready");
      notReady.head?.remove();

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          Object.defineProperty(globalThis, "document", {
            configurable: true,
            writable: true,
            value: notReady,
          });
        }),
        () =>
          Effect.sync(() => {
            Object.defineProperty(globalThis, "document", {
              configurable: true,
              writable: true,
              value: originalDocument,
            });
          }),
      );

      const exit = yield* Effect.exit(dom.head);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
        assert.instanceOf(error, DomError);
        assert.strictEqual(error?.operation, "head");
      }
    }).pipe(Effect.provide(domBrowser)),
  );
});
