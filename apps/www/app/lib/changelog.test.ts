/**
 * Changelog parser tests.
 *
 * Scope: verifies inline markdown parsing contracts for metadata
 * extraction and body block rendering.
 */
import { describe, it, expect } from "vitest";
import {
  parseChangelogMeta,
  renderChangelogBody,
  parseChangelogEntries,
  parseInlineSegments,
  resolveChangelogLink,
  type ChangelogBlock,
} from "./changelog";
import fixture from "../../changelogs/2026-04-28-generated-api-client.md?raw";

// =============================================================================
// parseChangelogMeta
// =============================================================================

describe("parseChangelogMeta", () => {
  // Scope: verifies graceful handling of missing frontmatter.
  // Assertion: returns undefined when no frontmatter delimiter is present.
  it("should return undefined when frontmatter is missing", () => {
    const meta = parseChangelogMeta("# Just a heading\n\nSome body text.");

    expect(meta).toBeUndefined();
  });

  // Scope: verifies graceful handling of incomplete frontmatter.
  // Assertion: returns undefined when a required field is absent.
  it("should return undefined when a required frontmatter field is missing", () => {
    const meta = parseChangelogMeta("---\ntitle: Hello\n---\n\n## Summary\n\nSomething.");

    expect(meta).toBeUndefined();
  });

  // Scope: verifies graceful handling of empty frontmatter values.
  // Assertion: returns undefined when a required field is empty.
  it("should return undefined when a required frontmatter field is empty", () => {
    const meta = parseChangelogMeta(
      '---\ntitle: ""\nversion: 1.0.0\n---\n\n## Summary\n\nSomething.',
    );

    expect(meta).toBeUndefined();
  });

  // Scope: verifies Summary section is required for list/detail metadata.
  // Assertion: returns undefined when the Summary section is absent.
  it("should return undefined when summary section is missing", () => {
    const meta = parseChangelogMeta("---\ntitle: Hello\nversion: 1.0.0\n---\n");

    expect(meta).toBeUndefined();
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
      (b) => b._tag === "Paragraph" && (b.text.includes("title:") || b.text.includes("version:")),
    );
    expect(frontmatterLeak).toBe(false);
  });

  // Scope: verifies ATX headings are rendered as typed Heading blocks.
  // Assertion: the fixture contains expected headings at correct levels.
  it("should render ATX headings as typed Heading blocks", () => {
    const blocks = renderChangelogBody(fixture);
    const headings = blocks.filter(
      (b): b is ChangelogBlock & { _tag: "Heading" } => b._tag === "Heading",
    );

    expect(headings.length).toBeGreaterThanOrEqual(4);
    expect(headings[0]).toEqual({ _tag: "Heading", level: 2, text: "Summary" });
    expect(headings[1]).toEqual({ _tag: "Heading", level: 2, text: "Added" });
    expect(headings.some((h) => h.text === "Fixed" && h.level === 2)).toBe(true);
  });

  // Scope: verifies consecutive non-empty text lines merge into Paragraph blocks.
  // Assertion: paragraphs contain joined text from consecutive lines.
  it("should combine consecutive non-empty text lines into Paragraph blocks", () => {
    const raw = "Line one.\nLine two.\n\nNew paragraph.";
    const blocks = renderChangelogBody(raw);

    expect(blocks[0]).toEqual({ _tag: "Paragraph", text: "Line one. Line two." });
    expect(blocks[1]).toEqual({ _tag: "Paragraph", text: "New paragraph." });
  });

  // Scope: verifies bullet list collection.
  // Assertion: consecutive dash lines form a single BulletList block.
  it("should render consecutive dash lines as one BulletList", () => {
    const raw = "- First\n- Second\n- Third\n";
    const blocks = renderChangelogBody(raw);

    expect(blocks.length).toBe(1);
    expect(blocks[0]).toEqual({
      _tag: "BulletList",
      items: ["First", "Second", "Third"],
    });
  });

  // Scope: verifies fenced code block parsing.
  // Assertion: code block has correct language tag and exact body.
  it("should render fenced code as CodeBlock with language and exact code body", () => {
    const raw = "```ts\nconst x = 1;\n```\n";
    const blocks = renderChangelogBody(raw);

    expect(blocks.length).toBe(1);
    expect(blocks[0]).toEqual({
      _tag: "CodeBlock",
      language: "ts",
      code: "const x = 1;",
    });
  });

  // Scope: verifies empty language fallback.
  // Assertion: fence with no language uses "text".
  it('should use "text" language when fence has no language specifier', () => {
    const raw = "```\nplain text\n```\n";
    const blocks = renderChangelogBody(raw);

    expect(blocks[0]).toEqual({
      _tag: "CodeBlock",
      language: "text",
      code: "plain text",
    });
  });

  // Scope: verifies mixed content ordering.
  // Assertion: fixture renders headings, bullets, paragraphs, and code blocks in order.
  it("should render fixture blocks in correct order", () => {
    const blocks = renderChangelogBody(fixture);
    const tags = blocks.map((b) => b._tag);

    expect(tags[0]).toBe("Heading");
    expect(tags[1]).toBe("Paragraph");
    expect(tags[2]).toBe("CodeBlock");
    expect(tags[3]).toBe("Heading");
    expect(tags[4]).toBe("BulletList");
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

    expect(entries.length).toBe(3);
    expect(entries[0].date).toBe("2026-05-01");
    expect(entries[1].date).toBe("2026-04-28");
    expect(entries[2].date).toBe("2026-04-01");
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

    expect(entries.map((entry) => entry.meta.version)).toEqual([
      "trygg@0.1.0-canary.2",
      "trygg@0.1.0-canary.1",
      "trygg@0.1.0-canary.0",
    ]);
  });

  // Scope: verifies name and date extraction from filename.
  // Assertion: name strips .md extension; date comes from YYYY-MM-DD prefix.
  it("should extract name and date from filename", () => {
    const modules: Record<string, string> = {
      "2026-04-28-generated-api-client.md":
        "---\ntitle: Generated API Client\nversion: 0.3.0-canary.0\n---\n\n## Summary\n\nIntroduces a generated API client.\n",
    };

    const entries = parseChangelogEntries(modules);

    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe("2026-04-28-generated-api-client");
    expect(entries[0].date).toBe("2026-04-28");
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

    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe("2026-04-28-valid");
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

    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe("2026-04-28-valid");
  });

  // Scope: verifies empty modules return empty array.
  // Assertion: no entries produced from empty record.
  it("should return empty array for empty modules", () => {
    const entries = parseChangelogEntries({});

    expect(entries.length).toBe(0);
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

    expect(segments).toEqual([
      { _tag: "Text", text: "foo " },
      { _tag: "InlineCode", code: "bar" },
      { _tag: "Text", text: " baz" },
    ]);
  });

  // Scope: verifies plain text without backticks returns single Text segment.
  // Assertion: no InlineCode segments for plain text.
  it("should return single Text segment for plain text", () => {
    const segments = parseInlineSegments("hello world");

    expect(segments).toEqual([{ _tag: "Text", text: "hello world" }]);
  });

  // Scope: verifies multiple inline code spans in one text.
  // Assertion: each backtick pair becomes an InlineCode segment.
  it("should handle multiple inline code spans", () => {
    const segments = parseInlineSegments("use `foo` and `bar` together");

    expect(segments).toEqual([
      { _tag: "Text", text: "use " },
      { _tag: "InlineCode", code: "foo" },
      { _tag: "Text", text: " and " },
      { _tag: "InlineCode", code: "bar" },
      { _tag: "Text", text: " together" },
    ]);
  });

  // Scope: verifies empty backticks are ignored.
  // Assertion: no InlineCode segment for empty content.
  it("should skip empty backtick spans", () => {
    const segments = parseInlineSegments("before `` after");

    expect(segments).toEqual([
      { _tag: "Text", text: "before " },
      { _tag: "Text", text: " after" },
    ]);
  });

  // Scope: verifies unmatched backtick is treated as text.
  // Assertion: stray backtick becomes part of a Text segment.
  it("should treat unmatched backtick as text", () => {
    const segments = parseInlineSegments("foo `bar");

    expect(segments).toEqual([{ _tag: "Text", text: "foo `bar" }]);
  });

  // Scope: verifies empty string returns empty array.
  // Assertion: no segments for empty input.
  it("should return empty array for empty string", () => {
    const segments = parseInlineSegments("");

    expect(segments).toEqual([]);
  });

  // Scope: verifies markdown link extraction.
  // Assertion: [text](url) becomes a Link segment.
  it("should extract markdown link segments", () => {
    const segments = parseInlineSegments(
      "see the [API guide](../../../packages/core/src/api/api.docs.md).",
    );

    expect(segments).toEqual([
      { _tag: "Text", text: "see the " },
      { _tag: "Link", text: "API guide", href: "../../../packages/core/src/api/api.docs.md" },
      { _tag: "Text", text: "." },
    ]);
  });

  // Scope: verifies inline code and links coexist.
  // Assertion: backticks parsed first, then links in remaining text.
  it("should handle inline code and links together", () => {
    const segments = parseInlineSegments("use `Foo` with [docs](doc.md)");

    expect(segments).toEqual([
      { _tag: "Text", text: "use " },
      { _tag: "InlineCode", code: "Foo" },
      { _tag: "Text", text: " with " },
      { _tag: "Link", text: "docs", href: "doc.md" },
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

    expect(url).toBe(
      "https://github.com/EduSantosBrito/trygg/blob/main/packages/core/src/api/api.docs.md",
    );
  });

  // Scope: verifies external URLs pass through unchanged.
  // Assertion: https:// links are returned as-is.
  it("should pass through external URLs unchanged", () => {
    const url = resolveChangelogLink("https://example.com/doc");

    expect(url).toBe("https://example.com/doc");
  });
});
