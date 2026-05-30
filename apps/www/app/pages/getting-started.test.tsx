// @vitest-environment happy-dom

import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { click, renderElement, testLayer, waitFor } from "trygg/testing";

import GettingStartedPage from "./getting-started";
import { DocsHeadingsLive } from "../content/headings";

const renderGettingStarted = () =>
  renderElement(<GettingStartedPage />).pipe(
    Effect.provide(Layer.merge(testLayer, DocsHeadingsLive)),
  );

describe("GettingStartedPage", () => {
  it.effect("renders prerequisites, create project, and install instructions", () =>
    Effect.gen(function* () {
      const result = yield* renderGettingStarted();

      assert.include(result.container.textContent, "Prerequisites");
      assert.include(result.container.textContent, "Bun (recommended) or Node.js 24+");
      assert.include(result.container.textContent, "Create a project");
      assert.include(result.container.textContent, "bunx create-trygg@canary my-app");
      assert.include(result.container.textContent, "Install");
      assert.include(result.container.textContent, "bun install");
    }),
  );

  it.effect("switches package manager commands", () =>
    Effect.gen(function* () {
      const result = yield* renderGettingStarted();
      const createSection = result.container.querySelector(
        '[aria-labelledby="create-project-title"]',
      );
      const installSection = result.container.querySelector('[aria-labelledby="install-title"]');

      const createNpm = createSection?.querySelector('button[value="npm"]');
      const installPnpm = installSection?.querySelector('button[value="pnpm"]');
      const installYarn = installSection?.querySelector('button[value="yarn"]');

      if (
        !(createNpm instanceof HTMLElement) ||
        !(installPnpm instanceof HTMLElement) ||
        !(installYarn instanceof HTMLElement)
      ) {
        return assert.fail("Missing package manager tab");
      }

      yield* click(createNpm);
      yield* waitFor(() =>
        assert.include(createSection?.textContent, "npx create-trygg@canary my-app"),
      );

      yield* click(installPnpm);
      yield* waitFor(() => assert.include(installSection?.textContent, "pnpm install"));

      yield* click(installYarn);
      yield* waitFor(() => assert.include(installSection?.textContent, "yarn install"));
    }),
  );

  it.effect("shares selected package manager between command sections", () =>
    Effect.gen(function* () {
      const result = yield* renderGettingStarted();
      const createSection = result.container.querySelector(
        '[aria-labelledby="create-project-title"]',
      );
      const installSection = result.container.querySelector('[aria-labelledby="install-title"]');

      const createNpm = createSection?.querySelector('button[value="npm"]');
      const installYarn = installSection?.querySelector('button[value="yarn"]');

      if (
        !(createSection instanceof HTMLElement) ||
        !(installSection instanceof HTMLElement) ||
        !(createNpm instanceof HTMLElement) ||
        !(installYarn instanceof HTMLElement)
      ) {
        return assert.fail("Missing package manager tab DOM");
      }

      assert.include(createSection.textContent, "bunx create-trygg@canary my-app");
      assert.include(installSection.textContent, "bun install");

      yield* click(createNpm);
      yield* waitFor(() => {
        assert.include(createSection.textContent, "npx create-trygg@canary my-app");
        assert.include(installSection.textContent, "npm install");
      });

      yield* click(installYarn);
      yield* waitFor(() => {
        assert.include(createSection.textContent, "yarn dlx create-trygg@canary my-app");
        assert.include(installSection.textContent, "yarn install");
      });
    }),
  );

  it.effect("preserves ancestor DOM nodes when switching package manager tabs", () =>
    Effect.gen(function* () {
      const result = yield* renderGettingStarted();
      const page = result.container.firstElementChild;
      const installSection = result.container.querySelector('[aria-labelledby="install-title"]');
      const createSection = result.container.querySelector(
        '[aria-labelledby="create-project-title"]',
      );
      const tablist = installSection?.querySelector('[role="tablist"]');
      const npm = installSection?.querySelector('button[value="npm"]');

      if (
        !(page instanceof HTMLElement) ||
        !(installSection instanceof HTMLElement) ||
        !(createSection instanceof HTMLElement) ||
        !(tablist instanceof HTMLElement) ||
        !(npm instanceof HTMLElement)
      ) {
        return assert.fail("Missing package manager tab DOM");
      }

      yield* click(npm);
      yield* waitFor(() => assert.include(installSection.textContent, "npm install"));

      assert.strictEqual(result.container.firstElementChild, page);
      assert.strictEqual(
        result.container.querySelector('[aria-labelledby="install-title"]'),
        installSection,
      );
      assert.strictEqual(
        result.container.querySelector('[aria-labelledby="create-project-title"]'),
        createSection,
      );
      assert.strictEqual(installSection.querySelector('[role="tablist"]'), tablist);
      assert.strictEqual(installSection.querySelector('button[value="npm"]'), npm);
    }),
  );

  it.effect("copies selected shell command", () =>
    Effect.gen(function* () {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      const result = yield* renderGettingStarted();
      const createSection = result.container.querySelector(
        '[aria-labelledby="create-project-title"]',
      );
      const copyButton = createSection?.querySelector(
        'button[aria-label="Copy command to clipboard"]',
      );

      if (!(copyButton instanceof HTMLElement)) {
        return assert.fail("Missing command copy button");
      }

      yield* click(copyButton);

      assert.deepStrictEqual(writeText.mock.calls, [["bunx create-trygg@canary my-app"]]);
      yield* waitFor(() =>
        assert.strictEqual(copyButton.getAttribute("aria-label"), "Command copied"),
      );
    }),
  );

  it.effect("renders highlighted getting started source", () =>
    Effect.gen(function* () {
      const result = yield* renderGettingStarted();

      assert.include(result.container.textContent, "Explore the app");
      assert.include(result.container.textContent, "app/examples/getting-started.tsx");
      assert.include(result.container.textContent, "Component.gen");
      assert.include(result.container.textContent, "Signal.make");
      assert.include(result.container.textContent, "Theme service");
    }),
  );

  it.effect("renders run dev instructions", () =>
    Effect.gen(function* () {
      const result = yield* renderGettingStarted();

      assert.include(result.container.textContent, "Run dev");
      assert.include(result.container.textContent, "bun run dev");
      assert.include(result.container.textContent, "localhost:5173");
    }),
  );

  it.effect("renders next steps", () =>
    Effect.gen(function* () {
      const result = yield* renderGettingStarted();

      assert.include(result.container.textContent, "What's next");
      assert.include(result.container.textContent, "Component Deep Dive");
      assert.include(result.container.textContent, "Effect Platform");
      assert.include(result.container.textContent, "Discord");
    }),
  );

  it.effect("renders CopyForAgent card with prompt text", () =>
    Effect.gen(function* () {
      const result = yield* renderGettingStarted();

      assert.include(result.container.textContent, "Create with AI");
      assert.include(
        result.container.textContent,
        "Create a new trygg app using `bunx create-trygg@canary`.",
      );
      assert.include(result.container.textContent, "Signal.make");
    }),
  );

  it.effect("copies agent prompt and resets button feedback", () =>
    Effect.gen(function* () {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      const result = yield* renderGettingStarted();

      const button = yield* result.getByText("Copy");
      yield* click(button);

      assert.deepStrictEqual(writeText.mock.calls, [
        [
          "Create a new trygg app using `bunx create-trygg@canary`. Add a counter component with `Component.gen` and `Signal.make`. Include Tailwind CSS.",
        ],
      ]);
      yield* waitFor(() => assert.strictEqual(button.textContent, "Copied!"));

      const resetFiber = yield* Effect.forkChild(
        waitFor(() => assert.strictEqual(button.textContent, "Copy"), { timeout: 3_000 }),
      );
      yield* TestClock.adjust(3_000);
      yield* Fiber.join(resetFiber);
    }),
  );
});
