import { Effect, Schema } from "effect";
import * as Context from "effect/Context";

export const PROCESS_GROUP_FORCE_KILL_AFTER = "5 seconds";
export const PROCESS_GROUP_FORCE_KILL_AFTER_MILLIS = 5_000;

export class UnsupportedProcessPlatformError extends Schema.TaggedError<UnsupportedProcessPlatformError>()(
  "UnsupportedProcessPlatformError",
  {
    platform: Schema.String,
  },
) {}

export class ProcessGroupControlError extends Schema.TaggedError<ProcessGroupControlError>()(
  "ProcessGroupControlError",
  {
    platform: Schema.String,
    processGroupId: Schema.Number,
    operation: Schema.Literals(["probe", "SIGTERM", "SIGKILL"]),
    cause: Schema.Defect(),
  },
) {}

export class ProcessGroup extends Context.Service<
  ProcessGroup,
  {
    readonly ensureSupported: Effect.Effect<void, UnsupportedProcessPlatformError>;
    readonly terminate: (
      processGroupId: number,
    ) => Effect.Effect<void, UnsupportedProcessPlatformError | ProcessGroupControlError>;
  }
>()("trygg/ProcessGroup") {}

export type ProcessGroupService = ProcessGroup["Service"];
