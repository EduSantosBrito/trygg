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
});
