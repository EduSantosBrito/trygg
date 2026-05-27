import { Schema } from "effect";

const PluginFileSystemOperation = Schema.Union([
  Schema.Literal("read"),
  Schema.Literal("write"),
  Schema.Literal("mkdir"),
  Schema.Literal("exists"),
  Schema.Literal("readdir"),
  Schema.Literal("stat"),
  Schema.Literal("transform"),
  Schema.Literal("remove"),
]);

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
export class PluginFileSystemError extends Schema.TaggedErrorClass<PluginFileSystemError>()(
  "PluginFileSystemError",
  {
    operation: PluginFileSystemOperation,
    path: Schema.String,
    cause: Schema.Unknown,
  },
) {}

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
export class PluginBootstrapError extends Schema.TaggedErrorClass<PluginBootstrapError>()(
  "PluginBootstrapError",
  {
    reason: Schema.Literal("NotReady"),
    message: Schema.String,
  },
) {
  static notReady(): PluginBootstrapError {
    return new PluginBootstrapError({
      reason: "NotReady",
      message: "Plugin bootstrap is not ready. Vite must call configResolved before this hook.",
    });
  }
}
