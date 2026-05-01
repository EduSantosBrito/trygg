// @vitest-environment happy-dom

import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as Router from "trygg/router";
import { click, renderElement, testLayer, waitFor } from "trygg/testing";

import HomePage from "./home";

const renderHome = () =>
  renderElement(<HomePage />).pipe(Effect.provide(Layer.merge(testLayer, Router.testLayer("/"))));

describe("HomePage", () => {
  it("presents trygg as an Effect-native UI framework", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderHome();

          expect(result.container.textContent).toContain("All in the type.");
          expect(result.container.textContent).toContain("Define an API. Use it in JSX.");
          expect(result.container.textContent).toContain("Build something and read the types.");
        }),
      ),
    );
  });

  it("renders the primary docs path and canary badge", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderHome();

          expect(result.container.querySelector('a[href="/docs/getting-started"]')).not.toBeNull();
          expect(result.container.textContent).toContain("Canary");
        }),
      ),
    );
  });

  it("renders a compact typed seam", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderHome();

          expect(result.container.textContent).toContain("Plain Effect API");
          expect(result.container.textContent).toContain("Component + DI");
          expect(result.container.textContent).toContain("Resource.match");
          expect(result.container.textContent).toContain("Resource.fetch(users)");
        }),
      ),
    );
  });

  it("copies the canary create command", async () => {
    await Effect.runPromise(
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
            throw new Error("Missing install copy button");
          }

          yield* click(copyButton);

          expect(writeText).toHaveBeenCalledWith("bunx create-trygg@canary my-app");
          yield* waitFor(() =>
            expect(copyButton.getAttribute("aria-label")).toBe("Command copied"),
          );
        }),
      ),
    );
  });
});
