import { assert, describe, it } from "@effect/vitest";
import { Effect, Scope } from "effect";
import * as ReactiveMatcher from "../reactive-matcher.js";
import * as Signal from "../signal.js";
import { Element, text, type Element as ElementType } from "../element.js";

type TestState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Ready"; readonly value: number }
  | { readonly _tag: "Failed"; readonly reason: string };

describe("ReactiveMatcher", () => {
  it("accumulates handlers through pipeable matcher helpers", () => {
    const matcher = ReactiveMatcher.make("TestMatcher", "source", new Map<string, unknown>()).pipe(
      (self) => ({
        ...self,
        handlers: ReactiveMatcher.addHandler(self.handlers, "Idle", () => "idle"),
      }),
      (self) => ({
        ...self,
        handlers: ReactiveMatcher.addHandler(self.handlers, "Ready", () => "ready"),
      }),
    );

    assert.strictEqual(matcher._tag, "TestMatcher");
    assert.strictEqual(matcher.handlers.size, 2);
    assert.isTrue(matcher.handlers.has("Idle"));
    assert.isTrue(matcher.handlers.has("Ready"));
  });

  it("delegates tagged dispatch to Match.tagsExhaustive", () => {
    const render = ReactiveMatcher.tagsExhaustive<TestState, string>({
      Idle: () => "idle",
      Ready: (state) => `ready:${state.value}`,
      Failed: (state) => `failed:${state.reason}`,
    });

    assert.strictEqual(render({ _tag: "Idle" }), "idle");
    assert.strictEqual(render({ _tag: "Ready", value: 7 }), "ready:7");
    assert.strictEqual(render({ _tag: "Failed", reason: "boom" }), "failed:boom");
  });

  it.effect("wraps derived matcher output in a reactive element", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make<TestState>({ _tag: "Idle" });
      const render = ReactiveMatcher.tagsExhaustive<TestState, ElementType>({
        Idle: () => text("idle"),
        Ready: (state) => text(`ready:${state.value}`),
        Failed: (state) => text(`failed:${state.reason}`),
      });

      const element = yield* ReactiveMatcher.toReactiveElement<
        Signal.Signal<TestState>,
        TestState,
        Signal.Signal<ElementType>,
        ElementType,
        never,
        Scope.Scope
      >(
        source,
        (source, render) => Signal.derive(source, render),
        (signal) => Element.SignalElement({ signal, onSwap: undefined }),
        render,
      );

      assert.strictEqual(element._tag, "SignalElement");
      if (element._tag === "SignalElement") {
        const initial = yield* Signal.get(element.signal);
        assert.strictEqual(initial._tag, "Text");
        if (initial._tag === "Text") {
          assert.strictEqual(initial.content, "idle");
        }

        yield* Signal.set(source, { _tag: "Ready", value: 3 });

        const updated = yield* Signal.get(element.signal);
        assert.strictEqual(updated._tag, "Text");
        if (updated._tag === "Text") {
          assert.strictEqual(updated.content, "ready:3");
        }
      }
    }),
  );
});
