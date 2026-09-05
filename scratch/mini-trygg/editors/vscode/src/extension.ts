import * as path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

const commands = {
  restart: "mini-check.restartLanguageServer",
  explain: "mini-check.explainDiagnostic",
  scopes: "mini-check.showProviderScopes",
  docs: "mini-check.openDocs",
} as const;

interface ProviderCandidate {
  readonly component: string;
  readonly file: string;
  readonly line: number;
  readonly lifetime: string;
  readonly rationale: string;
}

interface Provenance {
  readonly service: string;
  readonly origin: {
    readonly kind: string;
    readonly symbol: string;
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
  readonly path: ReadonlyArray<{
    readonly symbol: string;
  }>;
  readonly candidates: ReadonlyArray<ProviderCandidate>;
}

interface ProviderQuickPickItem extends vscode.QuickPickItem {
  readonly candidate: ProviderCandidate;
}

let extensionContext: vscode.ExtensionContext | undefined;
let client: LanguageClient | undefined;
let restartPromise: Promise<void> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseCandidate(value: unknown): ProviderCandidate | undefined {
  if (!isRecord(value)) return undefined;

  const component = stringField(value, "component");
  const file = stringField(value, "file");
  const line = numberField(value, "line");
  const lifetime = stringField(value, "lifetime");
  const rationale = stringField(value, "rationale");
  if (!component || !file || line === undefined || !lifetime || !rationale) return undefined;

  return { component, file, line, lifetime, rationale };
}

function parseProvenance(value: unknown): Provenance | undefined {
  if (!isRecord(value)) return undefined;

  const service = stringField(value, "service");
  const originValue = value.origin;
  const pathValue = value.path;
  const candidatesValue = value.candidates;
  if (!service || !isRecord(originValue) || !Array.isArray(pathValue) || !Array.isArray(candidatesValue)) {
    return undefined;
  }

  const kind = stringField(originValue, "kind");
  const symbol = stringField(originValue, "symbol");
  const file = stringField(originValue, "file");
  const line = numberField(originValue, "line");
  const column = numberField(originValue, "column");
  if (!kind || !symbol || !file || line === undefined || column === undefined) return undefined;

  const entries: Array<{ readonly symbol: string }> = [];
  for (const entry of pathValue) {
    if (!isRecord(entry)) continue;
    const entrySymbol = stringField(entry, "symbol");
    if (entrySymbol) entries.push({ symbol: entrySymbol });
  }

  const candidates: ProviderCandidate[] = [];
  for (const candidateValue of candidatesValue) {
    const candidate = parseCandidate(candidateValue);
    if (candidate) candidates.push(candidate);
  }

  return {
    service,
    origin: { kind, symbol, file, line, column },
    path: entries,
    candidates,
  };
}

function nestedValues(value: unknown): ReadonlyArray<unknown> {
  if (!isRecord(value)) return [];
  return [value.provenance, value.data, value.diagnostic, value.result, value.payload];
}

function findProvenance(value: unknown, depth = 0): Provenance | undefined {
  if (depth > 3) return undefined;
  const direct = parseProvenance(value);
  if (direct) return direct;

  for (const nested of nestedValues(value)) {
    const found = findProvenance(nested, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function findCandidates(value: unknown, depth = 0): ReadonlyArray<ProviderCandidate> {
  if (depth > 3) return [];
  const provenance = parseProvenance(value);
  if (provenance) return provenance.candidates;
  if (Array.isArray(value)) {
    const candidates = value.flatMap((entry) => {
      const candidate = parseCandidate(entry);
      return candidate ? [candidate] : [];
    });
    if (candidates.length > 0) return candidates;
  }
  if (isRecord(value) && Array.isArray(value.candidates)) {
    const candidates = findCandidates(value.candidates, depth + 1);
    if (candidates.length > 0) return candidates;
  }

  for (const nested of nestedValues(value)) {
    const found = findCandidates(nested, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

function findString(value: unknown, keys: ReadonlyArray<string>, depth = 0): string | undefined {
  if (depth > 3) return undefined;
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;

  for (const key of keys) {
    const found = stringField(value, key);
    if (found) return found;
  }
  for (const nested of nestedValues(value)) {
    const found = findString(nested, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function commandPayload(arguments_: ReadonlyArray<unknown>, result: unknown): unknown {
  return result ?? arguments_[0];
}

async function explainDiagnostic(payload: unknown): Promise<void> {
  const provenance = findProvenance(payload);
  if (!provenance) {
    await vscode.window.showInformationMessage(
      "Choose Explain Diagnostic from a mini-check diagnostic action to see its requirement provenance.",
    );
    return;
  }

  const originKind = provenance.origin.kind === "layer-input" ? "layer" : "component";
  const pathSymbols = provenance.path.map((entry) => entry.symbol);
  const propagation = pathSymbols.length > 0 ? pathSymbols.join(" -> ") : provenance.origin.symbol;
  await vscode.window.showInformationMessage(
    `${provenance.service} provenance`,
    {
      modal: true,
      detail: `Required by ${originKind} ${provenance.origin.symbol} at ${provenance.origin.file}:${provenance.origin.line}:${provenance.origin.column}\n\nPropagated through: ${propagation}`,
    },
  );
}

function workspaceFolderPath(): string | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
  return activeFolder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function locationUri(file: string): vscode.Uri {
  if (file.startsWith("file:")) return vscode.Uri.parse(file);
  const resolved = path.isAbsolute(file) ? file : path.resolve(workspaceFolderPath() ?? process.cwd(), file);
  return vscode.Uri.file(resolved);
}

async function showProviderScopes(payload: unknown): Promise<void> {
  const candidates = findCandidates(payload);
  if (candidates.length === 0) {
    await vscode.window.showInformationMessage(
      "Choose Show Provider Scopes from a mini-check diagnostic action to inspect valid provider locations.",
    );
    return;
  }

  const items: ProviderQuickPickItem[] = candidates.map((candidate) => ({
    label: candidate.component,
    description: candidate.lifetime,
    detail: `${candidate.rationale} (${candidate.file}:${candidate.line})`,
    candidate,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: "Valid provider scopes",
    placeHolder: "Select a component to navigate to it; mini-check will not edit Layer placement.",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected) return;

  const document = await vscode.workspace.openTextDocument(locationUri(selected.candidate.file));
  const line = Math.max(0, selected.candidate.line - 1);
  await vscode.window.showTextDocument(document, {
    selection: new vscode.Range(line, 0, line, 0),
    preview: true,
  });
}

async function openDocs(payload: unknown): Promise<void> {
  const explicitUrl = findString(payload, ["docs", "url", "uri"]);
  const code = findString(payload, ["tryggCode", "code"]);
  const url = explicitUrl ?? (code?.startsWith("TRYGG") ? `https://trygg.dev/errors/${code}` : "https://trygg.dev");
  const uri = vscode.Uri.parse(url);
  if (uri.scheme !== "https" && uri.scheme !== "http") {
    await vscode.window.showErrorMessage(`Mini Check refused to open a non-HTTP documentation URL: ${url}`);
    return;
  }
  await vscode.env.openExternal(uri);
}

async function handleServerCommand(
  command: string,
  arguments_: ReadonlyArray<unknown>,
  next: (command: string, args: unknown[]) => vscode.ProviderResult<unknown>,
): Promise<unknown> {
  if (command === commands.explain && arguments_.length === 0) {
    await explainDiagnostic(undefined);
    return undefined;
  }
  if (command === commands.scopes && arguments_.length === 0) {
    await showProviderScopes(undefined);
    return undefined;
  }

  const result = await next(command, [...arguments_]);
  const payload = commandPayload(arguments_, result);
  if (command === commands.explain) await explainDiagnostic(payload);
  if (command === commands.scopes) await showProviderScopes(payload);
  if (command === commands.docs) await openDocs(payload);
  return result;
}

function resolveConfiguredPath(value: string, base: string): string {
  return path.isAbsolute(value) ? value : path.resolve(base, value);
}

function createClient(context: vscode.ExtensionContext): LanguageClient | undefined {
  const folderPath = workspaceFolderPath();
  const workspaceFolder = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.fsPath === folderPath);
  if (!folderPath || !workspaceFolder) {
    void vscode.window.showErrorMessage("Mini Check requires an open workspace folder.");
    return undefined;
  }

  const configuration = vscode.workspace.getConfiguration("miniCheck", workspaceFolder.uri);
  const configuredServerPath = configuration.get<string>("serverPath", "").trim();
  const serverPath = configuredServerPath
    ? resolveConfiguredPath(configuredServerPath, folderPath)
    : context.asAbsolutePath(path.join("dist", "lsp.mjs"));
  const configuredProjectDir = configuration.get<string>("projectDir", "").trim();
  let projectDir = configuredProjectDir
    ? resolveConfiguredPath(configuredProjectDir, folderPath)
    : undefined;
  const configuredTsconfigPath = configuration.get<string>("tsconfigPath", "").trim();
  if (configuredTsconfigPath && !projectDir) projectDir = folderPath;
  const tsconfigPath = configuredTsconfigPath
    ? resolveConfiguredPath(configuredTsconfigPath, projectDir ?? folderPath)
    : undefined;

  const serverOptions: ServerOptions = {
    module: serverPath,
    transport: TransportKind.stdio,
    options: { cwd: folderPath },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
    ],
    diagnosticCollectionName: "mini-check",
    initializationOptions: {
      ...(projectDir ? { projectDir } : {}),
      ...(tsconfigPath ? { tsconfigPath } : {}),
    },
    synchronize: {
      fileEvents: (vscode.workspace.workspaceFolders ?? [workspaceFolder]).map((folder) =>
        vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, "**/*.{ts,tsx,json}"),
        )
      ),
    },
    middleware: {
      executeCommand: (command, args, next) => handleServerCommand(command, args, next),
    },
  };

  return new LanguageClient("mini-check", "Mini Check", serverOptions, clientOptions);
}

async function startClient(): Promise<void> {
  if (!extensionContext) return;
  const nextClient = createClient(extensionContext);
  if (!nextClient) return;
  client = nextClient;
  try {
    await nextClient.start();
  } catch (error) {
    if (client === nextClient) client = undefined;
    await nextClient.dispose();
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Mini Check language server failed to start: ${message}`);
  }
}

async function restartClient(): Promise<void> {
  if (restartPromise) return restartPromise;
  restartPromise = (async () => {
    const previousClient = client;
    client = undefined;
    if (previousClient) await previousClient.stop();
    await startClient();
  })().finally(() => {
    restartPromise = undefined;
  });
  return restartPromise;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  context.subscriptions.push(
    vscode.commands.registerCommand(commands.restart, restartClient),
    vscode.commands.registerCommand(commands.explain, explainDiagnostic),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void restartClient();
    }),
  );
  await startClient();
}

export async function deactivate(): Promise<void> {
  if (restartPromise) await restartPromise;
  const activeClient = client;
  client = undefined;
  extensionContext = undefined;
  if (activeClient) await activeClient.dispose();
}
