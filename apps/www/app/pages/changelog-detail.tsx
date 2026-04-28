/**
 * Changelog Detail Page — trygg.dev
 */
import { Component, type ComponentProps } from "trygg";
import * as Router from "trygg/router";

import {
  changelogEntries,
  parseInlineSegments,
  resolveChangelogLink,
  type ChangelogBlock,
} from "../lib/changelog";
import { CodeBlock, highlightCode } from "../components/code-block";
import { Footer } from "../components/footer";
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
// Inline segments renderer
// =============================================================================

const InlineRenderer = Component.gen(function* (Props: ComponentProps<{ readonly text: string }>) {
  const { text } = yield* Props;
  const segments = parseInlineSegments(text);

  return (
    <>
      {segments.map((seg, i) => {
        switch (seg._tag) {
          case "InlineCode":
            return (
              <code
                key={i}
                className="font-mono text-xs bg-[rgba(255,255,255,0.06)] rounded px-1 py-0.5 text-[var(--color-text)]"
              >
                {seg.code}
              </code>
            );
          case "Link":
            return (
              <a
                key={i}
                href={resolveChangelogLink(seg.href)}
                className="text-[var(--color-accent)] hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {seg.text}
              </a>
            );
          case "Text":
            return <span key={i}>{seg.text}</span>;
        }
      })}
    </>
  );
});

const BREAKING_CHANGE_PREFIX = "Breaking:";

const ChangelogListItem = Component.gen(function* (
  Props: ComponentProps<{ readonly item: string }>,
) {
  const { item } = yield* Props;

  if (!item.startsWith(BREAKING_CHANGE_PREFIX)) {
    return (
      <li>
        <InlineRenderer text={item} />
      </li>
    );
  }

  const detail = item.slice(BREAKING_CHANGE_PREFIX.length).trimStart();

  return (
    <li>
      <strong className="font-bold text-red-400 text-xs">Breaking:</strong>{" "}
      <InlineRenderer text={detail} />
    </li>
  );
});

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
      return (
        <p className="text-[var(--color-text-muted)] leading-relaxed mb-4">
          <InlineRenderer text={block.text} />
        </p>
      );
    case "BulletList":
      return (
        <ul className="list-disc list-inside text-[var(--color-text-muted)] leading-relaxed mb-4 space-y-1">
          {block.items.map((item, i) => (
            <ChangelogListItem key={i} item={item} />
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

        <div className="bg-grid min-h-screen flex flex-col">
          <main id="main-content" className="flex-1 px-6 py-16">
            <div className="max-w-3xl mx-auto">
              <Router.Link
                to="/changelog"
                className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mb-8"
              >
                <span aria-hidden="true">&larr;</span>
                Back to changelog
              </Router.Link>

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

          <Footer />
        </div>
      </>
    );
  }

  return (
    <>
      <title>{entry.meta.title} — Changelog | trygg</title>
      <meta name="description" content={entry.meta.summary} />

      <div className="bg-grid min-h-screen flex flex-col">
        <main id="main-content" className="flex-1 px-6 py-16">
          <article className="max-w-3xl mx-auto">
            <Router.Link
              to="/changelog"
              className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mb-8"
            >
              <span aria-hidden="true">&larr;</span>
              Back to changelog
            </Router.Link>

            <header className="mb-10">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)] mb-3">
                {entry.meta.version}
              </p>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-text)]">
                {entry.meta.title}
              </h1>
            </header>

            <div>
              {entry.renderedBlocks.map((block, i) => (
                <BlockRenderer key={i} block={block} />
              ))}
            </div>
          </article>
        </main>

        <Footer />
      </div>
    </>
  );
});
