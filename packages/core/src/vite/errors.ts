import { Data } from "effect";

/**
 * Plugin file system error.
 *
 * @remarks
 * Wraps file-system failures from generated file reads, writes, and directory
 * creation while keeping the original cause attached for logs and tests.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginFileSystemError extends Data.TaggedError("PluginFileSystemError")<{
  readonly operation:
    | "read"
    | "write"
    | "mkdir"
    | "exists"
    | "readdir"
    | "stat"
    | "transform"
    | "remove";
  readonly path: string;
  readonly cause: unknown;
}> {}

/**
 * Plugin bootstrap error.
 *
 * @remarks
 * Raised when a Vite hook that depends on resolved configuration executes
 * before plugin bootstrap has completed.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginBootstrapError extends Data.TaggedError("PluginBootstrapError")<{
  readonly reason: "NotReady";
  readonly message: string;
}> {
  static notReady(): PluginBootstrapError {
    return new PluginBootstrapError({
      reason: "NotReady",
      message: "Plugin bootstrap is not ready. Vite must call configResolved before this hook.",
    });
  }
}
