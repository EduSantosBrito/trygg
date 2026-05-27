import { assert, describe, it } from "@effect/vitest";
import { Data, Effect, Predicate, Scope } from "effect";
import * as ReactiveMatcher from "../reactive-matcher.js";
import * as Signal from "../signal.js";
import { Element, text, type Element as ElementType } from "../element.js";

type TestState = Data.TaggedEnum<{
  readonly Idle: {};
  readonly Ready: { readonly value: number };
  readonly Failed: { readonly reason: string };
}>;

const TestState = Data.taggedEnum<TestState>();

type SignalElement = Extract<ElementType, { readonly _tag: "SignalElement" }>;
type TextElement = Extract<ElementType, { readonly _tag: "Text" }>;

const isSignalElement = (element: ElementType): element is SignalElement =>
  Predicate.isTagged(element, "SignalElement");

const isTextElement = (element: ElementType): element is TextElement =>
  Predicate.isTagged(element, "Text");

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

    assert.strictEqual(render(TestState.Idle()), "idle");
    assert.strictEqual(render(TestState.Ready({ value: 7 })), "ready:7");
    assert.strictEqual(render(TestState.Failed({ reason: "boom" })), "failed:boom");
  });

  it.effect("wraps derived matcher output in a reactive element", () =>
    Effect.gen(function* () {
      const source = yield* Signal.make<TestState>(TestState.Idle());
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
        Signal.SignalDisposedError,
        Scope.Scope
      >(
        source,
        (source, render) => Signal.derive(source, render),
        (signal) => Element.SignalElement({ signal, onSwap: undefined }),
        render,
      );

      assert.isTrue(isSignalElement(element));
      if (isSignalElement(element)) {
        const initial = yield* Signal.get(element.signal);
        assert.isTrue(isTextElement(initial));
        if (isTextElement(initial)) {
          assert.strictEqual(initial.content, "idle");
        }

        yield* Signal.set(source, TestState.Ready({ value: 3 }));

        const updated = yield* Signal.get(element.signal);
        assert.isTrue(isTextElement(updated));
        if (isTextElement(updated)) {
          assert.strictEqual(updated.content, "ready:3");
        }
      }
    }),
  );
});
