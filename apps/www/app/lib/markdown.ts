export interface HeadingBlock {
  readonly type: "heading";
  readonly level: 1 | 2 | 3;
  readonly text: string;
  readonly id: string;
}

export interface ParagraphBlock {
  readonly type: "paragraph";
  readonly text: string;
}

export interface CodeFenceBlock {
  readonly type: "code";
  readonly language: string;
  readonly content: string;
}

export interface ListBlock {
  readonly type: "list";
  readonly items: readonly string[];
}

export interface TableBlock {
  readonly type: "table";
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export type Block = HeadingBlock | ParagraphBlock | CodeFenceBlock | ListBlock | TableBlock;

function headingLevel(marker: string): 1 | 2 | 3 {
  if (marker.length === 1) return 1;
  if (marker.length === 2) return 2;
  return 3;
}

function lineAt(lines: ReadonlyArray<string>, index: number): string {
  return lines[index] ?? "";
}

// A GFM delimiter row: pipe-separated runs of dashes, with optional
// alignment colons, e.g. `| --- | :--: | ---: |`.
function isTableDelimiter(line: string): boolean {
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());
}

// Split one table row into trimmed cells, dropping the outer pipes.
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseMarkdown(source: string): readonly Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lineAt(lines, i);

    if (line.trim() === "") {
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const marker = headingMatch[1];
      const headingText = headingMatch[2];
      if (marker !== undefined && headingText !== undefined) {
        const level = headingLevel(marker);
        const text = headingText.trim();
        blocks.push({ type: "heading", level, text, id: slugify(text) });
      }
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lineAt(lines, i).startsWith("```")) {
        codeLines.push(lineAt(lines, i));
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: "code", language, content: codeLines.join("\n") });
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lineAt(lines, i).startsWith("- ")) {
        items.push(lineAt(lines, i).slice(2));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // GFM table: a header row immediately followed by a delimiter row.
    if (line.includes("|") && isTableDelimiter(lineAt(lines, i + 1))) {
      const headers = splitTableRow(line);
      i += 2; // consume the header and delimiter rows
      const rows: string[][] = [];
      while (i < lines.length && lineAt(lines, i).trim() !== "" && lineAt(lines, i).includes("|")) {
        rows.push(splitTableRow(lineAt(lines, i)));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lineAt(lines, i).trim() !== "" &&
      !lineAt(lines, i).match(/^#{1,3}\s/) &&
      !lineAt(lines, i).startsWith("```") &&
      !lineAt(lines, i).startsWith("- ") &&
      // A "|" line ends the paragraph ONLY when it actually starts a table
      // (i.e. a delimiter row follows). A "|" line with no delimiter row is
      // ordinary text and must be consumed here — otherwise it matches neither
      // the table branch above nor this loop, `i` never advances, and the
      // parser infinite-loops (e.g. `parseMarkdown("| not a table")`).
      !(lineAt(lines, i).includes("|") && isTableDelimiter(lineAt(lines, i + 1)))
    ) {
      paraLines.push(lineAt(lines, i));
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join(" ") });
    }
  }

  return blocks;
}

export interface InlineSegment {
  readonly type: "text" | "code" | "bold" | "link";
  readonly content: string;
  readonly href?: string;
}

export function parseInline(text: string): readonly InlineSegment[] {
  const result: InlineSegment[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    const token = match[0];
    if (token === undefined) continue;
    if (token.startsWith("`")) {
      result.push({ type: "code", content: token.slice(1, -1) });
    } else if (token.startsWith("**")) {
      result.push({ type: "bold", content: token.slice(2, -2) });
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link && link[1] !== undefined && link[2] !== undefined) {
        result.push({ type: "link", content: link[1], href: link[2] });
      } else {
        result.push({ type: "text", content: token });
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    result.push({ type: "text", content: text.slice(lastIndex) });
  }

  return result;
}
