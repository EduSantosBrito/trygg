/**
 * Changelog Detail Page — trygg.dev
 */
import { Component, type ComponentProps } from "trygg";
import * as Router from "trygg/router";

import { changelogEntries, type ChangelogBlock } from "../lib/changelog";
import { CodeBlock, highlightCode } from "../components/code-block";
import type { HighlightedLine } from "../components/code-block";

// =============================================================================
// Precompute rendered blocks (async at module scope)
// =============================================================================

type RenderedBlock =
  | { readonly _tag: "Heading"; readonly level: 2 | 3 | 4; readonly text: string }
  | { readonly _tag: "Paragraph"; readonly text: string }
  | { readonly _tag: "BulletList"; readonly items: ReadonlyArray<string> }
  | {
      readonly _tag: "CodeBlock";
      readonly language: string;
      readonly lines: ReadonlyArray<HighlightedLine>;
    };

type RenderedEntry = {
  readonly name: string;
  readonly meta: { readonly title: string; readonly version: string; readonly summary: string };
  readonly renderedBlocks: ReadonlyArray<RenderedBlock>;
};

const renderBlock = async (block: ChangelogBlock): Promise<RenderedBlock> => {
  switch (block._tag) {
    case "CodeBlock": {
      const lines = await highlightCode(block.code, block.language);
      return { _tag: "CodeBlock", language: block.language, lines };
    }
    default:
      return block;
  }
};

const renderedEntries: ReadonlyArray<RenderedEntry> = await Promise.all(
  changelogEntries.map(async (entry) => ({
    name: entry.name,
    meta: entry.meta,
    renderedBlocks: await Promise.all(entry.blocks.map(renderBlock)),
  })),
);

const findRenderedEntry = (name: string): RenderedEntry | undefined =>
  renderedEntries.find((entry) => entry.name === name);

// =============================================================================
// Block renderer
// =============================================================================

const BlockRenderer = Component.gen(function* (
  Props: ComponentProps<{ readonly block: RenderedBlock }>,
) {
  const { block } = yield* Props;

  switch (block._tag) {
    case "Heading": {
      const Tag = `h${block.level}` as const;
      return (
        <Tag className="text-[var(--color-text)] font-semibold tracking-tight mt-8 mb-4 first:mt-0">
          {block.text}
        </Tag>
      );
    }
    case "Paragraph":
      return <p className="text-[var(--color-text-muted)] leading-relaxed mb-4">{block.text}</p>;
    case "BulletList":
      return (
        <ul className="list-disc list-inside text-[var(--color-text-muted)] leading-relaxed mb-4 space-y-1">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "CodeBlock":
      return (
        <div className="mb-6">
          <CodeBlock lines={block.lines} fileType={block.language.toUpperCase()} />
        </div>
      );
  }
});

// =============================================================================
// Detail Page
// =============================================================================

export default Component.gen(function* () {
  const { name } = yield* Router.params("/changelog/:name");

  const entry = findRenderedEntry(name);

  if (!entry) {
    return (
      <>
        <title>Changelog entry not found | trygg</title>
        <meta name="robots" content="noindex" />

        <main id="main-content" className="bg-grid min-h-screen px-6 py-16">
          <div className="max-w-3xl mx-auto">
            <a
              href="/changelog"
              className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mb-8"
            >
              <span aria-hidden="true">&larr;</span>
              Back to changelog
            </a>

            <section
              aria-labelledby="not-found-title"
              className="rounded-2xl border border-[var(--color-border)] bg-[rgba(5,5,8,0.86)] backdrop-blur-sm p-8 sm:p-12"
            >
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">
                Error 404
              </p>

              <h1
                id="not-found-title"
                className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-text)]"
              >
                Changelog entry not found
              </h1>

              <p className="mt-4 text-[var(--color-text-muted)] leading-relaxed">
                The changelog entry you are looking for does not exist.
              </p>
            </section>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <title>{entry.meta.title} — Changelog | trygg</title>
      <meta name="description" content={entry.meta.summary} />

      <main id="main-content" className="bg-grid min-h-screen px-6 py-16">
        <article className="max-w-3xl mx-auto">
          <a
            href="/changelog"
            className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mb-8"
          >
            <span aria-hidden="true">&larr;</span>
            Back to changelog
          </a>

          <header className="mb-10">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)] mb-3">
              {entry.meta.version}
            </p>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-text)]">
              {entry.meta.title}
            </h1>
            <p className="mt-4 text-[var(--color-text-muted)] leading-relaxed">
              {entry.meta.summary}
            </p>
          </header>

          <div>
            {entry.renderedBlocks.map((block, i) => (
              <BlockRenderer key={i} block={block} />
            ))}
          </div>
        </article>
      </main>
    </>
  );
});
