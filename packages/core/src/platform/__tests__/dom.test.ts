/**
 * Dom Service Tests
 *
 * Tests the in-memory test layer for Dom.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Dom, test as domTest } from "../dom.js";

describe("Dom", () => {
  it.effect("createElement returns object with tagName", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const el = yield* dom.createElement("div");
      assert.strictEqual(el.tagName, "DIV");
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("createComment returns comment node", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const comment = yield* dom.createComment("hello");
      assert.strictEqual(comment.nodeType, 8);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("createTextNode returns text node", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const text = yield* dom.createTextNode("content");
      assert.strictEqual(text.nodeType, 3);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("createFragment returns document fragment", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const frag = yield* dom.createFragment();
      assert.strictEqual(frag.nodeType, 11);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("appendChild is a no-op in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const parent = yield* dom.createElement("div");
      const child = yield* dom.createElement("span");
      // Should not throw
      yield* dom.appendChild(parent, child);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("remove is a no-op in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const el = yield* dom.createElement("div");
      yield* dom.remove(el);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("setAttribute is a no-op in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const el = yield* dom.createElement("div");
      yield* dom.setAttribute(el, "id", "test");
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("getAttribute returns null in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const el = yield* dom.createElement("div");
      const attr = yield* dom.getAttribute(el, "id");
      assert.strictEqual(attr, null);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("querySelector returns null in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const result = yield* dom.querySelector(".missing");
      assert.strictEqual(result, null);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("getElementById returns null in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const result = yield* dom.getElementById("missing");
      assert.strictEqual(result, null);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("head returns mock head element", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const head = yield* dom.head;
      assert.strictEqual(head.tagName, "HEAD");
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("body returns mock body element", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const body = yield* dom.body;
      assert.strictEqual(body.tagName, "BODY");
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("documentElement returns mock html element", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const html = yield* dom.documentElement;
      assert.strictEqual(html.tagName, "HTML");
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("activeElement returns null in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const active = yield* dom.activeElement;
      assert.strictEqual(active, null);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("matches returns false in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const el = yield* dom.createElement("div");
      const result = yield* dom.matches(el, ".some-class");
      assert.strictEqual(result, false);
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("setProperty is a no-op in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const el = yield* dom.createElement("input");
      yield* dom.setProperty(el, "value", "hello");
    }).pipe(Effect.provide(domTest)),
  );

  it.effect("assignStyle is a no-op in test layer", () =>
    Effect.gen(function* () {
      const dom = yield* Dom;
      const el = yield* dom.createElement("div");
      yield* dom.assignStyle(el, { color: "red" });
    }).pipe(Effect.provide(domTest)),
  );
});
