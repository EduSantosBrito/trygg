// @vitest-environment happy-dom

import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { click, renderElement, testLayer, waitFor } from "trygg/testing";
import * as Router from "trygg/router";

import { DocsLayout } from "./docs-layout";
import { DocsSidebar } from "./docs-sidebar";
import { DocsHeadingsLive } from "../content/headings";
import { docsContent } from "../content/docs-content";
import { sidebarGroups } from "../content/sidebar";
import { Footer } from "./footer";

const docsGettingStartedLayer = Layer.merge(
  Layer.merge(testLayer, Router.testLayer("/docs/getting-started")),
  DocsHeadingsLive,
);
const docsElementsLayer = Layer.merge(
  Layer.merge(testLayer, Router.testLayer("/docs/elements")),
  DocsHeadingsLive,
);
const homeLayer = Layer.merge(Layer.merge(testLayer, Router.testLayer("/")), DocsHeadingsLive);

const flushDom = Effect.gen(function* () {
  for (let i = 0; i < 10; i++) {
    yield* Effect.yieldNow;
  }
});

describe("Docs chrome", () => {
  describe("docs navigation content contract", () => {
    it.effect("links only to published markdown-backed topic pages", () =>
      Effect.sync(() => {
        const topicLinks = sidebarGroups
          .flatMap((group) => group.links)
          .filter((link) => link.href !== "/docs" && link.href !== "/docs/getting-started");

        const missing = topicLinks.filter((link) => docsContent[link.href] === undefined);

        assert.deepStrictEqual(
          missing.map((link) => link.href),
          [],
          "sidebar should not expose unpublished docs placeholders",
        );
      }),
    );
  });

  layer(docsGettingStartedLayer)("/docs/getting-started", (it) => {
    it.effect("renders grouped docs sidebar links", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsSidebar />);

        assert.include(result.container.textContent, "Start");
        assert.include(result.container.textContent, "Docs home");
        assert.include(result.container.textContent, "Getting started");
        assert.include(result.container.textContent, "Core model");
        assert.strictEqual(
          result.container.querySelector('a[href="/docs/components"]')?.textContent,
          "Components",
        );
      }),
    );

    it.effect("highlights active docs sidebar link", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsSidebar />);

        const active = result.container.querySelector('a[href="/docs/getting-started"]');

        assert.isTrue(active?.classList.contains("docs-sidebar__link--active"));
      }),
    );

    it.effect("does not render duplicate drawer sidebar before the drawer opens", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsLayout />);

        assert.strictEqual(result.container.querySelectorAll(".docs-sidebar").length, 1);
        assert.isNull(result.container.querySelector(".docs-drawer .docs-sidebar"));
      }),
    );

    it.effect("opens mobile drawer from hamburger", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsLayout />);
        const button = yield* result.getByText("Menu");

        yield* click(button);
        yield* flushDom;

        assert.include(
          result.container.querySelector(".docs-drawer--open")?.textContent,
          "Getting started",
        );
      }),
    );

    it.effect("closes mobile drawer after clicking sidebar link", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsLayout />);
        const button = yield* result.getByText("Menu");

        yield* click(button);
        yield* flushDom;

        const drawerLink = result.container.querySelector(
          '.docs-drawer a[href="/docs/getting-started"]',
        );
        assert.isNotNull(drawerLink);
        if (drawerLink instanceof HTMLElement) {
          yield* click(drawerLink);
        }
        yield* flushDom;

        assert.isNull(result.container.querySelector(".docs-drawer--open"));
      }),
    );

    it.effect("renders footer in docs layout", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsLayout />);

        assert.strictEqual(
          result.container.querySelector('footer a[href="/docs"]')?.textContent,
          "Docs",
        );
      }),
    );

    it.effect("renders prev/next navigation from sidebar order", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsLayout />);

        const prevNext = result.container.querySelector(".docs-prev-next");
        assert.isNotNull(prevNext);
        assert.include(prevNext?.textContent, "Previous");
        assert.include(prevNext?.textContent, "Next");
      }),
    );

    it.effect("renders sidebar group headers as collapsible buttons", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsSidebar />);

        const groupHeaders = result.container.querySelectorAll(".docs-sidebar__group-header");
        assert.isAbove(groupHeaders.length, 0);
        assert.include(groupHeaders[0]?.textContent, "Start");
      }),
    );
  });

  layer(docsElementsLayer)("/docs/elements", (it) => {
    it.effect("updates active docs sidebar link after in-app navigation", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsSidebar />);
        const router = yield* Router.get;

        const signalsLink = result.container.querySelector('a[href="/docs/signals"]');
        const initialElementsLink = result.container.querySelector('a[href="/docs/elements"]');

        assert.isNotNull(signalsLink);
        assert.isTrue(initialElementsLink?.classList.contains("docs-sidebar__link--active"));
        assert.isFalse(signalsLink?.classList.contains("docs-sidebar__link--active"));

        assert.instanceOf(signalsLink, HTMLElement);

        yield* router.navigate("/docs/signals");

        yield* waitFor(() => {
          const updatedSignalsLink = result.container.querySelector('a[href="/docs/signals"]');
          const updatedElementsLink = result.container.querySelector('a[href="/docs/elements"]');

          assert.isTrue(
            updatedSignalsLink?.classList.contains("docs-sidebar__link--active"),
            "Signals link is not active yet",
          );
          assert.strictEqual(
            updatedSignalsLink?.getAttribute("aria-current"),
            "page",
            "Signals link does not have aria-current=page yet",
          );
          assert.isFalse(
            updatedElementsLink?.classList.contains("docs-sidebar__link--active"),
            "Elements link is still active",
          );
          assert.isFalse(
            updatedElementsLink?.hasAttribute("aria-current"),
            "Elements link still has aria-current",
          );
        });
      }),
    );
  });

  layer(homeLayer)("/", (it) => {
    it.effect("points footer Docs link at docs home", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<Footer />);

        assert.strictEqual(result.container.querySelector('a[href="/docs"]')?.textContent, "Docs");
      }),
    );
  });
});
