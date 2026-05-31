// @vitest-environment happy-dom

import { assert, describe, it } from "@effect/vitest";
// oxlint-disable-next-line effect/no-vitest-import -- vi.mock/vi.hoisted must come from vitest for hoisted ESM mocks.
import { vi } from "vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { Component, type ComponentProps } from "trygg";
import { renderElement, testLayer } from "trygg/testing";

const highlight = vi.hoisted(() => {
  let resolvePending:
    | ((
        lines: ReadonlyArray<{
          readonly lineNumber: number;
          readonly nodes: ReadonlyArray<{ readonly type: "text"; readonly value: string }>;
        }>,
      ) => void)
    | null = null;
  const promise = new Promise<
    ReadonlyArray<{
      readonly lineNumber: number;
      readonly nodes: ReadonlyArray<{ readonly type: "text"; readonly value: string }>;
    }>
  >((resolve) => {
    resolvePending = resolve;
  });

  return {
    highlightCode: vi.fn(() => promise),
    resolve(
      lines: ReadonlyArray<{
        readonly lineNumber: number;
        readonly nodes: ReadonlyArray<{ readonly type: "text"; readonly value: string }>;
      }>,
    ) {
      resolvePending?.(lines);
    },
  };
});

vi.mock("./code-block", () => ({
  highlightCode: highlight.highlightCode,
  CodeBlock: Component.gen(function* (
    Props: ComponentProps<{
      readonly lines: ReadonlyArray<{
        readonly lineNumber: number;
        readonly nodes: ReadonlyArray<{ readonly type: "text"; readonly value: string }>;
      }>;
      readonly copyText?: string;
      readonly fileType?: string;
    }>,
  ) {
    const { lines, copyText, fileType } = yield* Props;
    return (
      <pre data-testid="highlighted-code" data-copy={copyText} data-file-type={fileType}>
        {lines.map((line) => line.nodes.map((node) => node.value).join("")).join("\n")}
      </pre>
    );
  }),
}));

import { DocsArticle } from "./docs-article";

const source = `# Signals

Fine-grained reactive state that updates DOM leaves.

\`\`\`tsx
const count = yield* Signal.make(0)
\`\`\`
`;

describe("DocsArticle", () => {
  it.effect("commits article copy while code highlighting is pending", () =>
    Effect.gen(function* () {
      const renderFiber = yield* renderElement(<DocsArticle source={source} />).pipe(
        Effect.provide(testLayer),
        Effect.forkChild,
      );
      yield* TestClock.adjust(100);

      assert.isDefined(
        renderFiber.pollUnsafe(),
        "DocsArticle render should complete while code highlighting is still pending",
      );
      const result = yield* Fiber.join(renderFiber);

      assert.include(result.container.textContent, "Signals");
      assert.include(
        result.container.textContent,
        "Fine-grained reactive state that updates DOM leaves.",
      );
      assert.isNotNull(result.container.querySelector(".docs-code-fallback"));
      assert.isNull(result.container.querySelector('[data-testid="highlighted-code"]'));

      highlight.resolve([
        {
          lineNumber: 1,
          nodes: [{ type: "text", value: "const count = yield* Signal.make(0)" }],
        },
      ]);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(20);
      yield* Effect.yieldNow;

      const highlighted = result.container.querySelector('[data-testid="highlighted-code"]');
      assert.isNotNull(highlighted);
      assert.include(highlighted?.textContent, "Signal.make");
    }),
  );

  it.effect("renders a GFM table instead of raw pipe text", () =>
    Effect.gen(function* () {
      const tableSource = `# Deployment

| platform | output | Run with |
| --- | --- | --- |
| \`bun\` | \`server\` | \`bun dist/server.js\` |
| \`cloudflare\` | \`static\` | Cloudflare Workers |
`;
      const result = yield* renderElement(<DocsArticle source={tableSource} />).pipe(
        Effect.provide(testLayer),
      );

      const table = result.container.querySelector(".docs-table");
      assert.isNotNull(table, "a markdown table should render as a <table>");

      // Keyboard-scrollable wrapper must announce itself (WCAG 4.1.2 Name, Role, Value).
      const wrap = result.container.querySelector(".docs-table-wrap");
      assert.strictEqual(wrap?.getAttribute("role"), "region");
      assert.strictEqual(wrap?.getAttribute("aria-label"), "Table");

      const headers = Array.from(table?.querySelectorAll("thead th") ?? []).map(
        (th) => th.textContent,
      );
      assert.deepStrictEqual(headers, ["platform", "output", "Run with"]);

      const firstRow = Array.from(table?.querySelectorAll("tbody tr") ?? [])[0];
      const cells = Array.from(firstRow?.querySelectorAll("td") ?? []).map((td) => td.textContent);
      assert.deepStrictEqual(cells, ["bun", "server", "bun dist/server.js"]);

      // Regression guard: the raw delimiter row must never reach the DOM as text.
      assert.notInclude(result.container.textContent, "| --- |");
    }),
  );

  it.effect("renders inline markdown links as anchors", () =>
    Effect.gen(function* () {
      const linkSource = `# Links

See the [Config](/docs/config) page and the [Vite docs](https://vitejs.dev) site.
`;
      const result = yield* renderElement(<DocsArticle source={linkSource} />).pipe(
        Effect.provide(testLayer),
      );

      const internal = result.container.querySelector('a[href="/docs/config"]');
      assert.isNotNull(internal, "internal markdown link should render as an anchor");
      assert.strictEqual(internal?.textContent, "Config");
      assert.isNull(internal?.getAttribute("target"), "internal links should not open a new tab");

      const external = result.container.querySelector('a[href="https://vitejs.dev"]');
      assert.strictEqual(external?.getAttribute("target"), "_blank");
      assert.strictEqual(external?.getAttribute("rel"), "noopener noreferrer");

      // External links warn assistive tech that focus jumps to a new tab.
      const newTabHint = external?.querySelector(".sr-only");
      assert.isNotNull(newTabHint, "external links should carry a visually-hidden new-tab hint");
      assert.include(newTabHint?.textContent, "opens in new tab");

      // Regression guard: raw link syntax must never reach the DOM as text.
      assert.notInclude(result.container.textContent, "[Config]");
    }),
  );
});
