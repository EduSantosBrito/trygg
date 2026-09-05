declare const process: {
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  readonly stdout: { readonly isTTY?: boolean };
  cwd(): string;
  exit(code?: number): never;
};

interface ImportMeta {
  readonly dir: string;
  readonly main: boolean;
}

declare module "node:path" {
  export const sep: string;
  export function resolve(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(path: string): string;
}
