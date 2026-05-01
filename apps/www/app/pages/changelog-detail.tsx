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
import { Header } from "../components/header";
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
  readonly date: string;
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
    date: entry.date,
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
            return <code key={i}>{seg.code}</code>;
          case "Link":
            return (
              <a
                key={i}
                href={resolveChangelogLink(seg.href)}
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
      <strong className="changelog-detail__breaking">Breaking</strong>{" "}
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
      return <Tag>{block.text}</Tag>;
    }
    case "Paragraph":
      return (
        <p>
          <InlineRenderer text={block.text} />
        </p>
      );
    case "BulletList":
      return (
        <ul>
          {block.items.map((item, i) => (
            <ChangelogListItem key={i} item={item} />
          ))}
        </ul>
      );
    case "CodeBlock":
      return (
        <div className="changelog-detail__code">
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

        <div className="min-h-screen flex flex-col">
          <Header />

          <main id="main-content" className="flex-1">
            <section aria-labelledby="not-found-title" className="not-found">
              <p className="not-found__kicker">404 / changelog</p>
              <h1 id="not-found-title" className="not-found__title">
                That release is not in the log.
              </h1>
              <p className="not-found__lede">
                The entry you are looking for has either been renamed or never existed. The full
                timeline is the fastest way to find what you wanted.
              </p>

              <ul className="not-found__directions" role="list">
                <li>
                  <Router.Link to="/changelog" className="not-found__link">
                    <span className="not-found__link-num">01</span>
                    <span className="not-found__link-body">
                      <span className="not-found__link-title">Open the full timeline</span>
                      <span className="not-found__link-meta">/changelog</span>
                    </span>
                  </Router.Link>
                </li>
                <li>
                  <Router.Link to="/" className="not-found__link">
                    <span className="not-found__link-num">02</span>
                    <span className="not-found__link-body">
                      <span className="not-found__link-title">Return home</span>
                      <span className="not-found__link-meta">/</span>
                    </span>
                  </Router.Link>
                </li>
              </ul>
            </section>
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

      <div className="min-h-screen flex flex-col">
        <Header />

        <main id="main-content" className="flex-1">
          <article className="changelog-detail">
            <Router.Link to="/changelog" className="changelog-detail__back">
              <span aria-hidden="true">&larr;</span>
              Back to changelog
            </Router.Link>

            <header className="changelog-detail__header">
              <div className="changelog-detail__chrono">
                <time className="changelog-detail__date" dateTime={entry.date}>
                  {entry.date}
                </time>
                <span className="changelog-detail__sep" aria-hidden="true" />
                <span className="changelog-detail__version">{entry.meta.version}</span>
              </div>
              <h1 className="changelog-detail__title">{entry.meta.title}</h1>
              <p className="changelog-detail__lede">{entry.meta.summary}</p>
            </header>

            <div className="changelog-detail__prose docs-prose">
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
