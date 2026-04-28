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

export type InlineSegment =
  | { readonly _tag: "Text"; readonly text: string }
  | { readonly _tag: "InlineCode"; readonly code: string }
  | { readonly _tag: "Link"; readonly text: string; readonly href: string };

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

const parseLinksInText = (text: string): ReadonlyArray<InlineSegment> => {
  const segments: Array<InlineSegment> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(LINK_RE)) {
    if (match.index > lastIndex) {
      segments.push({ _tag: "Text", text: text.slice(lastIndex, match.index) });
    }
    segments.push({ _tag: "Link", text: match[1], href: match[2] });
    lastIndex = (match.index ?? 0) + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ _tag: "Text", text: text.slice(lastIndex) });
  }

  return segments;
};

export const parseInlineSegments = (text: string): ReadonlyArray<InlineSegment> => {
  const segments: Array<InlineSegment> = [];
  let remaining = text;

  while (remaining.length > 0) {
    const tick = remaining.indexOf("`");
    if (tick === -1) {
      segments.push({ _tag: "Text", text: remaining });
      break;
    }

    if (tick > 0) {
      segments.push({ _tag: "Text", text: remaining.slice(0, tick) });
    }

    const end = remaining.indexOf("`", tick + 1);
    if (end === -1) {
      const last = segments[segments.length - 1];
      if (last && last._tag === "Text") {
        segments[segments.length - 1] = { _tag: "Text", text: last.text + remaining.slice(tick) };
      } else {
        segments.push({ _tag: "Text", text: remaining.slice(tick) });
      }
      break;
    }

    const code = remaining.slice(tick + 1, end);
    if (code.length > 0) {
      segments.push({ _tag: "InlineCode", code });
    }

    remaining = remaining.slice(end + 1);
  }

  return segments.flatMap((seg) => (seg._tag === "Text" ? parseLinksInText(seg.text) : [seg]));
};

export const resolveChangelogLink = (href: string): string => {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;

  // Resolve relative path from apps/www/changelogs/ to repo root
  const changelogDir = "apps/www/changelogs/";
  const resolved = new URL(href, new URL(changelogDir, "file:///")).pathname.slice(1);

  return `https://github.com/EduSantosBrito/trygg/blob/main/${resolved}`;
};

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

const stripFrontmatter = (raw: string): string => {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return trimmed;

  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) return trimmed;

  return trimmed.slice(end + 4).trimStart();
};

const toPlainSummary = (text: string): string =>
  text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/`([^`]+)`/g, "$1");

const extractSummarySection = (raw: string): string | undefined => {
  const lines = stripFrontmatter(raw).split("\n");
  const summaryIndex = lines.findIndex((line) => line.trim() === "## Summary");
  if (summaryIndex === -1) return undefined;

  const paragraph: Array<string> = [];

  for (const line of lines.slice(summaryIndex + 1)) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) break;
    if (trimmed.length === 0) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (trimmed.startsWith("```")) break;

    paragraph.push(trimmed);
  }

  if (paragraph.length === 0) return undefined;

  return toPlainSummary(paragraph.join(" "));
};

export const parseChangelogMeta = (raw: string): ChangelogMeta | undefined => {
  const frontmatter = extractFrontmatter(raw);
  if (!frontmatter) return undefined;

  const title = frontmatter.title;
  const version = frontmatter.version;
  const summary = extractSummarySection(raw);

  if (
    typeof title !== "string" ||
    title.length === 0 ||
    typeof version !== "string" ||
    version.length === 0 ||
    summary === undefined ||
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
  const body = stripFrontmatter(raw);
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

type SemverVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: ReadonlyArray<string>;
};

const parseSemverVersion = (version: string): SemverVersion | undefined => {
  const normalized = version.includes("@") ? version.slice(version.lastIndexOf("@") + 1) : version;
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return undefined;

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  const prerelease = match[4]?.split(".") ?? [];

  return { major, minor, patch, prerelease };
};

const comparePrereleaseIdentifier = (left: string, right: string): number => {
  if (left === right) return 0;

  const leftNumber = Number.parseInt(left, 10);
  const rightNumber = Number.parseInt(right, 10);
  const leftIsNumber = left === String(leftNumber);
  const rightIsNumber = right === String(rightNumber);

  if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
  if (leftIsNumber) return -1;
  if (rightIsNumber) return 1;

  return left.localeCompare(right);
};

const compareSemver = (left: string, right: string): number => {
  const leftVersion = parseSemverVersion(left);
  const rightVersion = parseSemverVersion(right);
  if (!leftVersion || !rightVersion) return left.localeCompare(right);

  const major = leftVersion.major - rightVersion.major;
  if (major !== 0) return major;

  const minor = leftVersion.minor - rightVersion.minor;
  if (minor !== 0) return minor;

  const patch = leftVersion.patch - rightVersion.patch;
  if (patch !== 0) return patch;

  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) return 0;
  if (leftVersion.prerelease.length === 0) return 1;
  if (rightVersion.prerelease.length === 0) return -1;

  const maxLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let i = 0; i < maxLength; i++) {
    const leftIdentifier = leftVersion.prerelease[i];
    const rightIdentifier = rightVersion.prerelease[i];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;

    const identifier = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
    if (identifier !== 0) return identifier;
  }

  return 0;
};

const compareChangelogEntries = (left: ChangelogEntry, right: ChangelogEntry): number => {
  const date = right.date.localeCompare(left.date);
  if (date !== 0) return date;

  return compareSemver(right.meta.version, left.meta.version);
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
    .sort(compareChangelogEntries);
};

export const changelogEntries: ReadonlyArray<ChangelogEntry> = parseChangelogEntries(rawModules);

export const findChangelogEntry = (name: string): ChangelogEntry | undefined =>
  changelogEntries.find((entry) => entry.name === name);
