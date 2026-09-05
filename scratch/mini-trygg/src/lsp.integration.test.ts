import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

type JsonMessage = Record<string, unknown>;

class ProtocolClient {
  readonly process: ReturnType<typeof Bun.spawn>;
  readonly messages: JsonMessage[] = [];
  readonly listeners = new Set<() => void>();
  readonly reading: Promise<void>;

  constructor(cwd: string) {
    this.process = Bun.spawn([process.execPath, "src/lsp.ts", "--stdio"], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.reading = this.readMessages();
  }

  send(message: JsonMessage): void {
    const body = JSON.stringify(message);
    const stdin = this.process.stdin;
    if (!stdin || typeof stdin === "number") throw new Error("LSP stdin pipe is unavailable");
    stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    stdin.flush();
  }

  async waitFor(
    predicate: (message: JsonMessage) => boolean,
    timeoutMs = 15_000,
  ): Promise<JsonMessage> {
    const existing = this.take(predicate);
    if (existing) return existing;

    return new Promise<JsonMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error(`Timed out waiting for LSP message. Received: ${JSON.stringify(this.messages)}`));
      }, timeoutMs);
      const check = (): void => {
        const message = this.take(predicate);
        if (!message) return;
        clearTimeout(timeout);
        this.listeners.delete(check);
        resolve(message);
      };
      this.listeners.add(check);
      check();
    });
  }

  private take(predicate: (message: JsonMessage) => boolean): JsonMessage | undefined {
    const index = this.messages.findIndex(predicate);
    if (index < 0) return undefined;
    return this.messages.splice(index, 1)[0];
  }

  private async readMessages(): Promise<void> {
    const stdout = this.process.stdout;
    if (!stdout || typeof stdout === "number") throw new Error("LSP stdout pipe is unavailable");
    const reader = stdout.getReader();
    let buffered = Buffer.alloc(0);
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      buffered = Buffer.concat([buffered, Buffer.from(next.value)]);
      while (true) {
        const headerEnd = buffered.indexOf("\r\n\r\n");
        if (headerEnd < 0) break;
        const header = buffered.subarray(0, headerEnd).toString("ascii");
        const lengthMatch = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
        if (!lengthMatch) throw new Error(`Invalid LSP header: ${header}`);
        const contentLength = Number(lengthMatch[1]);
        const bodyStart = headerEnd + 4;
        if (buffered.length < bodyStart + contentLength) break;
        const body = buffered.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
        buffered = buffered.subarray(bodyStart + contentLength);
        this.messages.push(JSON.parse(body) as JsonMessage);
        for (const listener of [...this.listeners]) listener();
      }
    }
  }

  async stop(): Promise<void> {
    if (this.process.exitCode === null) this.process.kill();
    await this.process.exited;
  }
}

const clients: ProtocolClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop()));
});

describe("mini-check language server", () => {
  test("publishes overlay diagnostics, clears them, and returns command-only actions", async () => {
    const projectRoot = path.resolve(import.meta.dir, "..");
    const demoRoot = path.join(projectRoot, "demo");
    const brokenFile = path.join(demoRoot, "app-broken.tsx");
    const brokenUri = pathToFileURL(brokenFile).href;
    const client = new ProtocolClient(projectRoot);
    clients.push(client);

    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        processId: null,
        rootUri: pathToFileURL(demoRoot).href,
        capabilities: {},
        initializationOptions: { projectDir: demoRoot },
      },
    });
    const initialized = await client.waitFor((message) => message.id === 1);
    expect(initialized.error).toBeUndefined();
    expect(initialized.result).toMatchObject({
      capabilities: {
        textDocumentSync: 2,
        codeActionProvider: true,
      },
    });
    client.send({ jsonrpc: "2.0", method: "initialized", params: {} });

    const brokenText = await Bun.file(brokenFile).text();
    client.send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: brokenUri,
          languageId: "typescriptreact",
          version: 1,
          text: brokenText,
        },
      },
    });

    const publication = await client.waitFor((message) => {
      if (message.method !== "textDocument/publishDiagnostics") return false;
      const params = message.params as { uri?: string; diagnostics?: Array<{ code?: unknown }> } | undefined;
      return params?.uri === brokenUri &&
        params.diagnostics?.some((diagnostic) => diagnostic.code === "TRYGG0001") === true;
    });
    const publishedParams = publication.params as {
      diagnostics: Array<{
        code: string;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        relatedInformation?: unknown[];
        data?: Record<string, unknown>;
      }>;
    };
    const tryggDiagnostic = publishedParams.diagnostics.find(
      (diagnostic) => diagnostic.code === "TRYGG0001",
    );
    expect(tryggDiagnostic?.relatedInformation?.length).toBeGreaterThan(0);
    expect(tryggDiagnostic?.data).toMatchObject({ code: "TRYGG0001" });
    expect((tryggDiagnostic?.data?.candidates as unknown[])?.length).toBeGreaterThan(0);

    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/codeAction",
      params: {
        textDocument: { uri: brokenUri },
        range: tryggDiagnostic?.range,
        context: { diagnostics: [tryggDiagnostic] },
      },
    });
    const actionResponse = await client.waitFor((message) => message.id === 2);
    const actions = actionResponse.result as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(3);
    expect(actions.every((action) => action.edit === undefined)).toBe(true);
    expect(actions.map((action) => (action.command as { command: string }).command)).toEqual([
      "mini-check.openDocs",
      "mini-check.showProviderScopes",
      "mini-check.explainDiagnostic",
    ]);

    const docsCommand = actions[0]?.command as {
      command: string;
      arguments?: unknown[];
    };
    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: "workspace/executeCommand",
      params: { command: docsCommand.command, arguments: docsCommand.arguments },
    });
    const commandResponse = await client.waitFor((message) => message.id === 3);
    expect(commandResponse.result).toMatchObject({
      url: "https://trygg.dev/errors/TRYGG0001",
    });
    expect(client.messages.some((message) => message.method === "window/showMessage")).toBe(false);

    const fixedText = await Bun.file(path.join(demoRoot, "app-fixed.tsx")).text();
    client.send({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: brokenUri, version: 2 },
        contentChanges: [{ text: fixedText }],
      },
    });
    const cleared = await client.waitFor((message) => {
      if (message.method !== "textDocument/publishDiagnostics") return false;
      const params = message.params as { uri?: string; diagnostics?: unknown[] } | undefined;
      return params?.uri === brokenUri && params.diagnostics?.length === 0;
    });
    expect(cleared).toBeDefined();
    expect(await Bun.file(brokenFile).text()).toBe(brokenText);

    client.send({
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri: brokenUri } },
    });
    const restored = await client.waitFor((message) => {
      if (message.method !== "textDocument/publishDiagnostics") return false;
      const params = message.params as { uri?: string; diagnostics?: Array<{ code?: unknown }> } | undefined;
      return params?.uri === brokenUri &&
        params.diagnostics?.some((diagnostic) => diagnostic.code === "TRYGG0001") === true;
    });
    expect(restored).toBeDefined();

    client.send({ jsonrpc: "2.0", id: 4, method: "shutdown", params: null });
    const shutdown = await client.waitFor((message) => message.id === 4);
    expect(shutdown.error).toBeUndefined();
    client.send({ jsonrpc: "2.0", method: "exit", params: null });
    expect(await client.process.exited).toBe(0);
  }, 25_000);

  test("should show Zed command results without returning a WorkspaceEdit", async () => {
    // Scope: exercises the Zed execute-command boundary using actions produced from a real diagnostic.
    // Assertion: every command returns its payload and emits useful information without applying edits.
    const projectRoot = path.resolve(import.meta.dir, "..");
    const demoRoot = path.join(projectRoot, "demo");
    const brokenFile = path.join(demoRoot, "app-broken.tsx");
    const brokenUri = pathToFileURL(brokenFile).href;
    const client = new ProtocolClient(projectRoot);
    clients.push(client);

    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        processId: null,
        rootUri: pathToFileURL(demoRoot).href,
        capabilities: {},
        clientInfo: { name: "zEd", version: "future-build" },
        initializationOptions: { projectDir: demoRoot },
      },
    });
    const initialized = await client.waitFor((message) => message.id === 1);
    expect(initialized.error).toBeUndefined();
    client.send({ jsonrpc: "2.0", method: "initialized", params: {} });

    client.send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: brokenUri,
          languageId: "typescriptreact",
          version: 1,
          text: await Bun.file(brokenFile).text(),
        },
      },
    });
    const publication = await client.waitFor((message) => {
      if (message.method !== "textDocument/publishDiagnostics") return false;
      const params = message.params as { uri?: string; diagnostics?: Array<{ code?: unknown }> } | undefined;
      return params?.uri === brokenUri &&
        params.diagnostics?.some((diagnostic) => diagnostic.code === "TRYGG0001") === true;
    });
    const diagnostics = (publication.params as {
      diagnostics: Array<{
        code?: unknown;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
      }>;
    }).diagnostics;
    const diagnostic = diagnostics.find((candidate) => candidate.code === "TRYGG0001");
    expect(diagnostic).toMatchObject({
      message: "Missing service at application boundary: UserRepository.",
      relatedInformation: [{ message: "UserRepository is required by ProfileCard." }],
    });

    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/codeAction",
      params: {
        textDocument: { uri: brokenUri },
        range: diagnostic?.range,
        context: { diagnostics: [diagnostic] },
      },
    });
    const actionResponse = await client.waitFor((message) => message.id === 2);
    const actions = actionResponse.result as Array<{
      edit?: unknown;
      command?: { command: string; arguments?: unknown[] };
    }>;
    expect(actions).toHaveLength(3);
    expect(actions.every((action) => action.edit === undefined)).toBe(true);

    const expectedMessages = [
      ["Documentation:", "https://trygg.dev/errors/TRYGG0001"],
      ["ProfileCard [per-mounted-instance] -", "No ownership was selected."],
      ["Requirement service: UserRepository", "Origin: ProfileCard [component]", "Propagation chain:"],
    ];
    for (const [index, action] of actions.entries()) {
      const command = action.command;
      expect(command).toBeDefined();
      client.send({
        jsonrpc: "2.0",
        id: index + 3,
        method: "workspace/executeCommand",
        params: { command: command?.command, arguments: command?.arguments },
      });
      const notification = await client.waitFor((message) =>
        message.method === "window/showMessage"
      );
      const params = notification.params as { type?: unknown; message?: unknown };
      expect(params.type).toBe(3);
      expect(typeof params.message).toBe("string");
      for (const expected of expectedMessages[index] ?? []) {
        expect(params.message).toContain(expected);
      }
      const response = await client.waitFor((message) => message.id === index + 3);
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual(command?.arguments?.[0]);
    }

    const malformedPayload = { url: "javascript:alert('not documentation')" };
    client.send({
      jsonrpc: "2.0",
      id: 6,
      method: "workspace/executeCommand",
      params: { command: "mini-check.openDocs", arguments: [malformedPayload] },
    });
    const safeNotification = await client.waitFor((message) =>
      message.method === "window/showMessage"
    );
    expect((safeNotification.params as { message?: unknown }).message).toBe(
      "Documentation URL unavailable.",
    );
    const malformedResponse = await client.waitFor((message) => message.id === 6);
    expect(malformedResponse.result).toEqual(malformedPayload);
    expect(client.messages.some((message) => message.method === "workspace/applyEdit")).toBe(false);

    client.send({ jsonrpc: "2.0", id: 7, method: "shutdown", params: null });
    await client.waitFor((message) => message.id === 7);
    client.send({ jsonrpc: "2.0", method: "exit", params: null });
    expect(await client.process.exited).toBe(0);
  }, 25_000);

  test("deduplicates workspace folders that discover the same tsconfig", async () => {
    const projectRoot = path.resolve(import.meta.dir, "..");
    const tempRoot = await mkdtemp("/tmp/opencode/mini-check-multi-root-");
    const firstRoot = path.join(tempRoot, "first");
    const secondRoot = path.join(tempRoot, "second");
    const appFile = path.join(firstRoot, "app.tsx");
    const appUri = pathToFileURL(appFile).href;
    const runtime = path.join(projectRoot, "jsx-runtime.js");
    try {
      await mkdir(firstRoot);
      await mkdir(secondRoot);
      await writeFile(
        path.join(tempRoot, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "es2022",
            module: "preserve",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            jsx: "react-jsx",
            types: [],
          },
          include: ["first/*.tsx"],
        }),
      );
      await writeFile(
        appFile,
        `import { Element, gen, jsx, mount, RequiresService, UserRepository } from ${JSON.stringify(runtime)};
const App = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {
  void (yield [new UserRepository()] as never);
  return jsx("div", null);
});
mount(null, <App />);
`,
      );

      const client = new ProtocolClient(projectRoot);
      clients.push(client);
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          processId: null,
          capabilities: {},
          workspaceFolders: [
            { uri: pathToFileURL(firstRoot).href, name: "first" },
            { uri: pathToFileURL(secondRoot).href, name: "second" },
          ],
        },
      });
      await client.waitFor((message) => message.id === 1);
      client.send({ jsonrpc: "2.0", method: "initialized", params: {} });

      const publication = await client.waitFor((message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { uri?: string; diagnostics?: Array<{ code?: unknown }> } | undefined;
        return params?.uri === appUri &&
          params.diagnostics?.some((diagnostic) => diagnostic.code === "TRYGG0001") === true;
      });
      const diagnostics = (publication.params as { diagnostics: Array<{ code?: unknown }> }).diagnostics;
      expect(diagnostics.filter((diagnostic) => diagnostic.code === "TRYGG0001")).toHaveLength(1);

      client.send({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null });
      await client.waitFor((message) => message.id === 2);
      client.send({ jsonrpc: "2.0", method: "exit", params: null });
      expect(await client.process.exited).toBe(0);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 25_000);
});
