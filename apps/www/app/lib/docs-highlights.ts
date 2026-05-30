/**
 * Synchronous access to build-time prerendered docs highlights.
 *
 * The map is produced by the `trygg-docs-highlights` Vite plugin (see
 * vite-plugins/docs-highlights.ts) and keyed identically to the runtime path, so
 * a docs code block resolves on the first synchronous read — no Shiki download,
 * no async fork, no "Highlighting…" flash.
 */
import docsHighlights from "virtual:trygg-docs-highlights";

import { prerenderKey, type HighlightedLine } from "./shiki-highlight";

export function highlightCodeSync(code: string, lang = "tsx"): HighlightedLine[] | undefined {
  return docsHighlights[prerenderKey(code, lang)];
}
