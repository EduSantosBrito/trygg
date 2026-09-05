# Mini Check VS Code Client

Thin, scratch-only VS Code extension client for the mini-check stdio language server. Diagnostics and checking stay in the server; this extension starts it and renders its interactive command data.

## Build

From `scratch/mini-trygg`:

```sh
bun run build:vscode
```

The root `node_modules` supplies `vscode-languageclient` and the VS Code types. To typecheck only the extension:

```sh
bunx tsc -p editors/vscode/tsconfig.json
```

The build bundles the language server into `editors/vscode/dist/lsp.mjs`, so the extension does not depend on a server outside its directory.

## Run locally

From `scratch/mini-trygg`, launch an Extension Development Host against a TypeScript workspace:

```sh
code --extensionDevelopmentPath="$PWD/editors/vscode" "$PWD/demo"
```

For a persistent local install without producing a VSIX, link the built extension into the VS Code extension directory, then restart VS Code:

```sh
ln -s "$PWD/editors/vscode" "$HOME/.vscode/extensions/trygg-prototype.mini-check-vscode-0.1.0"
```

Remove the link to uninstall the prototype.

## Configuration

- `miniCheck.serverPath`: overrides the server entry point. Relative paths resolve from the workspace folder.
- `miniCheck.projectDir`: project directory sent in LSP initialization options. Empty uses the workspace folder.
- `miniCheck.tsconfigPath`: optional tsconfig path sent in LSP initialization options. Relative paths resolve from `projectDir`.

After changing configuration, run **Mini Check: Restart Language Server**.

The server supplies diagnostics and command payloads. **Explain Diagnostic** displays requirement provenance. **Show Provider Scopes** lists candidate components, lifetimes, and rationale, then navigates to the selected component; it never edits source or chooses Layer placement. **Open Documentation** delegates URLs to VS Code's external opener.

## Packaging limitation

The extension contains its language server, but this scratch prototype does not include a VSIX packaging dependency or publishing configuration.
