import { Clock, Data, Effect, Layer, Predicate, Schema } from "effect";
import {
  PROCESS_GROUP_FORCE_KILL_AFTER_MILLIS,
  ProcessGroup,
  ProcessGroupControlError,
  type ProcessGroupService,
  UnsupportedProcessPlatformError,
} from "../ports/process-group.js";

type ProcessGroupSignal = 0 | "SIGTERM" | "SIGKILL";

export type ProcessGroupSignalResult = Data.TaggedEnum<{
  readonly Delivered: {};
  readonly Missing: {};
  readonly Failed: { readonly cause: unknown };
}>;

export const ProcessGroupSignalResult = Data.taggedEnum<ProcessGroupSignalResult>();

class HostSignalError extends Schema.TaggedError<HostSignalError>()("HostSignalError", {
  cause: Schema.Defect(),
}) {}

export interface ProcessGroupHost {
  readonly platform: string;
  readonly signal: (
    processGroupId: number,
    signal: ProcessGroupSignal,
  ) => Effect.Effect<ProcessGroupSignalResult>;
}

const supportedPlatforms = new Set([
  "aix",
  "android",
  "cygwin",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
]);

// Windows has no negative-PID process-group signaling; fail before spawn rather than claim tree ownership.

const isMissingProcess = (cause: unknown): boolean =>
  Predicate.hasProperty(cause, "code") && cause.code === "ESRCH";

const liveHost: ProcessGroupHost = {
  platform: process.platform,
  signal: (processGroupId, signal) =>
    Effect.try({
      try: () => {
        process.kill(-processGroupId, signal);
        return ProcessGroupSignalResult.Delivered();
      },
      catch: (cause) => new HostSignalError({ cause }),
    }).pipe(
      Effect.catchTag("HostSignalError", ({ cause }) =>
        Effect.succeed(
          isMissingProcess(cause)
            ? ProcessGroupSignalResult.Missing()
            : ProcessGroupSignalResult.Failed({ cause }),
        ),
      ),
    ),
};

const operationFor = (signal: ProcessGroupSignal): "probe" | "SIGTERM" | "SIGKILL" =>
  signal === 0 ? "probe" : signal;

export const make = (host: ProcessGroupHost): ProcessGroupService => {
  const ensureSupported = supportedPlatforms.has(host.platform)
    ? Effect.void
    : Effect.fail(new UnsupportedProcessPlatformError({ platform: host.platform }));

  const signal = Effect.fn("Cli.ProcessGroup.signal")(function* (
    processGroupId: number,
    requestedSignal: ProcessGroupSignal,
  ) {
    const result = yield* host.signal(processGroupId, requestedSignal);

    if (Predicate.isTagged(result, "Failed")) {
      return yield* new ProcessGroupControlError({
        platform: host.platform,
        processGroupId,
        operation: operationFor(requestedSignal),
        cause: result.cause,
      });
    }

    return Predicate.isTagged(result, "Delivered");
  });

  const awaitQuiescence = (processGroupId: number): Effect.Effect<void, ProcessGroupControlError> =>
    signal(processGroupId, 0).pipe(
      Effect.flatMap((alive) =>
        alive
          ? Effect.sleep("20 millis").pipe(Effect.andThen(awaitQuiescence(processGroupId)))
          : Effect.void,
      ),
    );

  const awaitQuiescenceBefore = (
    processGroupId: number,
    deadline: number,
  ): Effect.Effect<boolean, ProcessGroupControlError> =>
    signal(processGroupId, 0).pipe(
      Effect.flatMap((alive) => {
        if (!alive) {
          return Effect.succeed(true);
        }

        return Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) =>
            now >= deadline
              ? Effect.succeed(false)
              : Effect.sleep("20 millis").pipe(
                  Effect.andThen(awaitQuiescenceBefore(processGroupId, deadline)),
                ),
          ),
        );
      }),
    );

  return ProcessGroup.of({
    ensureSupported,
    terminate: Effect.fn("Cli.ProcessGroup.terminate")(function* (processGroupId: number) {
      yield* ensureSupported;

      const termDelivered = yield* signal(processGroupId, "SIGTERM");
      if (!termDelivered) {
        return;
      }

      const startedAt = yield* Clock.currentTimeMillis;
      const graceful = yield* awaitQuiescenceBefore(
        processGroupId,
        startedAt + PROCESS_GROUP_FORCE_KILL_AFTER_MILLIS,
      );
      if (graceful) {
        return;
      }

      const killDelivered = yield* signal(processGroupId, "SIGKILL");
      if (killDelivered) {
        yield* awaitQuiescence(processGroupId);
      }
    }),
  });
};

export const layer = Layer.succeed(ProcessGroup, make(liveHost));
