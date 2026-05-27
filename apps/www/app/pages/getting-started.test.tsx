// @vitest-environment happy-dom

import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { click, renderElement, testLayer, waitFor } from "trygg/testing";

import GettingStartedPage from "./getting-started";
import { DocsHeadingsLive } from "../content/headings";

const renderGettingStarted = () =>
  renderElement(<GettingStartedPage />).pipe(
    Effect.provide(Layer.merge(testLayer, DocsHeadingsLive)),
  );

describe("GettingStartedPage", () => {
  it("renders prerequisites, create project, and install instructions", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderGettingStarted();

          expect(result.container.textContent).toContain("Prerequisites");
          expect(result.container.textContent).toContain("Bun (recommended) or Node.js 24+");
          expect(result.container.textContent).toContain("Create a project");
          expect(result.container.textContent).toContain("bunx create-trygg@canary my-app");
          expect(result.container.textContent).toContain("Install");
          expect(result.container.textContent).toContain("bun install");
        }),
      ),
    );
  });

  it("switches package manager commands", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderGettingStarted();
          const createSection = result.container.querySelector(
            '[aria-labelledby="create-project-title"]',
          );
          const installSection = result.container.querySelector(
            '[aria-labelledby="install-title"]',
          );

          const createNpm = createSection?.querySelector('button[value="npm"]');
          const installPnpm = installSection?.querySelector('button[value="pnpm"]');
          const installYarn = installSection?.querySelector('button[value="yarn"]');

          if (
            !(createNpm instanceof HTMLElement) ||
            !(installPnpm instanceof HTMLElement) ||
            !(installYarn instanceof HTMLElement)
          ) {
            throw new Error("Missing package manager tab");
          }

          yield* click(createNpm);
          yield* waitFor(() =>
            expect(createSection?.textContent).toContain("npx create-trygg@canary my-app"),
          );

          yield* click(installPnpm);
          yield* waitFor(() => expect(installSection?.textContent).toContain("pnpm install"));

          yield* click(installYarn);
          yield* waitFor(() => expect(installSection?.textContent).toContain("yarn install"));
        }),
      ),
    );
  });

  it("shares selected package manager between command sections", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderGettingStarted();
          const createSection = result.container.querySelector(
            '[aria-labelledby="create-project-title"]',
          );
          const installSection = result.container.querySelector(
            '[aria-labelledby="install-title"]',
          );

          const createNpm = createSection?.querySelector('button[value="npm"]');
          const installYarn = installSection?.querySelector('button[value="yarn"]');

          if (
            !(createSection instanceof HTMLElement) ||
            !(installSection instanceof HTMLElement) ||
            !(createNpm instanceof HTMLElement) ||
            !(installYarn instanceof HTMLElement)
          ) {
            throw new Error("Missing package manager tab DOM");
          }

          expect(createSection.textContent).toContain("bunx create-trygg@canary my-app");
          expect(installSection.textContent).toContain("bun install");

          yield* click(createNpm);
          yield* waitFor(() => {
            expect(createSection.textContent).toContain("npx create-trygg@canary my-app");
            expect(installSection.textContent).toContain("npm install");
          });

          yield* click(installYarn);
          yield* waitFor(() => {
            expect(createSection.textContent).toContain("yarn dlx create-trygg@canary my-app");
            expect(installSection.textContent).toContain("yarn install");
          });
        }),
      ),
    );
  });

  it("preserves ancestor DOM nodes when switching package manager tabs", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderGettingStarted();
          const page = result.container.firstElementChild;
          const installSection = result.container.querySelector(
            '[aria-labelledby="install-title"]',
          );
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
            throw new Error("Missing package manager tab DOM");
          }

          yield* click(npm);
          yield* waitFor(() => expect(installSection.textContent).toContain("npm install"));

          expect(result.container.firstElementChild).toBe(page);
          expect(result.container.querySelector('[aria-labelledby="install-title"]')).toBe(
            installSection,
          );
          expect(result.container.querySelector('[aria-labelledby="create-project-title"]')).toBe(
            createSection,
          );
          expect(installSection.querySelector('[role="tablist"]')).toBe(tablist);
          expect(installSection.querySelector('button[value="npm"]')).toBe(npm);
        }),
      ),
    );
  });

  it("copies selected shell command", async () => {
    await Effect.runPromise(
      Effect.scoped(
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
            throw new Error("Missing command copy button");
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

  it("renders highlighted getting started source", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderGettingStarted();

          expect(result.container.textContent).toContain("Explore the app");
          expect(result.container.textContent).toContain("app/examples/getting-started.tsx");
          expect(result.container.textContent).toContain("Component.gen");
          expect(result.container.textContent).toContain("Signal.make");
          expect(result.container.textContent).toContain("Theme service");
        }),
      ),
    );
  });

  it("renders run dev instructions", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderGettingStarted();

          expect(result.container.textContent).toContain("Run dev");
          expect(result.container.textContent).toContain("bun run dev");
          expect(result.container.textContent).toContain("localhost:5173");
        }),
      ),
    );
  });

  it("renders next steps", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderGettingStarted();

          expect(result.container.textContent).toContain("What's next");
          expect(result.container.textContent).toContain("Component Deep Dive");
          expect(result.container.textContent).toContain("Effect Platform");
          expect(result.container.textContent).toContain("Discord");
        }),
      ),
    );
  });

  it("renders CopyForAgent card with prompt text", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* renderGettingStarted();

          expect(result.container.textContent).toContain("Create with AI");
          expect(result.container.textContent).toContain(
            "Create a new trygg app using `bunx create-trygg@canary`.",
          );
          expect(result.container.textContent).toContain("Signal.make");
        }),
      ),
    );
  });

  it("copies agent prompt and resets button feedback", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const writeText = vi.fn(() => Promise.resolve());
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
          });

          const result = yield* renderGettingStarted();

          const button = yield* result.getByText("Copy");
          yield* click(button);

          expect(writeText).toHaveBeenCalledWith(
            "Create a new trygg app using `bunx create-trygg@canary`. Add a counter component with `Component.gen` and `Signal.make`. Include Tailwind CSS.",
          );
          yield* waitFor(() => expect(button.textContent).toBe("Copied!"));

          yield* waitFor(() => expect(button.textContent).toBe("Copy"), { timeout: 3_000 });
        }),
      ),
    );
  });
});
