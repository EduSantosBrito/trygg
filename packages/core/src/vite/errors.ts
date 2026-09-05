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
export class PluginFileSystemError extends Schema.TaggedError<PluginFileSystemError>()(
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
export class PluginBootstrapError extends Schema.TaggedError<PluginBootstrapError>()(
  "PluginBootstrapError",
  {
    reason: Schema.Literals(["NotReady", "Interrupted", "Defect"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {
  static notReady(): PluginBootstrapError {
    return new PluginBootstrapError({
      reason: "NotReady",
      message: "Plugin bootstrap is not ready. Vite must call configResolved before this hook.",
    });
  }

  static interrupted(cause: unknown): PluginBootstrapError {
    return new PluginBootstrapError({
      reason: "Interrupted",
      message: "Plugin bootstrap was interrupted before readiness was established.",
      cause,
    });
  }

  static defect(cause: unknown): PluginBootstrapError {
    return new PluginBootstrapError({
      reason: "Defect",
      message: "Plugin bootstrap failed before readiness was established.",
      cause,
    });
  }
}

/**
 * Route declaration codegen could not preserve the source schema contract.
 *
 * @internal
 * @since 1.0.0
 */
export class PluginParseError extends Schema.TaggedError<PluginParseError>()("PluginParseError", {
  description: Schema.String,
  input: Schema.Unknown,
}) {
  override get message(): string {
    return this.description;
  }
}
