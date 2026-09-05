# Mini Check Zed Extension

Scratch-only Zed language-server adapter for the existing mini-check server. It adds mini-check to Zed's built-in TypeScript and TSX languages; it does not define a language or grammar.

## Remote setup

With the Zed UI running locally on a Mac and the project opened through Zed Remote Development over SSH, the adapter and language-server command operate against the remote worktree. Every path in the settings below must therefore refer to the remote machine, not the Mac.

On the remote machine, build the server bundle from `scratch/mini-trygg`:

```sh
bun run build:lsp
```

Remote Node.js must also be available on the worktree shell `PATH`, or configured with `lsp.mini-check.binary.path`. The preferred shared bundle lookup supports both ways this repository is commonly opened:

- Repository root: `scratch/mini-trygg/dist/lsp.mjs`
- Mini-check root: `dist/lsp.mjs`

The generated `dist/` directory is Git-ignored, so the adapter identifies the remote worktree from its `package.json` and constructs the bundle path without asking Zed to index or read the generated file.

## Install on the Mac

Zed's **Install Dev Extension** file picker is local to the Mac. It cannot select this remote directory. Copy `editors/zed` to the Mac first. For example, run this on the Mac, replacing `<zed-ssh-host>` with the same SSH host or alias used by Zed:

```sh
mkdir -p "$HOME/Developer/mini-check-zed"
rsync -av --exclude target <zed-ssh-host>:/home/host/dev/trygg/scratch/mini-trygg/editors/zed/ "$HOME/Developer/mini-check-zed/"
```

In Mac Zed, run **zed: install dev extension** and select `$HOME/Developer/mini-check-zed`. Zed compiles Rust extensions for `wasm32-wasip2`; that target must be available to the Rust toolchain on the Mac used for the dev build.

## Project configuration

Add mini-check alongside the existing language servers in the remote project's `.zed/settings.json`. The `"..."` entry preserves Zed's remaining configured/default servers:

```json
{
  "languages": {
    "TypeScript": {
      "language_servers": ["mini-check", "..."]
    },
    "TSX": {
      "language_servers": ["mini-check", "..."]
    }
  },
  "lsp": {
    "mini-check": {
      "initialization_options": {
        "projectDir": "scratch/mini-trygg/demo",
        "tsconfigPath": "tsconfig.json"
      }
    }
  }
}
```

Those project paths assume the repository root is the remote Zed worktree. If `scratch/mini-trygg` itself is the worktree, use `"projectDir": "demo"`. The override is required for this demo because the repository and mini-check root tsconfigs intentionally check different source sets.

To select a server bundle explicitly, set a remote absolute path or a path relative to the remote worktree:

```json
{
  "lsp": {
    "mini-check": {
      "settings": {
        "server_path": "scratch/mini-trygg/dist/lsp.mjs"
      },
      "initialization_options": {
        "projectDir": "scratch/mini-trygg/demo",
        "tsconfigPath": "tsconfig.json"
      }
    }
  }
}
```

`initialization_options` are passed directly to mini-check. `settings` are passed as LSP workspace configuration as well as supplying the adapter-only `server_path` lookup value.

Zed treats `binary.path` as a complete language-server override. If you use it to override remote Node, always provide the complete argument list with the remote server path and `--stdio`:

```json
{
  "lsp": {
    "mini-check": {
      "binary": {
        "path": "/run/current-system/sw/bin/node",
        "arguments": [
          "/home/host/dev/trygg/scratch/mini-trygg/dist/lsp.mjs",
          "--stdio"
        ],
        "env": {
          "MINI_CHECK_LOG": "debug"
        }
      }
    }
  }
}
```

Configured environment variables override values from the remote worktree shell environment.

If the remote worktree is `scratch/mini-trygg/demo` itself, automatic bundle discovery cannot traverse to its parent. Use the full binary override above, or set an absolute remote `settings.server_path`, and set `initialization_options.projectDir` to `"."`.

## Actions and troubleshooting

The server advertises standard `quickfix` code actions. Zed does not provide this scratch extension with custom VS Code-style action UI, so custom action results fall back to the standard server message and diagnostic related information. Provider-scope actions never choose or automatically edit Layer placement.

After rebuilding the server or changing settings:

1. Run **editor: restart language server** from Zed's command palette and select **Mini Check** if prompted.
2. Run **dev: open language server logs** from the command palette and select **Mini Check** to inspect the exact server command, stderr, protocol traffic, and startup errors.
3. If the adapter itself fails to compile or load, run **zed: open log** and inspect `Zed.log`; for verbose extension-host output, quit Zed and launch `zed --foreground` from a Mac terminal.

The most common remote failures are a missing `dist/lsp.mjs`, Node absent from the remote shell `PATH`, or a Mac-local path accidentally placed in remote LSP settings.
