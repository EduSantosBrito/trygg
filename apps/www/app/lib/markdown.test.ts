/**
 * Markdown block parser tests.
 *
 * Scope: regression coverage for the GFM table / paragraph interaction in
 * {@link parseMarkdown}, in particular that a "|" line which does NOT begin a
 * valid table is consumed as paragraph text rather than stalling the parser.
 */
import { assert, describe, it } from "@effect/vitest";
import { type Block, parseMarkdown } from "./markdown";

describe("parseMarkdown — malformed pipe lines (regression: infinite loop)", () => {
  it("consumes a lone '|' line at EOF as a paragraph instead of hanging", () => {
    // Before the fix this input never terminated: the table branch is skipped
    // (no delimiter row follows) and the paragraph loop refused to advance past
    // a "|" line, so `i` never incremented. The test timing out IS the failure.
    const blocks = parseMarkdown("| not a table");
    assert.deepStrictEqual(blocks as Block[], [
      { type: "paragraph", text: "| not a table" },
    ]);
  });

  it("consumes a '|' line followed by a blank line", () => {
    const blocks = parseMarkdown("| header\n\n");
    assert.deepStrictEqual(blocks as Block[], [
      { type: "paragraph", text: "| header" },
    ]);
  });

  it("joins consecutive non-delimiter '|' lines into one paragraph", () => {
    const blocks = parseMarkdown("| x |\n| y |");
    assert.deepStrictEqual(blocks as Block[], [
      { type: "paragraph", text: "| x | | y |" },
    ]);
  });
});

describe("parseMarkdown — valid tables still parse", () => {
  it("parses a table that starts the document", () => {
    const blocks = parseMarkdown("| h1 | h2 |\n| --- | --- |\n| c1 | c2 |");
    assert.deepStrictEqual(blocks as Block[], [
      { type: "table", headers: ["h1", "h2"], rows: [["c1", "c2"]] },
    ]);
  });

  it("parses a table with multiple continuation rows", () => {
    const blocks = parseMarkdown("| h |\n| --- |\n| a |\n| b |");
    assert.deepStrictEqual(blocks as Block[], [
      { type: "table", headers: ["h"], rows: [["a"], ["b"]] },
    ]);
  });

  it("parses a paragraph immediately followed by a table (does not swallow the table)", () => {
    // The naive fix (dropping the "|" guard entirely) regresses here: the
    // paragraph loop would consume the table header + delimiter + rows as text.
    const blocks = parseMarkdown("intro text\n| h |\n| --- |\n| a |");
    assert.deepStrictEqual(blocks as Block[], [
      { type: "paragraph", text: "intro text" },
      { type: "table", headers: ["h"], rows: [["a"]] },
    ]);
  });
});
