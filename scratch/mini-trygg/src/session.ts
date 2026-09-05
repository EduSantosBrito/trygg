import * as path from "node:path";
import * as ts from "typescript";
import { Effect } from "effect";
import {
  analyzeProject,
  CheckInternalError,
  loadProjectConfig,
  type CheckConfigError,
  type CheckOptions,
  type CheckResult,
  type ResolvedProjectConfig,
} from "./engine.js";

export interface CheckSession {
  readonly projectDir: string;
  readonly configPath: string | undefined;
  openDocument(fileName: string, text: string, version: number): void;
  updateDocument(fileName: string, text: string, version: number): void;
  closeDocument(fileName: string): void;
  invalidateFile(fileName: string): void;
  check(): Effect.Effect<CheckResult, CheckConfigError | CheckInternalError>;
  dispose(): void;
}

interface Overlay {
  readonly text: string;
  readonly version: number;
}

const filePath = (projectDir: string, value: string): string => {
  const decoded = value.startsWith("file://")
    ? decodeURIComponent(new URL(value).pathname)
    : value;
  const fromWorkingDirectory = path.resolve(decoded);
  return ts.sys.fileExists(fromWorkingDirectory)
    ? fromWorkingDirectory
    : path.resolve(projectDir, decoded);
};

export const createCheckSession = (options: CheckOptions = {}): CheckSession => {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const requestedConfig = options.tsconfigPath
    ? ts.sys.fileExists(path.resolve(projectDir, options.tsconfigPath))
      ? path.resolve(projectDir, options.tsconfigPath)
      : path.resolve(options.tsconfigPath)
    : undefined;
  let configPath = requestedConfig ?? ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  const overlays = new Map<string, Overlay>();
  const invalidations = new Map<string, number>();
  let parsed: ResolvedProjectConfig | undefined;
  let oldProgram: ts.Program | undefined;
  let revision = 0;
  let cachedRevision = -1;
  let cachedResult: CheckResult | undefined;
  let disposed = false;

  const canonical = (fileName: string): string => filePath(projectDir, fileName);
  const readFile = (fileName: string): string | undefined =>
    overlays.get(canonical(fileName))?.text ?? ts.sys.readFile(fileName);
  const fileExists = (fileName: string): boolean =>
    overlays.has(canonical(fileName)) || ts.sys.fileExists(fileName);
  const changed = (fileName: string): void => {
    revision++;
    if (configPath && canonical(fileName) === canonical(configPath)) parsed = undefined;
  };

  const session: CheckSession = {
    projectDir,
    get configPath() {
      return configPath;
    },
    openDocument(fileName, text, version) {
      if (disposed) return;
      const key = canonical(fileName);
      overlays.set(key, { text, version });
      changed(key);
    },
    updateDocument(fileName, text, version) {
      if (disposed) return;
      const key = canonical(fileName);
      const current = overlays.get(key);
      if (current && version <= current.version) return;
      overlays.set(key, { text, version });
      changed(key);
    },
    closeDocument(fileName) {
      if (disposed) return;
      const key = canonical(fileName);
      if (!overlays.delete(key)) return;
      changed(key);
    },
    invalidateFile(fileName) {
      if (disposed) return;
      const key = canonical(fileName);
      invalidations.set(key, (invalidations.get(key) ?? 0) + 1);
      // A watcher invalidation may represent a newly created or deleted file,
      // so refresh tsconfig membership as well as the incremental Program.
      parsed = undefined;
      changed(key);
    },
    check() {
      return Effect.gen(function* () {
        if (disposed) {
          return yield* new CheckInternalError({ cause: new Error("Check session has been disposed") });
        }
        if (cachedResult && cachedRevision === revision) return cachedResult;
        if (!parsed) {
          parsed = yield* loadProjectConfig(
            {
              projectDir,
              ...(configPath ? { tsconfigPath: configPath } : {}),
            },
            readFile,
            fileExists,
          );
          configPath = parsed.configPath;
        }
        const analysis = yield* analyzeProject({
          projectDir,
          configPath: parsed.configPath,
          parsedConfig: parsed.parsedConfig,
          readFile,
          fileExists,
          version: (fileName) => {
            const key = canonical(fileName);
            const overlay = overlays.get(key);
            return overlay
              ? `overlay:${overlay.version}`
              : `disk:${invalidations.get(key) ?? 0}`;
          },
          ...(oldProgram ? { oldProgram } : {}),
        });
        oldProgram = analysis.program;
        cachedResult = analysis.result;
        cachedRevision = revision;
        return analysis.result;
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      overlays.clear();
      invalidations.clear();
      parsed = undefined;
      oldProgram = undefined;
      cachedResult = undefined;
    },
  };
  return session;
};
