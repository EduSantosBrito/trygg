// @vitest-environment happy-dom
import { Context, Effect, Exit, Layer, Redacted, Scope } from "effect";
import { HttpClientRequest } from "effect/unstable/http";
import { assert, it } from "@effect/vitest";
import { Component, Signal } from "trygg";
import { click, render, testLayer } from "trygg/testing";
import {
  MutationAccess,
  MutationAccessError,
} from "../../templates/incident/app/services/mutation-access";
import { MutationAccessForm } from "../../templates/incident/app/components/mutation-access-form";

it.effect("should clear retained credentials on owner shutdown and reject late writes", () =>
  Effect.gen(function* () {
    // Scope: a retained client service outlives its application Scope.
    // Assertion: shutdown removes its credential and late writes cannot restore authority.
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(MutationAccess.layer, scope);
    const access = Context.get(context, MutationAccess);
    yield* access.setToken(Redacted.make("test-access-token-with-at-least-32-characters"));
    const request = HttpClientRequest.post("/api/incidents");
    assert.isDefined((yield* access.authorize(request)).headers.authorization);
    yield* Scope.close(scope, Exit.void);
    assert.isUndefined((yield* access.authorize(request)).headers.authorization);
    const error = yield* access
      .setToken(Redacted.make("test-access-token-with-at-least-32-characters"))
      .pipe(Effect.flip);
    assert.instanceOf(error, MutationAccessError);
    assert.isUndefined((yield* access.authorize(request)).headers.authorization);
  }),
);

it.effect(
  "should submit the real password form without retaining its input and forget the credential",
  () =>
    Effect.gen(function* () {
      // Scope: renders the actual template credential form and drives native submit/click events.
      // Assertion: submission clears the password field, updates presence, and forgetting removes the outgoing header.
      const access = yield* MutationAccess;
      const View = Component.gen(function* () {
        return <MutationAccessForm />;
      });
      const { container } = yield* render(<View />);
      const input = container.querySelector("input");
      const submit = container.querySelector('button[type="submit"]');
      const forget = container.querySelector('button[type="button"]');
      if (
        !(input instanceof HTMLInputElement) ||
        !(submit instanceof HTMLButtonElement) ||
        !(forget instanceof HTMLButtonElement)
      )
        return assert.fail("Expected credential form controls");
      input.value = "test-access-token-with-at-least-32-characters";
      yield* click(submit);
      assert.strictEqual(input.value, "");
      assert.isTrue(yield* Signal.peek(access.configured));
      assert.isDefined(
        (yield* access.authorize(HttpClientRequest.post("/api/incidents"))).headers.authorization,
      );
      yield* click(forget);
      assert.isFalse(yield* Signal.peek(access.configured));
      assert.isUndefined(
        (yield* access.authorize(HttpClientRequest.post("/api/incidents"))).headers.authorization,
      );
    }).pipe(Effect.provide(Layer.merge(testLayer, MutationAccess.layer))),
);
