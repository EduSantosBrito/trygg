/**
 * Changelog parser tests.
 *
 * Scope: verifies inline markdown parsing contracts for metadata
 * extraction and body block rendering.
 */
import { describe, it, expect } from "vitest";
import { parseChangelogMeta, renderChangelogBody, type ChangelogBlock } from "./changelog";
import fixture from "../content/changelog/2026-04-28-generated-api-client.md?raw";

// =============================================================================
// parseChangelogMeta
// =============================================================================

describe("parseChangelogMeta", () => {
  // Scope: verifies happy-path frontmatter extraction.
  // Assertion: returns exact title, version, and summary from the fixture.
  it("should extract title, version, and summary from fixture frontmatter", () => {
    const meta = parseChangelogMeta(fixture);

    expect(meta).toBeDefined();
    expect(meta?.title).toBe("Generated API Client");
    expect(meta?.version).toBe("0.3.0-canary.0");
    expect(meta?.summary).toBe(
      "Introduces a generated API client with type-safe request builders and runtime validation using Effect Schema.",
    );
  });

  // Scope: verifies graceful handling of missing frontmatter.
  // Assertion: returns undefined when no frontmatter delimiter is present.
  it("should return undefined when frontmatter is missing", () => {
    const meta = parseChangelogMeta("# Just a heading\n\nSome body text.");

    expect(meta).toBeUndefined();
  });

  // Scope: verifies graceful handling of incomplete frontmatter.
  // Assertion: returns undefined when a required field is absent.
  it("should return undefined when a required frontmatter field is missing", () => {
    const meta = parseChangelogMeta("---\ntitle: Hello\nversion: 1.0.0\n---\n");

    expect(meta).toBeUndefined();
  });

  // Scope: verifies graceful handling of empty frontmatter values.
  // Assertion: returns undefined when a required field is empty.
  it("should return undefined when a required frontmatter field is empty", () => {
    const meta = parseChangelogMeta('---\ntitle: ""\nversion: 1.0.0\nsummary: Something\n---\n');

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

    expect(headings.length).toBeGreaterThanOrEqual(5);
    expect(headings[0]).toEqual({ _tag: "Heading", level: 2, text: "Overview" });
    expect(headings[1]).toEqual({ _tag: "Heading", level: 2, text: "What's new" });
    expect(headings.some((h) => h.text === "Usage" && h.level === 2)).toBe(true);
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
    expect(tags[2]).toBe("Heading");
    expect(tags[3]).toBe("BulletList");
  });
});
