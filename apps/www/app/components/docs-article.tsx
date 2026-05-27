import { Effect } from "effect";
import { Component, type ComponentProps } from "trygg";

import { CodeBlock, highlightCode } from "./code-block";
import type { HeadingEntry } from "../content/headings";
import { parseMarkdown, parseInline, type Block, type HeadingBlock } from "../lib/markdown";

const isRailHeading = (
  block: Block,
): block is Extract<Block, { type: "heading" }> & { readonly level: 2 | 3 } =>
  block.type === "heading" && (block.level === 2 || block.level === 3);

export function extractDocsHeadings(source: string): ReadonlyArray<HeadingEntry> {
  return parseMarkdown(source)
    .filter(isRailHeading)
    .map((heading) => ({ id: heading.id, text: heading.text, level: heading.level }));
}

function renderInline(text: string) {
  return parseInline(text).map((seg, i) => {
    if (seg.type === "code")
      return (
        <code key={i} className="docs-inline-code">
          {seg.content}
        </code>
      );
    if (seg.type === "bold") return <strong key={i}>{seg.content}</strong>;
    return <span key={i}>{seg.content}</span>;
  });
}

const DocsCodeBlock = Component.gen(function* (
  Props: ComponentProps<{
    readonly content: string;
    readonly language?: string;
  }>,
) {
  const { content, language } = yield* Props;
  const lines = yield* Effect.promise(() => highlightCode(content, language || "tsx"));

  return (
    <div className="docs-article__code-wrapper">
      <CodeBlock lines={lines} copyText={content} fileType={language || undefined} />
    </div>
  );
});

export const DocsArticle = Component.gen(function* (
  Props: ComponentProps<{
    readonly source: string;
    readonly description?: string;
    readonly primaryExport?: string;
  }>,
) {
  const { source, description, primaryExport } = yield* Props;
  const blocks = parseMarkdown(source);

  const titleBlock = blocks.find((b): b is HeadingBlock => b.type === "heading" && b.level === 1);
  const contentBlocks = titleBlock ? blocks.filter((b) => b !== titleBlock) : blocks;

  return (
    <article className="docs-page docs-article" aria-labelledby="docs-topic-title">
      <header className="docs-article__header">
        {primaryExport ? (
          <p className="docs-eyebrow">
            <code>{`import { ${primaryExport} } from "trygg"`}</code>
          </p>
        ) : null}
        <h1 id="docs-topic-title">{titleBlock?.text ?? "Docs"}</h1>
        {description ? <p className="docs-article__lede">{description}</p> : null}
      </header>

      <div className="docs-article__body">
        {contentBlocks.map((block, i) => {
          switch (block.type) {
            case "heading":
              if (block.level === 2) {
                return (
                  <h2 key={i} id={block.id} className="docs-heading-anchor">
                    {block.text}
                    <a
                      href={`#${block.id}`}
                      className="docs-heading-anchor__link"
                      aria-label={`Link to ${block.text}`}
                    >
                      #
                    </a>
                  </h2>
                );
              }
              return (
                <h3 key={i} id={block.id} className="docs-heading-anchor">
                  {block.text}
                  <a
                    href={`#${block.id}`}
                    className="docs-heading-anchor__link"
                    aria-label={`Link to ${block.text}`}
                  >
                    #
                  </a>
                </h3>
              );
            case "paragraph":
              return <p key={i}>{renderInline(block.text)}</p>;
            case "code":
              return (
                <DocsCodeBlock
                  key={i}
                  content={block.content}
                  language={block.language || undefined}
                />
              );
            case "list":
              return (
                <ul key={i} className="docs-article__list">
                  {block.items.map((item, j) => (
                    <li key={j}>{renderInline(item)}</li>
                  ))}
                </ul>
              );
          }
        })}
      </div>
    </article>
  );
});
