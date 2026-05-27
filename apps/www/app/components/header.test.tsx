// @vitest-environment happy-dom

import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { renderElement, testLayer } from "trygg/testing";
import * as Router from "trygg/router";

import { Header } from "./header";

const renderHeader = (path: string) =>
  renderElement(<Header />).pipe(Effect.provide(Layer.merge(testLayer, Router.testLayer(path))));

describe("Header", () => {
  it.effect("renders logo, canary badge, and nav links", () =>
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

        assert.include(logo?.textContent ?? "", "trygg");
        assert.strictEqual(badge?.textContent, "Canary");
        assert.strictEqual(docs?.textContent, "Docs");
        assert.strictEqual(github?.textContent, "GitHub");
        assert.strictEqual(discord?.textContent, "Discord");
      }),
    ),
  );

  it.effect("marks Docs active on docs routes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const result = yield* renderHeader("/docs/getting-started");

        const docs = result.container.querySelector('a[href="/docs"]');

        assert.isTrue(docs?.classList.contains("site-header__link--active") ?? false);
      }),
    ),
  );

  it.effect("does not mark Docs active on non-docs routes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const result = yield* renderHeader("/changelog");

        const docs = result.container.querySelector('a[href="/docs"]');

        assert.isFalse(docs?.classList.contains("site-header__link--active") ?? false);
      }),
    ),
  );

  it.effect("shows search trigger on docs routes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const result = yield* renderHeader("/docs/getting-started");

        const search = result.container.querySelector(".search-trigger");

        assert.include(search?.textContent ?? "", "Search");
      }),
    ),
  );

  it.effect("hides search trigger on non-docs routes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const result = yield* renderHeader("/");

        const search = result.container.querySelector(".search-trigger");

        assert.isNull(search);
      }),
    ),
  );
});
