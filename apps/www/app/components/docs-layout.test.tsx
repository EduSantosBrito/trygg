// @vitest-environment happy-dom

import { describe, expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { click, renderElement, testLayer, waitFor } from "trygg/testing";
import * as Router from "trygg/router";

import { DocsLayout } from "./docs-layout";
import { DocsSidebar } from "./docs-sidebar";
import { Footer } from "./footer";

const docsGettingStartedLayer = Layer.merge(testLayer, Router.testLayer("/docs/getting-started"));
const docsElementsLayer = Layer.merge(testLayer, Router.testLayer("/docs/elements"));
const homeLayer = Layer.merge(testLayer, Router.testLayer("/"));

describe("Docs chrome", () => {
  layer(docsGettingStartedLayer)("/docs/getting-started", (it) => {
    it.effect("renders grouped docs sidebar links", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsSidebar />);

        expect(result.container.textContent).toContain("Start");
        expect(result.container.textContent).toContain("Docs home");
        expect(result.container.textContent).toContain("Getting started");
        expect(result.container.textContent).toContain("Core model");
        expect(result.container.querySelector('a[href="/docs/components"]')?.textContent).toBe(
          "Components",
        );
      }),
    );

    it.effect("highlights active docs sidebar link", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsSidebar />);

        const active = result.container.querySelector('a[href="/docs/getting-started"]');

        expect(active?.classList.contains("docs-sidebar__link--active")).toBe(true);
      }),
    );

    it.effect("opens mobile drawer from hamburger", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsLayout />);
        const button = yield* result.getByText("Menu");

        yield* click(button);

        expect(result.container.querySelector(".docs-drawer--open")?.textContent).toContain(
          "Getting started",
        );
      }),
    );

    it.effect("closes mobile drawer after clicking sidebar link", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsLayout />);
        const button = yield* result.getByText("Menu");

        yield* click(button);
        const drawerLink = result.container.querySelector(
          '.docs-drawer a[href="/docs/getting-started"]',
        );
        expect(drawerLink).not.toBeNull();
        if (drawerLink instanceof HTMLElement) {
          yield* click(drawerLink);
        }

        expect(result.container.querySelector(".docs-drawer--open")).toBeNull();
      }),
    );

    it.effect("renders footer in docs layout", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsLayout />);

        expect(result.container.querySelector('footer a[href="/docs"]')?.textContent).toBe("Docs");
      }),
    );

    it.effect("renders prev/next navigation from sidebar order", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsLayout />);

        const prevNext = result.container.querySelector(".docs-prev-next");
        expect(prevNext).not.toBeNull();
        expect(prevNext?.textContent).toContain("Previous");
        expect(prevNext?.textContent).toContain("Next");
      }),
    );

    it.effect("renders sidebar group headers as collapsible buttons", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<DocsSidebar />);

        const groupHeaders = result.container.querySelectorAll(".docs-sidebar__group-header");
        expect(groupHeaders.length).toBeGreaterThan(0);
        expect(groupHeaders[0]?.textContent).toContain("Start");
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

        expect(signalsLink).not.toBeNull();
        expect(initialElementsLink?.classList.contains("docs-sidebar__link--active")).toBe(true);
        expect(signalsLink?.classList.contains("docs-sidebar__link--active")).toBe(false);

        expect(signalsLink).toBeInstanceOf(HTMLElement);

        yield* router.navigate("/docs/signals");

        yield* waitFor(() => {
          const updatedSignalsLink = result.container.querySelector('a[href="/docs/signals"]');
          const updatedElementsLink = result.container.querySelector('a[href="/docs/elements"]');

          if (!updatedSignalsLink?.classList.contains("docs-sidebar__link--active")) {
            throw new Error("Signals link is not active yet");
          }
          if (updatedSignalsLink.getAttribute("aria-current") !== "page") {
            throw new Error("Signals link does not have aria-current=page yet");
          }
          if (updatedElementsLink?.classList.contains("docs-sidebar__link--active")) {
            throw new Error("Elements link is still active");
          }
          if (updatedElementsLink?.hasAttribute("aria-current")) {
            throw new Error("Elements link still has aria-current");
          }
        });
      }),
    );
  });

  layer(homeLayer)("/", (it) => {
    it.effect("points footer Docs link at docs home", () =>
      Effect.gen(function* () {
        const result = yield* renderElement(<Footer />);

        expect(result.container.querySelector('a[href="/docs"]')?.textContent).toBe("Docs");
      }),
    );
  });
});
