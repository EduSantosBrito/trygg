/**
 * Global type declarations for apps/www
 */

interface Window {
  datafast?: (...args: unknown[]) => void;
}

declare module "*.md?raw" {
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
