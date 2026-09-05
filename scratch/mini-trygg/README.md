# mini-trygg checker

Scratch implementation of Trygg's JSX requirement checker, provenance graph, and IDE integration. It remains isolated from `packages/core` while the checker model is validated.

## Commands

```sh
bun run check          # broken demo: TRYGG0001
bun run check:fixed    # provided demo: clean
bun run typecheck
bun test
bun run build          # standalone LSP and self-contained VS Code extension
bun run check:zed      # native check of the Zed adapter
bun run verify
```

The CLI supports human, machine, and `mini-check/v1` JSON output. The shared check session accepts versioned in-memory document overlays, incrementally reuses the previous TypeScript program, and feeds the same unsaved source to TypeScript diagnostics and provenance analysis.

## Language server

Run the source server over stdio:

```sh
bun run lsp
```

The server publishes `TRYGG0001` at the mount boundary and attaches navigable related locations for the requirement origin, propagation path, and valid provider scopes. Its code actions explain provenance, open documentation, or show candidates; none chooses ownership or edits Layer placement.

## VS Code

Build and launch the scratch extension:

```sh
bun run build:vscode
code --extensionDevelopmentPath="$PWD/editors/vscode" "$PWD/demo"
```

The extension contains the bundled Node-compatible language server. See `editors/vscode/README.md` for configuration and local installation details.

The Zed adapter in `editors/zed` registers the same LSP for built-in TypeScript and TSX. It is designed for Zed Remote Development: Zed's UI and dev-extension installation stay on the Mac, while Node and the checker execute in the remote SSH worktree. See `editors/zed/README.md` for installation and project settings.

## Intentional limits

The mini graph recognizes a deliberately small set of local AST forms. Imported aliases and fully dynamic component or Layer construction are not production-ready; known incomplete mount graphs produce `TRYGG0901` instead of speculative ownership advice.
