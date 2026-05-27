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

export type Block = HeadingBlock | ParagraphBlock | CodeFenceBlock | ListBlock;

function headingLevel(marker: string): 1 | 2 | 3 {
  if (marker.length === 1) return 1;
  if (marker.length === 2) return 2;
  return 3;
}

function lineAt(lines: ReadonlyArray<string>, index: number): string {
  return lines[index] ?? "";
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

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lineAt(lines, i).trim() !== "" &&
      !lineAt(lines, i).match(/^#{1,3}\s/) &&
      !lineAt(lines, i).startsWith("```") &&
      !lineAt(lines, i).startsWith("- ")
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
  readonly type: "text" | "code" | "bold";
  readonly content: string;
}

export function parseInline(text: string): readonly InlineSegment[] {
  const result: InlineSegment[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
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
    } else {
      result.push({ type: "bold", content: token.slice(2, -2) });
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    result.push({ type: "text", content: text.slice(lastIndex) });
  }

  return result;
}
