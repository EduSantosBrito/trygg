#!/usr/bin/env bun
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  CodeActionKind,
  createConnection,
  MessageType,
  ProposedFeatures,
  ShowMessageNotification,
  TextDocuments,
  TextDocumentSyncKind,
  type CodeAction,
  type Diagnostic,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createCheckSession, type CheckSession } from "./session.js";
import {
  filesRequiringClear,
  groupDiagnosticsByUri,
  type MiniCheckDiagnosticData,
} from "./lsp-adapter.js";

const CHECK_DEBOUNCE_MS = 75;
const OPEN_DOCS_COMMAND = "mini-check.openDocs";
const SHOW_PROVIDER_SCOPES_COMMAND = "mini-check.showProviderScopes";
const EXPLAIN_DIAGNOSTIC_COMMAND = "mini-check.explainDiagnostic";

interface InitializationOptions {
  readonly projectDir?: string;
  readonly tsconfigPath?: string;
}

interface SessionEntry {
  readonly session: CheckSession;
  readonly projectDir: string;
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const sessions: SessionEntry[] = [];
const documentSessions = new Map<string, SessionEntry>();
const documentVersions = new Map<string, number>();
let publishedUris = new Set<string>();
let generation = 0;
let checkTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let clientInfoName: string | undefined;

const isZedClient = (): boolean =>
  clientInfoName !== undefined && /(^|[^a-z0-9])zed([^a-z0-9]|$)/i.test(clientInfoName);

interface ProviderScopeDisplay {
  readonly component: string;
  readonly lifetime: string;
  readonly rationale: string;
}

interface ProvenanceDisplay {
  readonly service: string;
  readonly origin: {
    readonly symbol: string;
    readonly kind: string;
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
  readonly path: ReadonlyArray<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const displayString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const display = value.replace(/\s+/g, " ").trim();
  return display.length > 0 ? display : undefined;
};

const diagnosticData = (payload: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(payload)) return undefined;
  return isRecord(payload.data) ? payload.data : payload;
};

const validatedDocsUrl = (payload: unknown): string | undefined => {
  const record = isRecord(payload) ? payload : undefined;
  const data = diagnosticData(payload);
  const candidate = typeof payload === "string"
    ? payload
    : record?.url ?? data?.docsUrl;
  if (typeof candidate !== "string") return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const providerScopes = (payload: unknown): ProviderScopeDisplay[] => {
  const record = isRecord(payload) ? payload : undefined;
  const data = diagnosticData(payload);
  const candidateValues = record?.candidates ?? data?.candidates;
  const values = Array.isArray(candidateValues) ? candidateValues : [];
  const scopes: ProviderScopeDisplay[] = [];
  for (const value of values) {
    if (!isRecord(value)) continue;
    const component = displayString(value.component);
    const lifetime = displayString(value.lifetime);
    const rationale = displayString(value.rationale);
    if (component && lifetime && rationale) scopes.push({ component, lifetime, rationale });
  }
  return scopes;
};

const provenance = (payload: unknown): ProvenanceDisplay | undefined => {
  const data = diagnosticData(payload);
  const value = isRecord(data?.provenance) ? data.provenance : undefined;
  const origin = isRecord(value?.origin) ? value.origin : undefined;
  const service = displayString(value?.service);
  const symbol = displayString(origin?.symbol);
  const kind = displayString(origin?.kind);
  const file = displayString(origin?.file);
  const line = origin?.line;
  const column = origin?.column;
  if (
    !service || !symbol || !kind || !file || typeof line !== "number" ||
    !Number.isFinite(line) || typeof column !== "number" || !Number.isFinite(column)
  ) return undefined;

  const pathEntries = Array.isArray(value?.path) ? value.path : [];
  const propagationPath: string[] = [];
  for (const entry of pathEntries) {
    if (!isRecord(entry)) continue;
    const pathSymbol = displayString(entry.symbol);
    if (pathSymbol) propagationPath.push(pathSymbol);
  }
  return {
    service,
    origin: { symbol, kind, file, line, column },
    path: propagationPath.length > 0 ? propagationPath : [symbol],
  };
};

const sendZedCommandMessage = (command: string, payload: unknown): void => {
  let message: string | undefined;
  if (command === OPEN_DOCS_COMMAND) {
    const url = validatedDocsUrl(payload);
    message = url ? `Documentation: ${url}` : "Documentation URL unavailable.";
  } else if (command === SHOW_PROVIDER_SCOPES_COMMAND) {
    const scopes = providerScopes(payload);
    const list = scopes.length > 0
      ? scopes.map(({ component, lifetime, rationale }) =>
        `${component} [${lifetime}] - ${rationale}`
      ).join("\n")
      : "No valid provider scope candidates were provided.";
    message = `Provider scope candidates:\n${list}\nNo ownership was selected.`;
  } else if (command === EXPLAIN_DIAGNOSTIC_COMMAND) {
    const details = provenance(payload);
    message = details
      ? [
        `Requirement service: ${details.service}`,
        `Origin: ${details.origin.symbol} [${details.origin.kind}] - ${details.origin.file}:${details.origin.line}:${details.origin.column}`,
        `Propagation chain: ${details.path.join(" -> ")}`,
      ].join("\n")
      : "Requirement provenance unavailable: command payload was malformed.";
  }
  if (message) {
    connection.sendNotification(ShowMessageNotification.type, {
      type: MessageType.Info,
      message,
    });
  }
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
};

const uriToFile = (uri: string): string | undefined => {
  try {
    const url = new URL(uri);
    return url.protocol === "file:" ? fileURLToPath(url) : undefined;
  } catch {
    return undefined;
  }
};

const isWithin = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const sessionForFile = (file: string): SessionEntry | undefined =>
  sessions
    .filter((entry) => isWithin(entry.projectDir, file))
    .sort((left, right) => right.projectDir.length - left.projectDir.length)[0] ?? sessions[0];

const disposeSessions = (): void => {
  if (disposed) return;
  disposed = true;
  generation += 1;
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = undefined;
  for (const entry of sessions) {
    try {
      entry.session.dispose();
    } catch (error) {
      connection.console.error(`Failed to dispose mini-check session: ${describeError(error)}`);
    }
  }
  sessions.length = 0;
};

const runCheck = async (requestedGeneration: number): Promise<void> => {
  if (disposed || requestedGeneration !== generation) return;

  const grouped = new Map<string, Diagnostic[]>();
  for (const entry of sessions) {
    try {
      const result = await Effect.runPromise(entry.session.check());
      if (disposed || requestedGeneration !== generation) return;
      const sessionGroups = groupDiagnosticsByUri(result.diagnostics, {
        serverCwd: process.cwd(),
        projectDir: entry.session.projectDir,
        compact: isZedClient(),
      });
      for (const [uri, diagnostics] of sessionGroups) {
        const current = grouped.get(uri);
        if (current) current.push(...diagnostics);
        else grouped.set(uri, [...diagnostics]);
      }
    } catch (error) {
      connection.console.error(
        `mini-check failed for ${entry.projectDir}: ${describeError(error)}`,
      );
    }
  }

  if (disposed || requestedGeneration !== generation) return;
  for (const [uri, diagnostics] of grouped) {
    connection.sendDiagnostics({ uri, diagnostics });
  }
  for (const uri of filesRequiringClear(publishedUris, grouped)) {
    connection.sendDiagnostics({ uri, diagnostics: [] });
  }
  publishedUris = new Set(grouped.keys());
  const diagnosticCount = [...grouped.values()].reduce(
    (count, diagnostics) => count + diagnostics.length,
    0,
  );
  connection.console.info(
    `mini-check published ${diagnosticCount} diagnostic(s) for ${grouped.size} file(s)`,
  );
};

const scheduleCheck = (): void => {
  if (disposed) return;
  const requestedGeneration = ++generation;
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checkTimer = undefined;
    void runCheck(requestedGeneration);
  }, CHECK_DEBOUNCE_MS);
};

const rootPaths = (params: InitializeParams, options: InitializationOptions): string[] => {
  if (options.projectDir) return [path.resolve(process.cwd(), options.projectDir)];
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    return params.workspaceFolders.flatMap((folder) => {
      const file = uriToFile(folder.uri);
      return file ? [path.resolve(file)] : [];
    });
  }
  const rootUriFile = params.rootUri ? uriToFile(params.rootUri) : undefined;
  return [path.resolve(rootUriFile ?? params.rootPath ?? process.cwd())];
};

connection.onInitialize((params): InitializeResult => {
  clientInfoName = params.clientInfo?.name;
  const options = (params.initializationOptions ?? {}) as InitializationOptions;
  const sessionKeys = new Set<string>();
  for (const projectDir of [...new Set(rootPaths(params, options))]) {
    try {
      const tsconfigPath = options.tsconfigPath
        ? path.resolve(projectDir, options.tsconfigPath)
        : undefined;
      const session = createCheckSession({ projectDir, tsconfigPath });
      const sessionKey = session.configPath ?? session.projectDir;
      if (sessionKeys.has(sessionKey)) {
        session.dispose();
        continue;
      }
      sessionKeys.add(sessionKey);
      sessions.push({ session, projectDir: session.projectDir });
      connection.console.info(
        `mini-check initialized ${session.configPath ?? session.projectDir}`,
      );
    } catch (error) {
      connection.console.error(
        `Unable to create mini-check session for ${projectDir}: ${describeError(error)}`,
      );
    }
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      codeActionProvider: true,
      executeCommandProvider: {
        commands: [OPEN_DOCS_COMMAND, SHOW_PROVIDER_SCOPES_COMMAND, EXPLAIN_DIAGNOSTIC_COMMAND],
      },
      workspace: {
        workspaceFolders: { supported: true, changeNotifications: false },
      },
    },
  };
});

connection.onInitialized(() => scheduleCheck());

documents.onDidOpen(({ document }) => {
  const file = uriToFile(document.uri);
  if (!file) return;
  const entry = sessionForFile(file);
  if (!entry) {
    connection.console.error(`No mini-check session is available for ${file}`);
    return;
  }
  documentSessions.set(document.uri, entry);
  documentVersions.set(document.uri, document.version);
  try {
    entry.session.openDocument(file, document.getText(), document.version);
    scheduleCheck();
  } catch (error) {
    connection.console.error(`Unable to open ${file}: ${describeError(error)}`);
  }
});

documents.onDidChangeContent(({ document }) => {
  if (documentVersions.get(document.uri) === document.version) return;
  const file = uriToFile(document.uri);
  const entry = documentSessions.get(document.uri);
  if (!file || !entry) return;
  documentVersions.set(document.uri, document.version);
  try {
    entry.session.updateDocument(file, document.getText(), document.version);
    scheduleCheck();
  } catch (error) {
    connection.console.error(`Unable to update ${file}: ${describeError(error)}`);
  }
});

documents.onDidClose(({ document }) => {
  const file = uriToFile(document.uri);
  const entry = documentSessions.get(document.uri);
  documentSessions.delete(document.uri);
  documentVersions.delete(document.uri);
  if (file && entry) {
    try {
      entry.session.closeDocument(file);
    } catch (error) {
      connection.console.error(`Unable to close ${file}: ${describeError(error)}`);
    }
  }
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  publishedUris.delete(document.uri);
  scheduleCheck();
});

connection.onDidChangeWatchedFiles(({ changes }) => {
  for (const change of changes) {
    const file = uriToFile(change.uri);
    if (!file) continue;
    const entry = sessionForFile(file);
    if (!entry) continue;
    try {
      entry.session.invalidateFile(file);
    } catch (error) {
      connection.console.error(`Unable to invalidate ${file}: ${describeError(error)}`);
    }
  }
  scheduleCheck();
});

connection.onCodeAction((params): CodeAction[] => {
  const actions: CodeAction[] = [];
  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.code !== "TRYGG0001") continue;
    const data = diagnostic.data as MiniCheckDiagnosticData | undefined;
    const docsUrl = data?.docsUrl;
    if (docsUrl) {
      actions.push({
        title: "Open TRYGG0001 documentation",
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        command: {
          title: "Open TRYGG0001 documentation",
          command: OPEN_DOCS_COMMAND,
          arguments: [{ url: docsUrl, data }],
        },
      });
    }
    actions.push({
      title: "Show provider scope candidates",
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      command: {
        title: "Show provider scope candidates",
        command: SHOW_PROVIDER_SCOPES_COMMAND,
        arguments: [{ candidates: data?.candidates ?? [], data }],
      },
    });
    actions.push({
      title: "Explain requirement provenance",
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      command: {
        title: "Explain requirement provenance",
        command: EXPLAIN_DIAGNOSTIC_COMMAND,
        arguments: [{ data }],
      },
    });
  }
  return actions;
});

connection.onExecuteCommand(({ command, arguments: args }) => {
  const payload = args?.[0];
  if (isZedClient()) {
    sendZedCommandMessage(command, payload);
  }
  if (command === OPEN_DOCS_COMMAND) return payload ?? null;
  if (command === SHOW_PROVIDER_SCOPES_COMMAND) return payload ?? { candidates: [] };
  if (command === EXPLAIN_DIAGNOSTIC_COMMAND) return payload ?? null;
  return null;
});

connection.onShutdown(() => {
  disposeSessions();
});
connection.onExit(() => disposeSessions());

documents.listen(connection);
connection.listen();
