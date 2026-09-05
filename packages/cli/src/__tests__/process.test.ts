import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Predicate,
  Ref,
  Schema,
  Sink,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { assert, describe, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import * as path from "node:path";
import * as ProcessGroupPosix from "../adapters/process-group-live.js";
import { ProcessGroup, UnsupportedProcessPlatformError } from "../ports/process-group.js";
import {
  type ProcessOptions,
  ProcessExitError,
  ProcessSpawnError,
  runProcess,
} from "../process.js";

const processOptions: ProcessOptions = {
  executable: "tool",
  args: ["install", "--frozen"],
  cwd: "/workspace/app",
};

const quiescentProcessGroup = ProcessGroup.of({
  ensureSupported: Effect.void,
  terminate: () => Effect.void,
});

const makeHandle = (
  exitCode: Effect.Effect<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>,
  kill: ChildProcessSpawner.ChildProcessHandle["kill"] = () => Effect.void,
): ChildProcessSpawner.ChildProcessHandle =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(42),
    exitCode,
    isRunning: Effect.succeed(true),
    kill,
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

describe("runProcess", () => {
  it.effect("should pass executable arguments without a shell and finalize after success", () =>
    Effect.gen(function* () {
      // Scope: verifies the production process boundary and its normal lifecycle.
      // Assertion: arguments remain structured, shell mode is absent, and scope release finishes.
      const captured = yield* Ref.make<Option.Option<ChildProcess.Command>>(Option.none());
      const finalized = yield* Ref.make(false);
      const handle = makeHandle(Effect.succeed(ChildProcessSpawner.ExitCode(0)));
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.acquireRelease(Ref.set(captured, Option.some(command)).pipe(Effect.as(handle)), () =>
          Ref.set(finalized, true),
        ),
      );

      yield* runProcess(processOptions).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(ProcessGroup, quiescentProcessGroup),
      );

      const capturedCommand = yield* Ref.get(captured);
      assert.isTrue(Option.isSome(capturedCommand));
      if (Option.isSome(capturedCommand)) {
        assert.strictEqual(capturedCommand.value._tag, "StandardCommand");
        if (Predicate.isTagged(capturedCommand.value, "StandardCommand")) {
          assert.strictEqual(capturedCommand.value.command, "tool");
          assert.deepEqual(capturedCommand.value.args, ["install", "--frozen"]);
          assert.strictEqual(capturedCommand.value.options.cwd, "/workspace/app");
          assert.isUndefined(capturedCommand.value.options.shell);
          assert.isTrue(capturedCommand.value.options.detached);
          assert.strictEqual(capturedCommand.value.options.killSignal, "SIGTERM");
          assert.strictEqual(capturedCommand.value.options.forceKillAfter, "5 seconds");
        }
      }
      assert.isTrue(yield* Ref.get(finalized));
    }),
  );

  it.effect("should preserve a non-zero exit as ProcessExitError", () =>
    Effect.gen(function* () {
      // Scope: verifies command-level operational failure classification.
      // Assertion: the exact executable, arguments, and exit code remain typed.
      const spawner = ChildProcessSpawner.make(() =>
        Effect.succeed(makeHandle(Effect.succeed(ChildProcessSpawner.ExitCode(23)))),
      );

      const error = yield* Effect.flip(
        runProcess(processOptions).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(ProcessGroup, quiescentProcessGroup),
        ),
      );

      assert.instanceOf(error, ProcessExitError);
      if (error instanceof ProcessExitError) {
        assert.strictEqual(error.exitCode, 23);
        assert.deepEqual(error.args, ["install", "--frozen"]);
      }
    }),
  );

  it.effect("should preserve spawn failure as ProcessSpawnError", () =>
    Effect.gen(function* () {
      // Scope: verifies host spawn failures do not become defects or cancellation.
      // Assertion: the typed spawn tag retains the platform cause.
      const cause = PlatformError.badArgument({
        module: "ChildProcess",
        method: "spawn",
        description: "test spawn failure",
      });
      const spawner = ChildProcessSpawner.make(() => Effect.fail(cause));

      const error = yield* Effect.flip(
        runProcess(processOptions).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(ProcessGroup, quiescentProcessGroup),
        ),
      );

      assert.instanceOf(error, ProcessSpawnError);
      if (error instanceof ProcessSpawnError) {
        assert.strictEqual(error.cause, cause);
      }
    }),
  );

  it.effect("should await group quiescence before the spawner finalizer can complete", () =>
    Effect.gen(function* () {
      // Scope: verifies Ctrl+C-style interruption owns descendants ahead of the upstream leader finalizer.
      // Assertion: interruption waits for group quiescence, leader exit, and spawner release in that order.
      const spawned = yield* Deferred.make<void>();
      const pendingExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      const allowProcessExit = yield* Deferred.make<void>();
      const killRequested = yield* Deferred.make<ChildProcess.KillOptions | undefined>();
      const groupTerminationStarted = yield* Deferred.make<number>();
      const allowGroupQuiescence = yield* Deferred.make<void>();
      const finalizerStarted = yield* Deferred.make<void>();
      const allowFinalizer = yield* Deferred.make<void>();
      const finalized = yield* Ref.make(false);
      const handle = makeHandle(Deferred.await(pendingExit), (options) =>
        Deferred.succeed(killRequested, options).pipe(
          Effect.andThen(Deferred.await(allowProcessExit)),
          Effect.andThen(Deferred.succeed(pendingExit, ChildProcessSpawner.ExitCode(143))),
          Effect.asVoid,
        ),
      );
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.acquireRelease(Deferred.succeed(spawned, undefined).pipe(Effect.as(handle)), () =>
          handle
            .kill(Predicate.isTagged(command, "StandardCommand") ? command.options : undefined)
            .pipe(
              Effect.catchTag("PlatformError", (error) =>
                Effect.logError("Controlled process termination failed", error),
              ),
              Effect.andThen(Deferred.succeed(finalizerStarted, undefined)),
              Effect.andThen(Deferred.await(allowFinalizer)),
              Effect.andThen(Ref.set(finalized, true)),
            ),
        ),
      );
      const processGroup = ProcessGroup.of({
        ensureSupported: Effect.void,
        terminate: (processGroupId) =>
          Deferred.succeed(groupTerminationStarted, processGroupId).pipe(
            Effect.andThen(Deferred.await(allowGroupQuiescence)),
          ),
      });
      const fiber = yield* Effect.forkChild(
        runProcess(processOptions).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(ProcessGroup, processGroup),
        ),
      );

      yield* Deferred.await(spawned);
      const interruptRequest = yield* Effect.forkChild(Fiber.interrupt(fiber));
      const processGroupId = yield* Deferred.await(groupTerminationStarted);

      assert.strictEqual(processGroupId, 42);
      assert.isTrue(Option.isNone(yield* Deferred.poll(killRequested)));
      assert.isTrue(Option.isNone(yield* Deferred.poll(finalizerStarted)));
      assert.isUndefined(interruptRequest.pollUnsafe());

      yield* Deferred.succeed(allowGroupQuiescence, undefined);
      const killOptions = yield* Deferred.await(killRequested);

      assert.isDefined(killOptions);
      if (killOptions !== undefined) {
        assert.strictEqual(killOptions.killSignal, "SIGTERM");
        assert.strictEqual(killOptions.forceKillAfter, "5 seconds");
      }
      assert.isUndefined(interruptRequest.pollUnsafe());
      assert.isFalse(yield* Ref.get(finalized));

      yield* Deferred.succeed(allowProcessExit, undefined);
      yield* Deferred.await(finalizerStarted);
      assert.isUndefined(interruptRequest.pollUnsafe());
      assert.isFalse(yield* Ref.get(finalized));

      yield* Deferred.succeed(allowFinalizer, undefined);
      yield* Fiber.join(interruptRequest);
      const exit = yield* Fiber.await(fiber);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isTrue(Cause.hasInterrupts(exit.cause));
      }
      assert.isTrue(yield* Ref.get(finalized));
    }),
  );

  it.effect("should reject an unsupported process-group platform before spawn", () =>
    Effect.gen(function* () {
      // Scope: verifies the CLI's explicit unsupported-platform policy at the process adapter boundary.
      // Assertion: Windows fails with a typed error before any unowned child can start.
      const spawnCalled = yield* Ref.make(false);
      const spawner = ChildProcessSpawner.make(() =>
        Ref.set(spawnCalled, true).pipe(
          Effect.andThen(
            Effect.succeed(makeHandle(Effect.succeed(ChildProcessSpawner.ExitCode(0)))),
          ),
        ),
      );
      const processGroup = ProcessGroupPosix.make({
        platform: "win32",
        signal: () => Effect.succeed(ProcessGroupPosix.ProcessGroupSignalResult.Missing()),
      });

      const error = yield* Effect.flip(
        runProcess(processOptions).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(ProcessGroup, processGroup),
        ),
      );

      assert.instanceOf(error, UnsupportedProcessPlatformError);
      assert.isFalse(yield* Ref.get(spawnCalled));
    }),
  );
});

describe("ProcessGroup adapter", () => {
  it.effect("should await descendant TERM finalization without force-killing the group", () =>
    Effect.gen(function* () {
      // Scope: models a leader that has exited while a descendant remains in its TERM handler.
      // Assertion: termination remains pending until the group disappears and never sends SIGKILL.
      let alive = true;
      const signals: Array<0 | "SIGTERM" | "SIGKILL"> = [];
      const processGroup = ProcessGroupPosix.make({
        platform: "linux",
        signal: (_processGroupId, signal) => {
          signals.push(signal);
          return Effect.succeed(
            alive
              ? ProcessGroupPosix.ProcessGroupSignalResult.Delivered()
              : ProcessGroupPosix.ProcessGroupSignalResult.Missing(),
          );
        },
      });
      const fiber = yield* Effect.forkChild(Effect.uninterruptible(processGroup.terminate(42)));

      yield* Effect.yieldNow;
      assert.deepEqual(signals.slice(0, 2), ["SIGTERM", 0]);
      assert.isUndefined(fiber.pollUnsafe());

      alive = false;
      yield* TestClock.adjust("20 millis");
      yield* Fiber.join(fiber);

      assert.notInclude(signals, "SIGKILL");
    }),
  );

  it.effect("should force-kill a non-quiescent group after five seconds", () =>
    Effect.gen(function* () {
      // Scope: verifies the documented upper bound for graceful process-group shutdown.
      // Assertion: SIGKILL is absent before five seconds, then sent once and joined to quiescence.
      let alive = true;
      const signals: Array<0 | "SIGTERM" | "SIGKILL"> = [];
      const processGroup = ProcessGroupPosix.make({
        platform: "linux",
        signal: (_processGroupId, signal) => {
          signals.push(signal);
          if (signal === "SIGKILL") {
            alive = false;
          }
          return Effect.succeed(
            alive || signal === "SIGKILL"
              ? ProcessGroupPosix.ProcessGroupSignalResult.Delivered()
              : ProcessGroupPosix.ProcessGroupSignalResult.Missing(),
          );
        },
      });
      const fiber = yield* Effect.forkChild(Effect.uninterruptible(processGroup.terminate(42)));

      yield* Effect.yieldNow;
      yield* TestClock.adjust("4999 millis");
      assert.notInclude(signals, "SIGKILL");

      yield* TestClock.adjust("1 millis");
      yield* Fiber.join(fiber);

      assert.strictEqual(signals.filter((signal) => signal === "SIGKILL").length, 1);
    }),
  );
});

const waitForFile = (
  fs: FileSystem.FileSystem,
  file: string,
): Effect.Effect<void, PlatformError.PlatformError> =>
  fs
    .exists(file)
    .pipe(
      Effect.flatMap((exists) =>
        exists
          ? Effect.void
          : Effect.sleep("20 millis").pipe(Effect.andThen(waitForFile(fs, file))),
      ),
    );

class ProcessProbeError extends Schema.TaggedError<ProcessProbeError>()("ProcessProbeError", {
  cause: Schema.Defect(),
}) {}

const processExists = (pid: number): Effect.Effect<boolean, ProcessProbeError> =>
  Effect.try({
    try: () => {
      process.kill(pid, 0);
      return true;
    },
    catch: (cause) => new ProcessProbeError({ cause }),
  }).pipe(
    Effect.catchTag("ProcessProbeError", (error) =>
      Predicate.hasProperty(error.cause, "code") && error.cause.code === "ESRCH"
        ? Effect.succeed(false)
        : Effect.fail(error),
    ),
  );

const waitForProcessExit = (pid: number): Effect.Effect<void, ProcessProbeError> =>
  processExists(pid).pipe(
    Effect.flatMap((exists) =>
      exists
        ? Effect.sleep("20 millis").pipe(Effect.andThen(waitForProcessExit(pid)))
        : Effect.void,
    ),
  );

it.live("should not finish interruption while a live descendant finalizes TERM", () =>
  Effect.gen(function* () {
    // Scope: exercises the real Node spawner with a detached leader and a same-group descendant.
    // Assertion: the leader exits first, CLI interruption waits for descendant cleanup, and no PID survives.
    if (process.platform === "win32") {
      return;
    }

    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "trygg-process-group-live-" });
    const parentScript = path.join(directory, "parent.mjs");
    const descendantScript = path.join(directory, "descendant.mjs");
    const parentReady = path.join(directory, "parent-ready");
    const descendantReady = path.join(directory, "descendant-ready");
    const termStarted = path.join(directory, "term-started");
    const allowFinalization = path.join(directory, "allow-finalization");
    const finalized = path.join(directory, "finalized");

    yield* fs.writeFileString(
      parentScript,
      `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [descendantScript, parentReady, descendantReady, termStarted, allowFinalization, finalized] = process.argv.slice(2);
spawn(process.execPath, [descendantScript, descendantReady, termStarted, allowFinalization, finalized], { stdio: "ignore" });
process.on("SIGTERM", () => process.exit(0));
writeFileSync(parentReady, String(process.pid));
setInterval(() => {}, 1000);
`,
    );
    yield* fs.writeFileString(
      descendantScript,
      `import { existsSync, writeFileSync } from "node:fs";
const [ready, termStarted, allowFinalization, finalized] = process.argv.slice(2);
let terminating = false;
process.on("SIGTERM", () => {
  if (terminating) return;
  terminating = true;
  writeFileSync(termStarted, "started");
  const poll = setInterval(() => {
    if (existsSync(allowFinalization)) {
      clearInterval(poll);
      writeFileSync(finalized, "finalized");
      process.exit(0);
    }
  }, 10);
});
writeFileSync(ready, String(process.pid));
setInterval(() => {}, 1000);
`,
    );

    const fiber = yield* Effect.forkChild(
      runProcess({
        executable: process.execPath,
        args: [
          parentScript,
          descendantScript,
          parentReady,
          descendantReady,
          termStarted,
          allowFinalization,
          finalized,
        ],
        cwd: directory,
      }),
    );

    yield* waitForFile(fs, parentReady).pipe(Effect.timeout("10 seconds"));
    yield* waitForFile(fs, descendantReady).pipe(Effect.timeout("10 seconds"));
    const parentPid = Number(yield* fs.readFileString(parentReady));
    const descendantPid = Number(yield* fs.readFileString(descendantReady));
    const interruption = yield* Effect.forkChild(Fiber.interrupt(fiber));

    yield* waitForFile(fs, termStarted).pipe(Effect.timeout("10 seconds"));
    yield* waitForProcessExit(parentPid).pipe(Effect.timeout("10 seconds"));
    assert.isFalse(yield* processExists(parentPid));
    assert.isTrue(yield* processExists(descendantPid));
    assert.isUndefined(interruption.pollUnsafe());

    yield* fs.writeFileString(allowFinalization, "continue");
    yield* Fiber.join(interruption).pipe(Effect.timeout("10 seconds"));

    assert.isTrue(yield* fs.exists(finalized));
    assert.isFalse(yield* processExists(descendantPid));
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, ProcessGroupPosix.layer))),
);
