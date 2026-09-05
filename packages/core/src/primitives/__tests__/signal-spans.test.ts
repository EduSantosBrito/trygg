import { assert, describe } from "@effect/vitest";
import { Effect, Option, Predicate, Tracer } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import * as Signal from "../signal.js";

describe("signal operation spans", () => {
  scoped("should create independent derivation spans while callers have different parents", () =>
    Effect.gen(function* () {
      // Scope: reusable span combinators must create a new lifecycle in the caller's context.
      // Assertion: both derivations have distinct, ended spans under the correct parent.
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      yield* Effect.gen(function* () {
        const source = yield* Signal.make(2);
        const first = yield* Signal.derive(source, (value) => value * 2).pipe(
          Effect.withSpan("first"),
        );
        const second = yield* Signal.derive(source, (value) => value * 3).pipe(
          Effect.withSpan("second"),
        );
        assert.strictEqual(yield* Signal.peek(first), 4);
        assert.strictEqual(yield* Signal.peek(second), 6);
      }).pipe(Effect.provideService(Tracer.Tracer, tracer));
      const derived = spans.filter((span) => span.name === "Signal.derive");
      assert.strictEqual(derived.length, 2);
      assert.notStrictEqual(derived[0]?.spanId, derived[1]?.spanId);
      assert.deepStrictEqual(
        derived.map((span) =>
          Option.isSome(span.parent) && Predicate.isTagged(span.parent.value, "Span")
            ? span.parent.value.name
            : undefined,
        ),
        ["first", "second"],
      );
      assert.isTrue(derived.every((span) => Predicate.isTagged(span.status, "Ended")));
    }),
  );
});
