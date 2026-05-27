/**
 * Changelog Detail Page — trygg.dev
 */
import { Data, Match } from "effect";
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

type RenderedBlock = Data.TaggedEnum<{
  readonly Heading: { readonly level: 2 | 3 | 4; readonly text: string };
  readonly Paragraph: { readonly text: string };
  readonly BulletList: { readonly items: ReadonlyArray<string> };
  readonly CodeBlock: {
    readonly language: string;
    readonly lines: ReadonlyArray<HighlightedLine>;
  };
}>;

const RenderedBlock = Data.taggedEnum<RenderedBlock>();

type RenderedEntry = {
  readonly name: string;
  readonly date: string;
  readonly meta: { readonly title: string; readonly version: string; readonly summary: string };
  readonly renderedBlocks: ReadonlyArray<RenderedBlock>;
};

const renderBlock = async (block: ChangelogBlock): Promise<RenderedBlock> => {
  switch (block._tag) {
    case "Heading":
      return RenderedBlock.Heading({ level: block.level, text: block.text });
    case "Paragraph":
      return RenderedBlock.Paragraph({ text: block.text });
    case "BulletList":
      return RenderedBlock.BulletList({ items: block.items });
    case "CodeBlock": {
      const lines = await highlightCode(block.code, block.language);
      return RenderedBlock.CodeBlock({ language: block.language, lines });
    }
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
      {segments.map((seg, i) =>
        Match.value(seg).pipe(
          Match.tag("InlineCode", ({ code }) => <code key={i}>{code}</code>),
          Match.tag("Link", ({ href, text }) => (
            <a key={i} href={resolveChangelogLink(href)} target="_blank" rel="noopener noreferrer">
              {text}
            </a>
          )),
          Match.tag("Text", ({ text }) => <span key={i}>{text}</span>),
          Match.exhaustive,
        ),
      )}
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

const headingTag = (level: 2 | 3 | 4): "h2" | "h3" | "h4" => {
  switch (level) {
    case 2:
      return "h2";
    case 3:
      return "h3";
    case 4:
      return "h4";
  }
};

const BlockRenderer = Component.gen(function* (
  Props: ComponentProps<{ readonly block: RenderedBlock }>,
) {
  const { block } = yield* Props;

  switch (block._tag) {
    case "Heading": {
      const Tag = headingTag(block.level);
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
