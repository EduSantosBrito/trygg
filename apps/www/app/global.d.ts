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

interface ImportMeta {
  glob<T>(
    pattern: string,
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>;
}
