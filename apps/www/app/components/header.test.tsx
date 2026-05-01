// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { renderElement, testLayer } from "trygg/testing";
import * as Router from "trygg/router";

import { Header } from "./header";

const renderHeader = (path: string) =>
  renderElement(<Header />).pipe(Effect.provide(Layer.merge(testLayer, Router.testLayer(path))));

describe("Header", () => {
  it("renders logo, canary badge, and nav links", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderHeader("/");

          const logo = result.container.querySelector('a[aria-label="trygg home"]');
          const badge = result.container.querySelector(".canary-badge");
          const docs = result.container.querySelector('a[href="/docs"]');
          const github = result.container.querySelector(
            'a[href="https://github.com/EduSantosBrito/trygg"]',
          );
          const discord = result.container.querySelector('a[href="https://discord.gg/BRDc7xGb5D"]');

          expect(logo?.textContent).toContain("trygg");
          expect(badge?.textContent).toBe("Canary");
          expect(docs?.textContent).toBe("Docs");
          expect(github?.textContent).toBe("GitHub");
          expect(discord?.textContent).toBe("Discord");
        }),
      ),
    );
  });

  it("marks Docs active on docs routes", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderHeader("/docs/getting-started");

          const docs = result.container.querySelector('a[href="/docs"]');

          expect(docs?.classList.contains("site-header__link--active")).toBe(true);
        }),
      ),
    );
  });

  it("does not mark Docs active on non-docs routes", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderHeader("/changelog");

          const docs = result.container.querySelector('a[href="/docs"]');

          expect(docs?.classList.contains("site-header__link--active")).toBe(false);
        }),
      ),
    );
  });

  it("shows search trigger on docs routes", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderHeader("/docs/getting-started");

          const search = result.container.querySelector(".search-trigger");

          expect(search?.textContent).toContain("Search");
        }),
      ),
    );
  });

  it("hides search trigger on non-docs routes", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderHeader("/");

          const search = result.container.querySelector(".search-trigger");

          expect(search).toBeNull();
        }),
      ),
    );
  });
});
