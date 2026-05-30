/**
 * Build-time syntax-highlight prerendering for the docs.
 *
 * Docs markdown is static, so there is no reason to download the Shiki WASM
 * engine + grammars and tokenize in the browser on every visit. This plugin runs
 * Shiki once, in Node, over every code fence in every `*.docs.md` referenced by
 * `app/content/docs-content.ts`, and exposes the result as a virtual module:
 *
 *   import docsHighlights from "virtual:trygg-docs-highlights"; // Record<key, HighlightedLine[]>
 *
 * `app/lib/docs-highlights.ts` reads it synchronously, so `DocsCodeBlock` renders
 * fully highlighted on first paint — no client Shiki, no "Highlighting…" flash.
 * The output is byte-identical to the runtime highlighter because both share
 * `app/lib/shiki-highlight.ts` (same grammar set, theme, line split, and key).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

import { parseMarkdown } from "../app/lib/markdown";
import {
  createDocsHighlighter,
  highlightToLines,
  prerenderKey,
  type HighlightedLine,
} from "../app/lib/shiki-highlight";

const VIRTUAL_ID = "virtual:trygg-docs-highlights";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

// The exact set of docs markdown shipped to the docs section, read straight from
// the `?raw` imports in docs-content.ts so the plugin and the app never drift.
function docsMarkdownFiles(root: string): string[] {
  const docsContentPath = resolve(root, "app/content/docs-content.ts");
  const src = readFileSync(docsContentPath, "utf8");
  const dir = dirname(docsContentPath);
  const files: string[] = [];
  const re = /from\s+"([^"]+\.docs\.md)\?raw"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    files.push(resolve(dir, match[1]));
  }
  return files;
}

async function buildHighlights(root: string): Promise<Record<string, HighlightedLine[]>> {
  const hl = await createDocsHighlighter();
  const map: Record<string, HighlightedLine[]> = {};
  for (const file of docsMarkdownFiles(root)) {
    const markdown = readFileSync(file, "utf8");
    for (const block of parseMarkdown(markdown)) {
      if (block.type !== "code") continue;
      const lang = block.language || "tsx";
      map[prerenderKey(block.content, lang)] = highlightToLines(hl, block.content, lang);
    }
  }
  return map;
}

export function docsHighlightsPlugin(): Plugin {
  let root = process.cwd();
  let cache: Promise<Record<string, HighlightedLine[]>> | null = null;

  return {
    name: "trygg-docs-highlights",
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      cache ??= buildHighlights(root);
      const map = await cache;
      return `export default ${JSON.stringify(map)};`;
    },
    handleHotUpdate({ file, server }) {
      if (!file.endsWith(".docs.md") && !file.endsWith("docs-content.ts")) return;
      cache = null;
      const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
      if (mod) server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: "full-reload" });
    },
  };
}
