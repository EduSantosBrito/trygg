import { Effect, Schema } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { PROCESS_GROUP_FORCE_KILL_AFTER, ProcessGroup } from "./ports/process-group.js";

export interface ProcessOptions {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
}

export class ProcessSpawnError extends Schema.TaggedError<ProcessSpawnError>()(
  "ProcessSpawnError",
  {
    executable: Schema.String,
    args: Schema.Array(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export class ProcessStatusError extends Schema.TaggedError<ProcessStatusError>()(
  "ProcessStatusError",
  {
    executable: Schema.String,
    args: Schema.Array(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export class ProcessExitError extends Schema.TaggedError<ProcessExitError>()("ProcessExitError", {
  executable: Schema.String,
  args: Schema.Array(Schema.String),
  exitCode: Schema.Number,
}) {}

export const runProcess = Effect.fn("Cli.runProcess")(function* (options: ProcessOptions) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const processGroup = yield* ProcessGroup;

  yield* processGroup.ensureSupported;

  return yield* Effect.scoped(
    Effect.acquireUseRelease(
      spawner
        .spawn(
          ChildProcess.make(options.executable, options.args, {
            cwd: options.cwd,
            detached: true,
            killSignal: "SIGTERM",
            forceKillAfter: PROCESS_GROUP_FORCE_KILL_AFTER,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProcessSpawnError({
                executable: options.executable,
                args: options.args,
                cause,
              }),
          ),
        ),
      (handle) =>
        Effect.gen(function* () {
          const exitCode = yield* handle.exitCode.pipe(
            Effect.mapError(
              (cause) =>
                new ProcessStatusError({
                  executable: options.executable,
                  args: options.args,
                  cause,
                }),
            ),
          );

          if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
            return yield* new ProcessExitError({
              executable: options.executable,
              args: options.args,
              exitCode,
            });
          }
        }),
      (handle) => processGroup.terminate(handle.pid),
    ),
  );
});
