// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { click, renderElement, testLayer, waitFor } from "trygg/testing";
import * as Router from "trygg/router";

import { DocsLayout } from "./docs-layout";
import { DocsSidebar } from "./docs-sidebar";
import { Footer } from "./footer";

const renderWithRoute = (element: Parameters<typeof renderElement>[0], path: string) =>
  renderElement(element).pipe(Effect.provide(Layer.merge(testLayer, Router.testLayer(path))));

describe("Docs chrome", () => {
  it("renders grouped docs sidebar links", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderWithRoute(<DocsSidebar />, "/docs/getting-started");

          expect(result.container.textContent).toContain("Start");
          expect(result.container.textContent).toContain("Docs home");
          expect(result.container.textContent).toContain("Getting started");
          expect(result.container.textContent).toContain("Core model");
          expect(result.container.querySelector('a[href="/docs/components"]')?.textContent).toBe(
            "Components",
          );
        }),
      ),
    );
  });

  it("highlights active docs sidebar link", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderWithRoute(<DocsSidebar />, "/docs/getting-started");

          const active = result.container.querySelector('a[href="/docs/getting-started"]');

          expect(active?.classList.contains("docs-sidebar__link--active")).toBe(true);
        }),
      ),
    );
  });

  it("updates active docs sidebar link after in-app navigation", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderWithRoute(<DocsSidebar />, "/docs/elements");

          const signalsLink = result.container.querySelector('a[href="/docs/signals"]');
          const initialElementsLink = result.container.querySelector('a[href="/docs/elements"]');

          expect(signalsLink).not.toBeNull();
          expect(initialElementsLink?.classList.contains("docs-sidebar__link--active")).toBe(true);
          expect(signalsLink?.classList.contains("docs-sidebar__link--active")).toBe(false);

          if (signalsLink instanceof HTMLElement) {
            yield* click(signalsLink);
          }

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
      ),
    );
  });

  it("opens mobile drawer from hamburger", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderWithRoute(<DocsLayout />, "/docs/getting-started");
          const button = yield* result.getByText("Menu");

          yield* click(button);

          expect(result.container.querySelector(".docs-drawer--open")?.textContent).toContain(
            "Getting started",
          );
        }),
      ),
    );
  });

  it("closes mobile drawer after clicking sidebar link", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderWithRoute(<DocsLayout />, "/docs/getting-started");
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
      ),
    );
  });

  it("points footer Docs link at docs home", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderWithRoute(<Footer />, "/");

          expect(result.container.querySelector('a[href="/docs"]')?.textContent).toBe("Docs");
        }),
      ),
    );
  });

  it("renders footer in docs layout", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderWithRoute(<DocsLayout />, "/docs/getting-started");

          expect(result.container.querySelector('footer a[href="/docs"]')?.textContent).toBe(
            "Docs",
          );
        }),
      ),
    );
  });

  it("renders prev/next navigation from sidebar order", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderWithRoute(<DocsLayout />, "/docs/getting-started");

          const prevNext = result.container.querySelector(".docs-prev-next");
          expect(prevNext).not.toBeNull();
          expect(prevNext?.textContent).toContain("Previous");
          expect(prevNext?.textContent).toContain("Next");
        }),
      ),
    );
  });

  it("renders sidebar group headers as collapsible buttons", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderWithRoute(<DocsSidebar />, "/docs/getting-started");

          const groupHeaders = result.container.querySelectorAll(".docs-sidebar__group-header");
          expect(groupHeaders.length).toBeGreaterThan(0);
          expect(groupHeaders[0]?.textContent).toContain("Start");
        }),
      ),
    );
  });
});
