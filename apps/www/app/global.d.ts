/**
 * Global type declarations for apps/www
 */

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.tsx?raw" {
  const content: string;
  export default content;
}

declare module "*.css";

declare module "virtual:trygg-docs-highlights" {
  const map: Record<string, import("./lib/shiki-highlight").HighlightedLine[]>;
  export default map;
}

interface ImportMeta {
  glob<T>(
    pattern: string,
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>;
}
