/**
 * Inline markdown parser for changelog entries.
 *
 * Total and non-throwing: malformed/missing frontmatter returns `undefined`;
 * malformed body yields best-effort blocks.
 */

export type ChangelogMeta = {
  readonly title: string;
  readonly version: string;
  readonly summary: string;
};

export type ChangelogBlock =
  | { readonly _tag: "Heading"; readonly level: 2 | 3 | 4; readonly text: string }
  | { readonly _tag: "Paragraph"; readonly text: string }
  | { readonly _tag: "BulletList"; readonly items: ReadonlyArray<string> }
  | { readonly _tag: "CodeBlock"; readonly language: string; readonly code: string };

// =============================================================================
// Frontmatter
// =============================================================================

const extractFrontmatter = (raw: string): Record<string, string> | undefined => {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return undefined;

  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) return undefined;

  const lines = trimmed.slice(3, end).split("\n");
  const frontmatter: Record<string, string> = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      frontmatter[key] = value;
    }
  }

  return frontmatter;
};

export const parseChangelogMeta = (raw: string): ChangelogMeta | undefined => {
  const frontmatter = extractFrontmatter(raw);
  if (!frontmatter) return undefined;

  const title = frontmatter.title;
  const version = frontmatter.version;
  const summary = frontmatter.summary;

  if (
    typeof title !== "string" ||
    title.length === 0 ||
    typeof version !== "string" ||
    version.length === 0 ||
    typeof summary !== "string" ||
    summary.length === 0
  ) {
    return undefined;
  }

  return { title, version, summary };
};

// =============================================================================
// Body blocks
// =============================================================================

const parseHeading = (line: string): ChangelogBlock | undefined => {
  const match = line.match(/^(#{2,4})\s+(.+)$/);
  if (!match) return undefined;

  const level = match[1].length as 2 | 3 | 4;
  const text = match[2].trim();

  return { _tag: "Heading", level, text };
};

const parseBullet = (line: string): string | undefined => {
  const trimmed = line.trim();
  if (trimmed.startsWith("- ")) {
    return trimmed.slice(2).trim();
  }
  return undefined;
};

type ParseState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "InParagraph"; readonly lines: Array<string> }
  | { readonly _tag: "InBulletList"; readonly items: Array<string> }
  | { readonly _tag: "InCodeBlock"; readonly language: string; readonly lines: Array<string> };

const flushState = (state: ParseState): ReadonlyArray<ChangelogBlock> => {
  switch (state._tag) {
    case "InParagraph":
      return [{ _tag: "Paragraph", text: state.lines.join(" ") }];
    case "InBulletList":
      return [{ _tag: "BulletList", items: state.items }];
    case "InCodeBlock":
      return [{ _tag: "CodeBlock", language: state.language, code: state.lines.join("\n") }];
    default:
      return [];
  }
};

export const renderChangelogBody = (raw: string): ReadonlyArray<ChangelogBlock> => {
  const trimmed = raw.trimStart();

  let bodyStart = 0;
  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("\n---", 3);
    if (end !== -1) {
      bodyStart = end + 4; // Skip past \n---
    }
  }

  const body = trimmed.slice(bodyStart).trimStart();
  const lines = body.split("\n");

  const blocks: Array<ChangelogBlock> = [];
  let state: ParseState = { _tag: "Idle" };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code fence
    const fenceMatch = line.match(/^```(.*)$/);
    if (fenceMatch) {
      if (state._tag === "InCodeBlock") {
        blocks.push(...flushState(state));
        state = { _tag: "Idle" };
      } else {
        blocks.push(...flushState(state));
        const language = fenceMatch[1].trim();
        state = { _tag: "InCodeBlock", language: language || "text", lines: [] };
      }
      continue;
    }

    if (state._tag === "InCodeBlock") {
      state.lines.push(line);
      continue;
    }

    // Heading
    const heading = parseHeading(line);
    if (heading) {
      blocks.push(...flushState(state));
      blocks.push(heading);
      state = { _tag: "Idle" };
      continue;
    }

    // Empty line
    if (line.trim().length === 0) {
      blocks.push(...flushState(state));
      state = { _tag: "Idle" };
      continue;
    }

    // Bullet
    const bullet = parseBullet(line);
    if (bullet) {
      if (state._tag === "InBulletList") {
        state.items.push(bullet);
      } else {
        blocks.push(...flushState(state));
        state = { _tag: "InBulletList", items: [bullet] };
      }
      continue;
    }

    // Regular text line
    if (state._tag === "InParagraph") {
      state.lines.push(line.trim());
    } else {
      blocks.push(...flushState(state));
      state = { _tag: "InParagraph", lines: [line.trim()] };
    }
  }

  blocks.push(...flushState(state));

  return blocks;
};

// =============================================================================
// Registry
// =============================================================================

const rawModules = import.meta.glob<string>("../../changelogs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export type ChangelogEntry = {
  readonly name: string;
  readonly date: string;
  readonly meta: ChangelogMeta;
  readonly blocks: ReadonlyArray<ChangelogBlock>;
};

const dateFromFilename = (filename: string): string | undefined => {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
};

const parseEntry = (name: string, date: string, raw: string): ChangelogEntry | undefined => {
  const meta = parseChangelogMeta(raw);
  if (!meta) return undefined;
  const blocks = renderChangelogBody(raw);
  return { name, date, meta, blocks };
};

export const parseChangelogEntries = (
  modules: Record<string, string>,
): ReadonlyArray<ChangelogEntry> => {
  return Object.entries(modules)
    .map(([path, raw]) => {
      const filename = path.replace(/^.*\//, "");
      const name = filename.replace(/\.md$/, "");
      const date = dateFromFilename(filename);
      if (!date) return undefined;
      return parseEntry(name, date, raw);
    })
    .filter((entry): entry is ChangelogEntry => entry !== undefined)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
};

export const changelogEntries: ReadonlyArray<ChangelogEntry> = parseChangelogEntries(rawModules);

export const findChangelogEntry = (name: string): ChangelogEntry | undefined =>
  changelogEntries.find((entry) => entry.name === name);
