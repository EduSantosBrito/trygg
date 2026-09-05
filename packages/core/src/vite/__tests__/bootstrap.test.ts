import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Predicate, Schema } from "effect";
import * as Scheduler from "effect/Scheduler";
import type { ResolvedConfig } from "vite";
import type { Output, Platform } from "../../config.js";
import { Bootstrap } from "../bootstrap.js";
import { PluginFileSystemError } from "../errors.js";

const ResolvedConfigSchema = Schema.declare((value: unknown): value is ResolvedConfig =>
  Predicate.isObject(value),
);
const resolvedConfig = Schema.decodeUnknownSync(ResolvedConfigSchema)({
  command: "serve",
  root: "/workspace",
});
const options: {
  readonly appDirName: string;
  readonly generatedDirName: string;
  readonly output: Output;
  readonly platform: Platform;
} = {
  appDirName: "app",
  generatedDirName: ".trygg",
  output: "server",
  platform: "node",
};

const causeTags = <E>(cause: Cause.Cause<E>): ReadonlyArray<Cause.Reason<E>["_tag"]> =>
  cause.reasons.map((reason) => reason._tag);

describe("Vite bootstrap lifecycle", () => {
  it.effect("should isolate waiter interruption and share one failed initialization", () =>
    Effect.gen(function* () {
      // Scope: concurrent initialize/awaitReady calls join the same pending bootstrap.
      // Assertion: canceling one waiter leaves the owner active; all other callers retain its error.
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const failure = new PluginFileSystemError({
        operation: "mkdir",
        path: "/workspace/.trygg",
        cause: "denied",
      });
      let calls = 0;
      const program = Effect.gen(function* () {
        const bootstrap = yield* Bootstrap;
        const owner = yield* bootstrap
          .initialize(resolvedConfig)
          .pipe(Effect.exit, Effect.forkChild);
        yield* Deferred.await(started);
        const initializer = yield* bootstrap
          .initialize(resolvedConfig)
          .pipe(Effect.exit, Effect.forkChild);
        const waiter = yield* bootstrap.awaitReady.pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(waiter);
        assert.isUndefined(owner.pollUnsafe());
        assert.isUndefined(initializer.pollUnsafe());
        yield* Deferred.succeed(release, undefined);
        const exits = [
          yield* Fiber.join(owner),
          yield* Fiber.join(initializer),
          yield* bootstrap.awaitReady.pipe(Effect.asVoid, Effect.exit),
          yield* bootstrap.initialize(resolvedConfig).pipe(Effect.exit),
        ];
        for (const exit of exits) {
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) assert.strictEqual(Cause.squash(exit.cause), failure);
        }
        assert.strictEqual(calls, 1);
      });
      yield* program.pipe(
        Effect.provide(
          Layer.mergeAll(
            Bootstrap.layer(options, () =>
              Effect.sync(() => {
                calls++;
              }).pipe(
                Effect.andThen(Deferred.succeed(started, undefined)),
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(Effect.fail(failure)),
              ),
            ),
            NodeFileSystemLayer,
          ),
        ),
      );
    }),
  );

  it.effect("should settle readiness when bootstrap is interrupted", () => {
    const started = Deferred.makeUnsafe<void>();
    return Effect.gen(function* () {
      // Test: should settle readiness when bootstrap is interrupted
      // Scope: covers interruption after the status has entered Bootstrapping.
      // Assertion: owner, concurrent waiter, and future waiter receive the same Interrupt Cause.
      const bootstrap = yield* Bootstrap;
      const initializing = yield* bootstrap.initialize(resolvedConfig).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const waiting = yield* bootstrap.awaitReady.pipe(Effect.exit, Effect.forkChild);

      yield* Fiber.interrupt(initializing);
      const ownerExit = yield* Fiber.await(initializing);
      const waiterExit = yield* Fiber.join(waiting);
      const futureExit = yield* bootstrap.awaitReady.pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(ownerExit));
      assert.isTrue(Exit.isFailure(waiterExit));
      assert.isTrue(Exit.isFailure(futureExit));
      if (Exit.isFailure(ownerExit) && Exit.isFailure(waiterExit) && Exit.isFailure(futureExit)) {
        assert.isTrue(Cause.hasInterruptsOnly(ownerExit.cause));
        assert.deepStrictEqual(causeTags(waiterExit.cause), causeTags(ownerExit.cause));
        assert.deepStrictEqual(causeTags(futureExit.cause), causeTags(ownerExit.cause));
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Bootstrap.layer(options, () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          ),
          NodeFileSystemLayer,
        ),
      ),
    );
  });

  it.effect("should settle readiness when bootstrap defects", () =>
    Effect.gen(function* () {
      // Test: should settle readiness when bootstrap defects
      // Scope: covers defects raised by startup work after ownership is installed.
      // Assertion: owner and all current/future waiters receive the identical Die Cause.
      const bootstrap = yield* Bootstrap;
      const ownerExit = yield* bootstrap.initialize(resolvedConfig).pipe(Effect.exit);
      const waiterExit = yield* bootstrap.awaitReady.pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(ownerExit));
      assert.isTrue(Exit.isFailure(waiterExit));
      if (Exit.isFailure(ownerExit) && Exit.isFailure(waiterExit)) {
        assert.isTrue(Cause.hasDies(ownerExit.cause));
        assert.deepStrictEqual(causeTags(waiterExit.cause), causeTags(ownerExit.cause));
        assert.strictEqual(Cause.squash(waiterExit.cause), Cause.squash(ownerExit.cause));
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Bootstrap.layer(options, () => Effect.failCause(Cause.die("bootstrap defect"))),
          NodeFileSystemLayer,
        ),
      ),
    ),
  );

  it.effect("should preserve typed bootstrap failures for all waiters", () =>
    Effect.gen(function* () {
      // Test: should preserve typed bootstrap failures for all waiters
      // Scope: covers expected filesystem failure settlement.
      // Assertion: initialize and awaitReady fail with the same project-owned error.
      const bootstrap = yield* Bootstrap;
      const ownerExit = yield* bootstrap.initialize(resolvedConfig).pipe(Effect.exit);
      const waiterExit = yield* bootstrap.awaitReady.pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(ownerExit));
      assert.isTrue(Exit.isFailure(waiterExit));
      if (Exit.isFailure(ownerExit) && Exit.isFailure(waiterExit)) {
        assert.deepStrictEqual(causeTags(waiterExit.cause), causeTags(ownerExit.cause));
        assert.strictEqual(Cause.squash(waiterExit.cause), Cause.squash(ownerExit.cause));
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Bootstrap.layer(options, () =>
            Effect.fail(
              new PluginFileSystemError({
                operation: "mkdir",
                path: "/workspace/.trygg",
                cause: "permission denied",
              }),
            ),
          ),
          NodeFileSystemLayer,
        ),
      ),
    ),
  );

  it.effect("should preserve mixed terminal Causes for concurrent and future waiters", () =>
    Effect.gen(function* () {
      // Test: should preserve mixed terminal Causes for concurrent and future waiters
      // Scope: covers fail+die and fail+interrupt bootstrap termination after a waiter subscribes.
      // Assertion: no path reduces either mixed Cause to its first typed filesystem failure.
      const failure = new PluginFileSystemError({
        operation: "mkdir",
        path: "/workspace/.trygg",
        cause: "permission denied",
      });
      const causes: ReadonlyArray<Cause.Cause<PluginFileSystemError>> = [
        Cause.combine(Cause.fail(failure), Cause.die("bootstrap defect")),
        Cause.combine(Cause.fail(failure), Cause.interrupt(44)),
      ];

      for (const terminalCause of causes) {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const program = Effect.gen(function* () {
          const bootstrap = yield* Bootstrap;
          const owner = yield* bootstrap
            .initialize(resolvedConfig)
            .pipe(Effect.exit, Effect.forkChild);
          yield* Deferred.await(started);
          const currentWaiter = yield* bootstrap.awaitReady.pipe(Effect.exit, Effect.forkChild);
          yield* Deferred.succeed(release, undefined).pipe(Effect.asVoid);

          const ownerExit = yield* Fiber.join(owner);
          const currentExit = yield* Fiber.join(currentWaiter);
          const futureExit = yield* bootstrap.awaitReady.pipe(Effect.exit);

          assert.isTrue(Exit.isFailure(ownerExit));
          assert.isTrue(Exit.isFailure(currentExit));
          assert.isTrue(Exit.isFailure(futureExit));
          if (
            Exit.isFailure(ownerExit) &&
            Exit.isFailure(currentExit) &&
            Exit.isFailure(futureExit)
          ) {
            assert.isTrue(Cause.hasFails(ownerExit.cause));
            assert.deepStrictEqual(causeTags(currentExit.cause), causeTags(ownerExit.cause));
            assert.deepStrictEqual(causeTags(futureExit.cause), causeTags(ownerExit.cause));
            assert.deepStrictEqual(causeTags(ownerExit.cause), causeTags(terminalCause));
            assert.strictEqual(ownerExit.cause.reasons.find(Cause.isFailReason)?.error, failure);
          }
        });

        yield* program.pipe(
          Effect.provide(
            Layer.mergeAll(
              Bootstrap.layer(options, () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(Effect.failCause(terminalCause)),
                ),
              ),
              NodeFileSystemLayer,
            ),
          ),
        );
      }
    }),
  );

  it.effect("should settle interruption delivered immediately before initializer execution", () =>
    Effect.gen(function* () {
      // Test: should settle interruption delivered immediately before initializer execution
      // Scope: uses a controlled scheduler at the Pending-to-Bootstrapping claim boundary.
      // Assertion: initializer never starts and the exact owner Interrupt Cause reaches future waiters.
      const failure = new PluginFileSystemError({
        operation: "mkdir",
        path: "/workspace/.trygg",
        cause: "baseline",
      });
      const baseline = new Scheduler.MixedScheduler();
      let baselineOperations = 0;
      let initializerOperation = 0;
      const countingScheduler: Scheduler.Scheduler = {
        executionMode: baseline.executionMode,
        makeDispatcher: () => baseline.makeDispatcher(),
        shouldYield: (fiber) => {
          baselineOperations += 1;
          return baseline.shouldYield(fiber);
        },
      };
      const baselineProgram = Effect.gen(function* () {
        const bootstrap = yield* Bootstrap;
        yield* bootstrap
          .initialize(resolvedConfig)
          .pipe(Effect.provideService(Scheduler.Scheduler, countingScheduler), Effect.exit);
      });
      yield* baselineProgram.pipe(
        Effect.provide(
          Layer.mergeAll(
            Bootstrap.layer(options, () =>
              Effect.sync(() => {
                initializerOperation = baselineOperations;
              }).pipe(Effect.andThen(Effect.fail(failure))),
            ),
            NodeFileSystemLayer,
          ),
        ),
      );

      assert.isAbove(initializerOperation, 0);

      const controlled = new Scheduler.MixedScheduler();
      let operations = 0;
      let initializerCalls = 0;
      const interruptingScheduler: Scheduler.Scheduler = {
        executionMode: controlled.executionMode,
        makeDispatcher: () => controlled.makeDispatcher(),
        shouldYield: (fiber) => {
          operations += 1;
          if (operations === initializerOperation - 1) fiber.interruptUnsafe();
          return controlled.shouldYield(fiber);
        },
      };
      const interruptedProgram = Effect.gen(function* () {
        const bootstrap = yield* Bootstrap;
        const owner = yield* bootstrap
          .initialize(resolvedConfig)
          .pipe(
            Effect.provideService(Scheduler.Scheduler, interruptingScheduler),
            Effect.forkChild({ startImmediately: true }),
          );
        const ownerExit = yield* Fiber.await(owner);
        const waiterExit = yield* bootstrap.awaitReady.pipe(Effect.exit);

        assert.strictEqual(initializerCalls, 0);
        assert.isTrue(Exit.isFailure(ownerExit));
        assert.isTrue(Exit.isFailure(waiterExit));
        if (Exit.isFailure(ownerExit) && Exit.isFailure(waiterExit)) {
          assert.isTrue(Cause.hasInterruptsOnly(ownerExit.cause));
          assert.deepStrictEqual(causeTags(waiterExit.cause), causeTags(ownerExit.cause));
        }
      });
      yield* interruptedProgram.pipe(
        Effect.provide(
          Layer.mergeAll(
            Bootstrap.layer(options, () =>
              Effect.sync(() => {
                initializerCalls += 1;
              }).pipe(Effect.andThen(Effect.fail(failure))),
            ),
            NodeFileSystemLayer,
          ),
        ),
      );
    }),
  );
});
