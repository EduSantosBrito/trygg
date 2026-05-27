/**
 * Changelog parser tests.
 *
 * Scope: verifies inline markdown parsing contracts for metadata
 * extraction and body block rendering.
 */
import { assert, describe, it } from "@effect/vitest";
import fixture from "../../changelogs/2026-04-28-generated-api-client.md?raw";
import {
  ChangelogBlock,
  InlineSegment,
  parseChangelogEntries,
  parseChangelogMeta,
  parseInlineSegments,
  renderChangelogBody,
  resolveChangelogLink,
} from "./changelog";

// =============================================================================
// parseChangelogMeta
// =============================================================================

describe("parseChangelogMeta", () => {
  // Scope: verifies graceful handling of missing frontmatter.
  // Assertion: returns undefined when no frontmatter delimiter is present.
  it("should return undefined when frontmatter is missing", () => {
    const meta = parseChangelogMeta("# Just a heading\n\nSome body text.");

    assert.isUndefined(meta);
  });

  // Scope: verifies graceful handling of incomplete frontmatter.
  // Assertion: returns undefined when a required field is absent.
  it("should return undefined when a required frontmatter field is missing", () => {
    const meta = parseChangelogMeta("---\ntitle: Hello\n---\n\n## Summary\n\nSomething.");

    assert.isUndefined(meta);
  });

  // Scope: verifies graceful handling of empty frontmatter values.
  // Assertion: returns undefined when a required field is empty.
  it("should return undefined when a required frontmatter field is empty", () => {
    const meta = parseChangelogMeta(
      '---\ntitle: ""\nversion: 1.0.0\n---\n\n## Summary\n\nSomething.',
    );

    assert.isUndefined(meta);
  });

  // Scope: verifies Summary section is required for list/detail metadata.
  // Assertion: returns undefined when the Summary section is absent.
  it("should return undefined when summary section is missing", () => {
    const meta = parseChangelogMeta("---\ntitle: Hello\nversion: 1.0.0\n---\n");

    assert.isUndefined(meta);
  });
});

// =============================================================================
// renderChangelogBody
// =============================================================================

describe("renderChangelogBody", () => {
  // Scope: verifies frontmatter is excluded from body blocks.
  // Assertion: no block contains frontmatter content.
  it("should skip frontmatter when rendering body blocks", () => {
    const blocks = renderChangelogBody(fixture);

    const frontmatterLeak = blocks.some(
      (block) =>
        ChangelogBlock.$is("Paragraph")(block) &&
        (block.text.includes("title:") || block.text.includes("version:")),
    );
    assert.isFalse(frontmatterLeak);
  });

  // Scope: verifies ATX headings are rendered as typed Heading blocks.
  // Assertion: the fixture contains expected headings at correct levels.
  it("should render ATX headings as typed Heading blocks", () => {
    const blocks = renderChangelogBody(fixture);
    const headings = blocks.filter(ChangelogBlock.$is("Heading"));

    assert.isAtLeast(headings.length, 4);
    assert.deepStrictEqual(headings[0], ChangelogBlock.Heading({ level: 2, text: "Summary" }));
    assert.deepStrictEqual(headings[1], ChangelogBlock.Heading({ level: 2, text: "Added" }));
    assert.isTrue(headings.some((heading) => heading.text === "Fixed" && heading.level === 2));
  });

  // Scope: verifies consecutive non-empty text lines merge into Paragraph blocks.
  // Assertion: paragraphs contain joined text from consecutive lines.
  it("should combine consecutive non-empty text lines into Paragraph blocks", () => {
    const raw = "Line one.\nLine two.\n\nNew paragraph.";
    const blocks = renderChangelogBody(raw);

    assert.deepStrictEqual(blocks[0], ChangelogBlock.Paragraph({ text: "Line one. Line two." }));
    assert.deepStrictEqual(blocks[1], ChangelogBlock.Paragraph({ text: "New paragraph." }));
  });

  // Scope: verifies bullet list collection.
  // Assertion: consecutive dash lines form a single BulletList block.
  it("should render consecutive dash lines as one BulletList", () => {
    const raw = "- First\n- Second\n- Third\n";
    const blocks = renderChangelogBody(raw);

    assert.strictEqual(blocks.length, 1);
    assert.deepStrictEqual(
      blocks[0],
      ChangelogBlock.BulletList({ items: ["First", "Second", "Third"] }),
    );
  });

  // Scope: verifies fenced code block parsing.
  // Assertion: code block has correct language tag and exact body.
  it("should render fenced code as CodeBlock with language and exact code body", () => {
    const raw = "```ts\nconst x = 1;\n```\n";
    const blocks = renderChangelogBody(raw);

    assert.strictEqual(blocks.length, 1);
    assert.deepStrictEqual(
      blocks[0],
      ChangelogBlock.CodeBlock({ language: "ts", code: "const x = 1;" }),
    );
  });

  // Scope: verifies empty language fallback.
  // Assertion: fence with no language uses "text".
  it('should use "text" language when fence has no language specifier', () => {
    const raw = "```\nplain text\n```\n";
    const blocks = renderChangelogBody(raw);

    assert.deepStrictEqual(
      blocks[0],
      ChangelogBlock.CodeBlock({ language: "text", code: "plain text" }),
    );
  });

  // Scope: verifies mixed content ordering.
  // Assertion: fixture renders headings, bullets, paragraphs, and code blocks in order.
  it("should render fixture blocks in correct order", () => {
    const blocks = renderChangelogBody(fixture);
    const tags = blocks.map((block) => block._tag);

    assert.strictEqual(tags[0], "Heading");
    assert.strictEqual(tags[1], "Paragraph");
    assert.strictEqual(tags[2], "CodeBlock");
    assert.strictEqual(tags[3], "Heading");
    assert.strictEqual(tags[4], "BulletList");
  });
});

// =============================================================================
// parseChangelogEntries
// =============================================================================

describe("parseChangelogEntries", () => {
  // Scope: verifies entries are sorted newest first by filename date prefix.
  // Assertion: entries ordered descending by ISO date string.
  it("should sort entries newest first by date", () => {
    const modules: Record<string, string> = {
      "2026-04-28-entry-a.md": "---\ntitle: A\nversion: 1.0.0\n---\n\n## Summary\n\nSummary A\n",
      "2026-05-01-entry-b.md": "---\ntitle: B\nversion: 1.0.0\n---\n\n## Summary\n\nSummary B\n",
      "2026-04-01-entry-c.md": "---\ntitle: C\nversion: 1.0.0\n---\n\n## Summary\n\nSummary C\n",
    };

    const entries = parseChangelogEntries(modules);

    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0]?.date, "2026-05-01");
    assert.strictEqual(entries[1]?.date, "2026-04-28");
    assert.strictEqual(entries[2]?.date, "2026-04-01");
  });

  // Scope: verifies same-day entries are sorted newest first by semver.
  // Assertion: higher semver versions precede lower versions for matching dates.
  it("should sort entries with the same date by semver version", () => {
    const modules: Record<string, string> = {
      "2026-02-05-entry-a.md":
        "---\ntitle: A\nversion: trygg@0.1.0-canary.0\n---\n\n## Summary\n\nSummary A\n",
      "2026-02-05-entry-b.md":
        "---\ntitle: B\nversion: trygg@0.1.0-canary.2\n---\n\n## Summary\n\nSummary B\n",
      "2026-02-05-entry-c.md":
        "---\ntitle: C\nversion: trygg@0.1.0-canary.1\n---\n\n## Summary\n\nSummary C\n",
    };

    const entries = parseChangelogEntries(modules);

    assert.deepStrictEqual(
      entries.map((entry) => entry.meta.version),
      ["trygg@0.1.0-canary.2", "trygg@0.1.0-canary.1", "trygg@0.1.0-canary.0"],
    );
  });

  // Scope: verifies name and date extraction from filename.
  // Assertion: name strips .md extension; date comes from YYYY-MM-DD prefix.
  it("should extract name and date from filename", () => {
    const modules: Record<string, string> = {
      "2026-04-28-generated-api-client.md":
        "---\ntitle: Generated API Client\nversion: 0.3.0-canary.0\n---\n\n## Summary\n\nIntroduces a generated API client.\n",
    };

    const entries = parseChangelogEntries(modules);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.name, "2026-04-28-generated-api-client");
    assert.strictEqual(entries[0]?.date, "2026-04-28");
  });

  // Scope: verifies malformed filenames without YYYY-MM-DD prefix are excluded.
  // Assertion: entries array does not include malformed filenames.
  it("should skip files without YYYY-MM-DD prefix", () => {
    const modules: Record<string, string> = {
      "no-date-prefix.md":
        "---\ntitle: No Date\nversion: 1.0.0\n---\n\n## Summary\n\nMissing date.\n",
      "2026-04-28-valid.md": "---\ntitle: Valid\nversion: 1.0.0\n---\n\n## Summary\n\nHas date.\n",
    };

    const entries = parseChangelogEntries(modules);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.name, "2026-04-28-valid");
  });

  // Scope: verifies entries with invalid metadata are excluded.
  // Assertion: entries array filters out files with missing or empty frontmatter fields.
  it("should skip files with invalid metadata", () => {
    const modules: Record<string, string> = {
      "2026-04-28-invalid.md": '---\ntitle: ""\nversion: 1.0.0\n---\n\n## Summary\n\nSomething\n',
      "2026-04-28-valid.md":
        "---\ntitle: Valid\nversion: 1.0.0\n---\n\n## Summary\n\nGood metadata.\n",
    };

    const entries = parseChangelogEntries(modules);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.name, "2026-04-28-valid");
  });

  // Scope: verifies empty modules return empty array.
  // Assertion: no entries produced from empty record.
  it("should return empty array for empty modules", () => {
    const entries = parseChangelogEntries({});

    assert.strictEqual(entries.length, 0);
  });
});

// =============================================================================
// parseInlineSegments
// =============================================================================

describe("parseInlineSegments", () => {
  // Scope: verifies inline code extraction between backticks.
  // Assertion: segments alternate Text and InlineCode correctly.
  it("should extract inline code segments", () => {
    const segments = parseInlineSegments("foo `bar` baz");

    assert.deepStrictEqual(segments, [
      InlineSegment.Text({ text: "foo " }),
      InlineSegment.InlineCode({ code: "bar" }),
      InlineSegment.Text({ text: " baz" }),
    ]);
  });

  // Scope: verifies plain text without backticks returns single Text segment.
  // Assertion: no InlineCode segments for plain text.
  it("should return single Text segment for plain text", () => {
    const segments = parseInlineSegments("hello world");

    assert.deepStrictEqual(segments, [InlineSegment.Text({ text: "hello world" })]);
  });

  // Scope: verifies multiple inline code spans in one text.
  // Assertion: each backtick pair becomes an InlineCode segment.
  it("should handle multiple inline code spans", () => {
    const segments = parseInlineSegments("use `foo` and `bar` together");

    assert.deepStrictEqual(segments, [
      InlineSegment.Text({ text: "use " }),
      InlineSegment.InlineCode({ code: "foo" }),
      InlineSegment.Text({ text: " and " }),
      InlineSegment.InlineCode({ code: "bar" }),
      InlineSegment.Text({ text: " together" }),
    ]);
  });

  // Scope: verifies empty backticks are ignored.
  // Assertion: no InlineCode segment for empty content.
  it("should skip empty backtick spans", () => {
    const segments = parseInlineSegments("before `` after");

    assert.deepStrictEqual(segments, [
      InlineSegment.Text({ text: "before " }),
      InlineSegment.Text({ text: " after" }),
    ]);
  });

  // Scope: verifies unmatched backtick is treated as text.
  // Assertion: stray backtick becomes part of a Text segment.
  it("should treat unmatched backtick as text", () => {
    const segments = parseInlineSegments("foo `bar");

    assert.deepStrictEqual(segments, [InlineSegment.Text({ text: "foo `bar" })]);
  });

  // Scope: verifies empty string returns empty array.
  // Assertion: no segments for empty input.
  it("should return empty array for empty string", () => {
    const segments = parseInlineSegments("");

    assert.deepStrictEqual(segments, []);
  });

  // Scope: verifies markdown link extraction.
  // Assertion: [text](url) becomes a Link segment.
  it("should extract markdown link segments", () => {
    const segments = parseInlineSegments(
      "see the [API guide](../../../packages/core/src/api/api.docs.md).",
    );

    assert.deepStrictEqual(segments, [
      InlineSegment.Text({ text: "see the " }),
      InlineSegment.Link({ text: "API guide", href: "../../../packages/core/src/api/api.docs.md" }),
      InlineSegment.Text({ text: "." }),
    ]);
  });

  // Scope: verifies inline code and links coexist.
  // Assertion: backticks parsed first, then links in remaining text.
  it("should handle inline code and links together", () => {
    const segments = parseInlineSegments("use `Foo` with [docs](doc.md)");

    assert.deepStrictEqual(segments, [
      InlineSegment.Text({ text: "use " }),
      InlineSegment.InlineCode({ code: "Foo" }),
      InlineSegment.Text({ text: " with " }),
      InlineSegment.Link({ text: "docs", href: "doc.md" }),
    ]);
  });
});

// =============================================================================
// resolveChangelogLink
// =============================================================================

describe("resolveChangelogLink", () => {
  // Scope: verifies relative path resolution to GitHub blob URL.
  // Assertion: ../ traversal from changelogs/ resolves to correct blob path.
  it("should resolve relative repo path to GitHub blob URL", () => {
    const url = resolveChangelogLink("../../../packages/core/src/api/api.docs.md");

    assert.strictEqual(
      url,
      "https://github.com/EduSantosBrito/trygg/blob/main/packages/core/src/api/api.docs.md",
    );
  });

  // Scope: verifies external URLs pass through unchanged.
  // Assertion: https:// links are returned as-is.
  it("should pass through external URLs unchanged", () => {
    const url = resolveChangelogLink("https://example.com/doc");

    assert.strictEqual(url, "https://example.com/doc");
  });
});
