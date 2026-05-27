// @vitest-environment happy-dom

import { Effect, Layer, Schema } from "effect";
import { assert, describe, it, vi } from "@effect/vitest";
import * as Router from "trygg/router";
import { click, renderElement, testLayer, waitFor } from "trygg/testing";

import HomePage from "./home";

class MissingInstallCopyButton extends Schema.TaggedErrorClass<MissingInstallCopyButton>()(
  "MissingInstallCopyButton",
  {},
) {}

const renderHome = () =>
  renderElement(<HomePage />).pipe(Effect.provide(Layer.merge(testLayer, Router.testLayer("/"))));

describe("HomePage", () => {
  it.effect("presents trygg as an Effect-native UI framework", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const result = yield* renderHome();
        const text = result.container.textContent ?? "";

        assert.include(text, "All in the type.");
        assert.include(text, "Define an API. Use it in JSX.");
        assert.include(text, "Build something and read the types.");
      }),
    ),
  );

  it.effect("renders the primary docs path and canary badge", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const result = yield* renderHome();
        const text = result.container.textContent ?? "";

        assert.isNotNull(result.container.querySelector('a[href="/docs/getting-started"]'));
        assert.include(text, "Canary");
      }),
    ),
  );

  it.effect("renders a compact typed seam", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const result = yield* renderHome();
        const text = result.container.textContent ?? "";

        assert.include(text, "Plain Effect API");
        assert.include(text, "Component + DI");
        assert.include(text, "Resource.match");
        assert.include(text, "Resource.fetch(users)");
      }),
    ),
  );

  it.effect("copies the canary create command", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });

        const result = yield* renderHome();
        const copyButton = result.container.querySelector(
          '[aria-label="Installation command"] button[aria-label="Copy command to clipboard"]',
        );

        if (!(copyButton instanceof HTMLElement)) {
          return yield* new MissingInstallCopyButton();
        }

        yield* click(copyButton);

        assert.deepStrictEqual(writeText.mock.calls[0], ["bunx create-trygg@canary my-app"]);
        yield* waitFor(() => {
          assert.strictEqual(copyButton.getAttribute("aria-label"), "Command copied");
          return true;
        });
      }),
    ),
  );
});
