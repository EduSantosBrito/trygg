import { assert, describe, it } from "@effect/vitest";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Option, Predicate, Scope } from "effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Trace from "../../trace/index.js";
import { unsafeWidenContext } from "../../internal/unsafe.js";
import * as RenderTransaction from "../render-transaction.js";
import * as SafeUrl from "../../security/safe-url.js";
import { Element } from "../element.js";
import type { RenderContext, RenderResult } from "../renderer.js";

const makeContext: Effect.Effect<RenderContext> = Effect.gen(function* () {
  const scope = yield* Scope.make();
  return {
    services: unsafeWidenContext(Context.empty()),
    scope,
    safeUrlConfig: SafeUrl.defaultConfig,
  };
});

const traceEventsFor = Effect.fn("RenderTransactionTest.traceEventsFor")(function* <E, R>(
  effect: Effect.Effect<void, E, R>,
) {
  const recorder = Trace.makeRecorder();
  yield* Trace.record(effect, recorder);
  return recorder.records();
});

const eventNames = (
  records: ReadonlyArray<Trace.TraceRecord>,
): ReadonlyArray<Trace.TraceEventName> => records.map((record) => record.name);

const result = (node: Node, cleanupLog: Array<string>, label: string): RenderResult => ({
  node,
  cleanup: Effect.sync(() => {
    cleanupLog.push(label);
    node.parentNode?.removeChild(node);
  }),
});

const releaseNoStagedScope = (_exit: Exit.Exit<void, unknown>): Effect.Effect<void> => Effect.void;

describe("RenderTransaction", () => {
  for (const boundary of ["operation", "child"]) {
    for (const matched of [false, true]) {
      it.effect(
        `should retain reconciliation outcomes at the ${boundary} boundary (matched: ${matched})`,
        () =>
          Effect.gen(function* () {
            // Scope: internal child facts and public operation events have different owners.
            // Assertion: event volume changes without changing the reconciliation protocol or top-level ordering.
            const context = yield* makeContext;
            const previous: RenderResult = {
              node: document.createElement("span"),
              cleanup: Effect.void,
              reconcile: () => Effect.succeed(matched),
            };
            const recorder = Trace.makeRecorder();
            const outcome = yield* Trace.record(
              RenderTransaction.reconcile({
                boundary: boundary === "child" ? "child" : "operation",
                previous,
                nextElement: Element.Text({ content: "next" }),
                nextContext: null,
                context,
              }),
              recorder,
            );
            assert.strictEqual(outcome._tag, matched ? "Reconciled" : "NotReconciled");
            assert.deepStrictEqual(
              eventNames(recorder.records()),
              boundary === "child"
                ? ["render.child.reconcile"]
                : matched
                  ? [
                      "signalElement.swap.start",
                      "signalElement.swap.render",
                      "signalElement.swap.commit",
                    ]
                  : ["signalElement.swap.start", "signalElement.swap.render"],
            );
            if (boundary === "child")
              assert.deepStrictEqual(
                recorder.records().map((record) => record.payload),
                [{ reconciled: matched }],
              );
          }),
      );
    }
  }

  for (const failureKind of ["typed", "defect", "interrupted"]) {
    it.effect(
      `should preserve ${failureKind} failure and its diagnostic while reconciling a child`,
      () =>
        Effect.gen(function* () {
          // Scope: reducing successful internal narration must not suppress failure facts or Cause reasons.
          // Assertion: typed failures keep their recoverable outcome; defects/interruption remain failed Exits.
          const context = yield* makeContext;
          const error = new RenderTransaction.RenderTransactionError({
            phase: "render",
            cause: "child",
          });
          const reconcile =
            failureKind === "typed"
              ? Effect.fail(error)
              : failureKind === "defect"
                ? Effect.sync(() => decodeURIComponent("%")).pipe(Effect.as(true))
                : Effect.interrupt;
          const previous: RenderResult = {
            node: document.createElement("span"),
            cleanup: Effect.void,
            reconcile: () => reconcile,
          };
          const recorder = Trace.makeRecorder();
          const exit = yield* Trace.record(
            RenderTransaction.reconcile({
              boundary: "child",
              previous,
              nextElement: Element.Text({ content: "next" }),
              nextContext: null,
              context,
            }),
            recorder,
          ).pipe(Effect.exit);
          if (failureKind === "typed") {
            if (Exit.isFailure(exit) || !Predicate.isTagged(exit.value, "FailedBeforeCommit"))
              return assert.fail("Expected recoverable typed outcome");
            assert.strictEqual(
              Option.getOrUndefined(Cause.findErrorOption(exit.value.cause)),
              error,
            );
          } else {
            if (Exit.isSuccess(exit)) return assert.fail("Expected failed reconciliation Exit");
            if (failureKind === "interrupted") assert.isTrue(Cause.hasInterrupts(exit.cause));
            else
              assert.isTrue(
                exit.cause.reasons.some(
                  (reason) => Cause.isDieReason(reason) && reason.defect instanceof URIError,
                ),
              );
          }
          assert.deepStrictEqual(eventNames(recorder.records()), [
            "signalElement.swap.failBeforeCommit",
          ]);
        }),
    );
  }

  it.effect("should close a failed staged render with its original failure Exit", () =>
    Effect.gen(function* () {
      // Scope: the transaction owns resources acquired before renderNext produces a typed failure.
      // Assertion: rollback finalizers see failure, the outcome retains its Cause, and old DOM survives.
      const context = yield* makeContext;
      const staged = yield* Scope.make();
      const parent = document.createElement("div");
      const previous = document.createElement("span");
      parent.appendChild(previous);
      const exits: Array<Exit.Exit<unknown, unknown>> = [];
      const failure = new RenderTransaction.RenderTransactionError({
        phase: "render",
        cause: "staged",
      });
      let commits = 0;
      const outcome = yield* RenderTransaction.replace({
        parent,
        previous: Option.some(result(previous, [], "previous")),
        renderNext: Effect.addFinalizer((exit) =>
          Effect.sync(() => {
            exits.push(exit);
          }),
        ).pipe(Effect.andThen(failure), Scope.provide(staged)),
        context,
        onCommit: () => {
          commits++;
        },
        releaseStagedScope: (exit) => Scope.close(staged, exit),
      });
      assert.isTrue(Predicate.isTagged(outcome, "FailedBeforeCommit"));
      assert.strictEqual(commits, 0);
      assert.deepStrictEqual(Array.from(parent.childNodes), [previous]);
      assert.strictEqual(exits.length, 1);
      const [exit] = exits;
      assert.isDefined(exit);
      if (exit !== undefined) {
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.strictEqual(Option.getOrUndefined(Cause.findErrorOption(exit.cause)), failure);
        }
      }
    }),
  );

  it.effect(
    "should preserve both render failure and staged finalizer defect when rollback fails",
    () =>
      Effect.gen(function* () {
        // Scope: rollback itself fails after a typed failure prevents a render commit.
        // Assertion: both reasons remain terminal, and the staged scope is closed exactly once.
        const context = yield* makeContext;
        const staged = yield* Scope.make();
        const failure = new RenderTransaction.RenderTransactionError({
          phase: "render",
          cause: "staged",
        });
        const defect = { stage: "rollback" };
        let releases = 0;
        const exit = yield* Effect.exit(
          RenderTransaction.replace({
            parent: document.createElement("div"),
            previous: Option.none(),
            renderNext: Effect.addFinalizer(() =>
              Effect.sync(() => {
                releases++;
              }).pipe(Effect.andThen(Effect.failCause(Cause.die(defect)))),
            ).pipe(Effect.andThen(failure), Scope.provide(staged)),
            context,
            onCommit: () => assert.fail("A failed render cannot commit"),
            releaseStagedScope: (exit) => Scope.close(staged, exit),
          }),
        );
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.strictEqual(Option.getOrUndefined(Cause.findErrorOption(exit.cause)), failure);
          assert.isTrue(
            exit.cause.reasons.some(
              (reason) => Cause.isDieReason(reason) && reason.defect === defect,
            ),
          );
        }
        assert.strictEqual(releases, 1);
        assert.strictEqual(staged.state._tag, "Closed");
      }),
  );

  it.effect("commits replacement before cleaning previous result", () =>
    Effect.gen(function* () {
      const parent = document.createElement("div");
      const previousNode = document.createElement("span");
      previousNode.textContent = "old";
      parent.appendChild(previousNode);
      const cleanupSnapshots: Array<string> = [];
      const previous = result(previousNode, cleanupSnapshots, "old");
      const context = yield* makeContext;

      const outcome = yield* RenderTransaction.replace({
        parent,
        previous: Option.some(previous),
        renderNext: Effect.sync(() => {
          const nextNode = document.createElement("strong");
          nextNode.textContent = "new";
          return result(nextNode, [], "new");
        }),
        context,
        onCommit: () => {},
        releaseStagedScope: releaseNoStagedScope,
      }).pipe(Effect.scoped);

      assert.isTrue(Predicate.isTagged(outcome, "Committed"));
      assert.strictEqual(parent.textContent, "new");
      assert.deepStrictEqual(cleanupSnapshots, ["old"]);
    }),
  );

  it.effect("represents reconcile success and skipped fallback explicitly", () =>
    Effect.gen(function* () {
      const node = document.createElement("div");
      const context = yield* makeContext;
      const previous = {
        ...result(node, [], "previous"),
        reconcile: () => Effect.succeed(true),
      } satisfies RenderResult;

      const reconciled = yield* RenderTransaction.reconcile({
        previous,
        nextElement: Element.Text({ content: "next" }),
        nextContext: null,
        context,
      });
      const skipped = yield* RenderTransaction.reconcile({
        previous: result(node, [], "previous"),
        nextElement: Element.Text({ content: "next" }),
        nextContext: null,
        context,
      });

      assert.isTrue(Predicate.isTagged(reconciled, "Reconciled"));
      assert.isTrue(Predicate.isTagged(skipped, "NotReconciled"));
    }),
  );

  it.effect("emits no-blank replacement and cleanup traces", () =>
    Effect.gen(function* () {
      const parent = document.createElement("div");
      const previousNode = document.createElement("span");
      previousNode.textContent = "old";
      parent.appendChild(previousNode);
      const context = yield* makeContext;

      const records = yield* traceEventsFor(
        RenderTransaction.replace({
          parent,
          previous: Option.some(result(previousNode, [], "old")),
          renderNext: Effect.sync(() => {
            const nextNode = document.createElement("strong");
            nextNode.textContent = "new";
            return result(nextNode, [], "new");
          }),
          context,
          onCommit: () => {},
          releaseStagedScope: releaseNoStagedScope,
        }).pipe(Effect.asVoid, Effect.scoped),
      );

      assert.deepStrictEqual(eventNames(records), [
        "signalElement.swap.start",
        "signalElement.swap.render",
        "signalElement.swap.commit",
        "signalElement.cleanup",
      ]);
      assert.strictEqual(parent.textContent, "new");
    }),
  );

  it.effect("emits failed-before-commit traces without blanking previous UI", () =>
    Effect.gen(function* () {
      const parent = document.createElement("div");
      const previousNode = document.createElement("span");
      previousNode.textContent = "old";
      parent.appendChild(previousNode);
      const context = yield* makeContext;

      const records = yield* traceEventsFor(
        RenderTransaction.replace({
          parent,
          previous: Option.some(result(previousNode, [], "old")),
          renderNext: Effect.fail("boom"),
          context,
          onCommit: () => {},
          releaseStagedScope: releaseNoStagedScope,
        }).pipe(Effect.asVoid, Effect.scoped),
      );

      assert.deepStrictEqual(eventNames(records), [
        "signalElement.swap.start",
        "signalElement.swap.failBeforeCommit",
      ]);
      assert.strictEqual(parent.textContent, "old");
    }),
  );

  it.effect("preserves previous UI when render fails before commit", () =>
    Effect.gen(function* () {
      const parent = document.createElement("div");
      const previousNode = document.createElement("span");
      previousNode.textContent = "old";
      parent.appendChild(previousNode);
      const context = yield* makeContext;

      const outcome = yield* RenderTransaction.replace({
        parent,
        previous: Option.some(result(previousNode, [], "old")),
        renderNext: Effect.fail("boom"),
        context,
        onCommit: () => {},
        releaseStagedScope: releaseNoStagedScope,
      }).pipe(Effect.scoped);

      assert.isTrue(Predicate.isTagged(outcome, "FailedBeforeCommit"));
      if (Predicate.isTagged(outcome, "FailedBeforeCommit")) {
        assert.deepStrictEqual(
          outcome.cause.reasons.map((reason) => reason._tag),
          ["Fail"],
        );
        assert.strictEqual(
          Cause.findErrorOption(outcome.cause).pipe(Option.getOrUndefined),
          "boom",
        );
      }
      assert.strictEqual(parent.textContent, "old");
    }),
  );

  it.effect(
    "should preserve defect and interruption causes instead of returning fallback outcomes",
    () =>
      Effect.gen(function* () {
        // Scope: covers the Cause classification boundary before a render commit.
        // Assertion: only typed failures become FailedBeforeCommit; defects and interruption fail intact.
        const context = yield* makeContext;
        const parent = document.createElement("div");

        const defectExit = yield* Effect.exit(
          RenderTransaction.replace({
            parent,
            previous: Option.none(),
            // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately exercises the render Die branch.
            renderNext: Effect.die("render-defect"),
            context,
            onCommit: () => {},
            releaseStagedScope: releaseNoStagedScope,
          }),
        );
        const interruptExit = yield* Effect.exit(
          RenderTransaction.replace({
            parent,
            previous: Option.none(),
            renderNext: Effect.interrupt,
            context,
            onCommit: () => {},
            releaseStagedScope: releaseNoStagedScope,
          }),
        );

        assert.isTrue(Exit.hasDies(defectExit));
        assert.isTrue(Exit.hasInterrupts(interruptExit));
      }),
  );

  it.effect("should release an acquired result interrupted at the post-render trace", () =>
    Effect.gen(function* () {
      // Scope: requests interruption from the first trace boundary after renderNext returns.
      // Assertion: the staged result and scope are each released once before the transaction exits.
      const context = yield* makeContext;
      const parent = document.createElement("div");
      const fragment = document.createDocumentFragment();
      const nextNode = document.createElement("strong");
      const stagedScope = yield* Scope.make();
      let nextCleanups = 0;
      let scopeCleanups = 0;
      let commits = 0;
      fragment.appendChild(nextNode);
      yield* Scope.addFinalizer(
        stagedScope,
        Effect.sync(() => {
          scopeCleanups += 1;
        }),
      );

      const interruptingLogger = Logger.make<unknown, void>(({ fiber, message }) => {
        const event = Array.isArray(message) ? message[0] : message;
        if (event === "signalElement.swap.render") {
          // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deterministically injects interruption at this exact runtime boundary.
          fiber.interruptUnsafe(101);
        }
      });
      const transactionFiber = yield* RenderTransaction.replace({
        parent,
        previous: Option.none(),
        renderNext: Effect.succeed({
          node: nextNode,
          cleanup: Effect.sync(() => {
            nextCleanups += 1;
            nextNode.remove();
          }),
        }),
        context,
        onCommit: () => {
          commits += 1;
        },
        releaseStagedScope: (releaseExit) => Scope.close(stagedScope, releaseExit),
      }).pipe(
        Effect.provide(Logger.layer([interruptingLogger])),
        Effect.provideService(References.MinimumLogLevel, "Trace"),
        Effect.forkChild,
      );
      const exit = yield* Fiber.await(transactionFiber);

      assert.isTrue(Exit.hasInterrupts(exit));
      assert.strictEqual(commits, 0);
      assert.strictEqual(nextCleanups, 1);
      assert.strictEqual(scopeCleanups, 1);
      assert.isNull(nextNode.parentNode);
      assert.isNull(parent.firstChild);
    }),
  );

  it.effect("should finish stale-result release when interruption arrives during return", () =>
    Effect.gen(function* () {
      // Scope: interrupts a DroppedStale transaction while its staged cleanup is blocked.
      // Assertion: uninterruptible release cleans the result and staged scope exactly once.
      const context = yield* makeContext;
      const parent = document.createElement("div");
      const fragment = document.createDocumentFragment();
      const nextNode = document.createElement("strong");
      const stagedScope = yield* Scope.make();
      const cleanupStarted = yield* Deferred.make<void>();
      const cleanupGate = yield* Deferred.make<void>();
      let nextCleanups = 0;
      let scopeCleanups = 0;
      let commits = 0;
      fragment.appendChild(nextNode);
      yield* Scope.addFinalizer(
        stagedScope,
        Effect.sync(() => {
          scopeCleanups += 1;
        }),
      );

      const transactionFiber = yield* RenderTransaction.replace({
        parent,
        previous: Option.none(),
        renderNext: Effect.succeed({
          node: nextNode,
          cleanup: Effect.gen(function* () {
            nextCleanups += 1;
            yield* Deferred.succeed(cleanupStarted, undefined);
            yield* Deferred.await(cleanupGate);
            nextNode.remove();
          }),
        }),
        context,
        onCommit: () => {
          commits += 1;
        },
        releaseStagedScope: (releaseExit) => Scope.close(stagedScope, releaseExit),
        shouldCommit: () => false,
      }).pipe(Effect.forkChild);

      yield* Deferred.await(cleanupStarted);
      const interruptFiber = yield* Fiber.interrupt(transactionFiber).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(cleanupGate, undefined);
      const transactionExit = yield* Fiber.await(transactionFiber);
      yield* Fiber.await(interruptFiber);

      assert.isTrue(Exit.hasInterrupts(transactionExit));
      assert.strictEqual(commits, 0);
      assert.strictEqual(nextCleanups, 1);
      assert.strictEqual(scopeCleanups, 1);
      assert.isNull(nextNode.parentNode);
      assert.isNull(parent.firstChild);
    }),
  );

  it.effect(
    "should finish commit rollback while preserving commit, interrupt, and cleanup Causes",
    () =>
      Effect.gen(function* () {
        // Scope: insertBefore requests interruption, throws, and leaves rollback blocked on a Deferred.
        // Assertion: rollback and scope release run once; Fail, Interrupt, and Die reasons all survive.
        const context = yield* makeContext;
        const parent = document.createElement("div");
        const fragment = document.createDocumentFragment();
        const nextNode = document.createElement("strong");
        const stagedScope = yield* Scope.make();
        const rollbackStarted = yield* Deferred.make<void>();
        const rollbackGate = yield* Deferred.make<void>();
        // oxlint-disable-next-line effect/no-built-in-error-constructor -- Stable identities verify both native commit and rollback Causes.
        const commitDefect = new Error("insert failed with interruption");
        // oxlint-disable-next-line effect/no-built-in-error-constructor -- Stable identity verifies the rollback defect remains combined.
        const rollbackDefect = new Error("rollback failed after interruption");
        let rollbackRuns = 0;
        let scopeCleanups = 0;
        let commits = 0;
        fragment.appendChild(nextNode);
        yield* Scope.addFinalizer(
          stagedScope,
          Effect.sync(() => {
            scopeCleanups += 1;
          }),
        );
        parent.insertBefore = () => {
          // oxlint-disable-next-line effect/no-raw-throw -- Simulates a native commit fault before external interruption reaches rollback.
          throw commitDefect;
        };

        const transactionFiber = yield* RenderTransaction.replace({
          parent,
          previous: Option.none(),
          renderNext: Effect.succeed({
            node: nextNode,
            cleanup: Effect.gen(function* () {
              rollbackRuns += 1;
              yield* Deferred.succeed(rollbackStarted, undefined);
              yield* Deferred.await(rollbackGate);
              nextNode.remove();
              // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately verifies rollback Die classification.
              return yield* Effect.die(rollbackDefect);
            }),
          }),
          context,
          onCommit: () => {
            commits += 1;
          },
          releaseStagedScope: (releaseExit) => Scope.close(stagedScope, releaseExit),
        }).pipe(Effect.forkChild);

        yield* Deferred.await(rollbackStarted);
        const interruptFiber = yield* Fiber.interrupt(transactionFiber).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(rollbackGate, undefined);
        const transactionExit = yield* Fiber.await(transactionFiber);
        yield* Fiber.await(interruptFiber);

        assert.isTrue(Exit.hasFails(transactionExit));
        assert.isTrue(Exit.hasInterrupts(transactionExit));
        assert.isTrue(Exit.hasDies(transactionExit));
        if (Exit.isFailure(transactionExit)) {
          assert.deepStrictEqual(
            transactionExit.cause.reasons.map((reason) => reason._tag),
            ["Fail", "Interrupt", "Die"],
          );
          const commitError = Cause.findErrorOption(transactionExit.cause).pipe(
            Option.getOrUndefined,
          );
          assert.instanceOf(commitError, Error);
          assert.strictEqual(commitError?.cause, commitDefect);
          assert.isTrue(
            transactionExit.cause.reasons.some(
              (reason) => Cause.isDieReason(reason) && reason.defect === rollbackDefect,
            ),
          );
        }
        assert.strictEqual(commits, 0);
        assert.strictEqual(rollbackRuns, 1);
        assert.strictEqual(scopeCleanups, 1);
        assert.isNull(nextNode.parentNode);
        assert.isNull(parent.firstChild);
      }),
  );

  it.effect("should rollback the next result when the DOM commit fails", () =>
    Effect.gen(function* () {
      // Scope: covers ownership transfer between render completion and DOM commit.
      // Assertion: a failed insert cleans the staged subtree exactly once and preserves the commit error.
      const context = yield* makeContext;
      const parent = document.createElement("div");
      // oxlint-disable-next-line effect/no-built-in-error-constructor -- Native DOM insertion is deliberately made to throw this defect.
      const commitDefect = new Error("insert failed");
      // oxlint-disable-next-line effect/no-built-in-error-constructor -- Rollback deliberately dies with this exact defect identity.
      const rollbackDefect = new Error("rollback failed");
      const nextNode = document.createElement("strong");
      const cleanups: Array<string> = [];
      parent.insertBefore = () => {
        // oxlint-disable-next-line effect/no-raw-throw -- Simulates the native insertBefore exception boundary.
        throw commitDefect;
      };

      const exit = yield* Effect.exit(
        RenderTransaction.replace({
          parent,
          previous: Option.none(),
          renderNext: Effect.succeed({
            node: nextNode,
            cleanup: Effect.sync(() => {
              cleanups.push("next");
            }).pipe(
              // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately verifies mixed commit-failure and rollback-Die Causes.
              Effect.andThen(Effect.die(rollbackDefect)),
            ),
          }),
          context,
          onCommit: () => {},
          releaseStagedScope: releaseNoStagedScope,
        }),
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(cleanups, ["next"]);
      if (Exit.isFailure(exit)) {
        assert.isTrue(Cause.hasFails(exit.cause));
        assert.isTrue(Cause.hasDies(exit.cause));
        assert.isTrue(
          exit.cause.reasons.some(
            (reason) => Cause.isDieReason(reason) && reason.defect === rollbackDefect,
          ),
        );
        const error = Cause.findErrorOption(exit.cause).pipe(Option.getOrUndefined);
        assert.instanceOf(error, Error);
        assert.strictEqual(error?.cause, commitDefect);
      }
    }),
  );

  it.effect("should return the committed owner when previous cleanup fails", () =>
    Effect.gen(function* () {
      // Scope: covers ownership after the DOM commit has become authoritative.
      // Assertion: cleanup failure is retained on Committed and the next result remains disposable.
      const context = yield* makeContext;
      const parent = document.createElement("div");
      const previousNode = document.createElement("span");
      const nextNode = document.createElement("strong");
      const nextCleanups: Array<string> = [];
      parent.appendChild(previousNode);

      const previous: RenderResult = {
        node: previousNode,
        cleanup: Effect.sync(() => previousNode.remove()).pipe(
          // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately verifies post-commit cleanup defects.
          Effect.andThen(Effect.die("previous-cleanup-defect")),
        ),
      };
      const outcome = yield* RenderTransaction.replace({
        parent,
        previous: Option.some(previous),
        renderNext: Effect.succeed(result(nextNode, nextCleanups, "next")),
        context,
        onCommit: () => {},
        releaseStagedScope: releaseNoStagedScope,
      });

      assert.isTrue(Predicate.isTagged(outcome, "Committed"));
      if (!Predicate.isTagged(outcome, "Committed")) return;
      assert.isTrue(Option.isSome(outcome.cleanupCause));
      if (Option.isSome(outcome.cleanupCause)) {
        assert.isTrue(Cause.hasDies(outcome.cleanupCause.value));
      }
      assert.strictEqual(parent.firstChild, nextNode);

      yield* RenderTransaction.cleanup(outcome.result);
      assert.deepStrictEqual(nextCleanups, ["next"]);
      assert.isNull(nextNode.parentNode);
    }),
  );

  it.effect(
    "should retain the committed owner when previous cleanup is externally interrupted",
    () =>
      Effect.gen(function* () {
        // Scope: interrupts the transaction after DOM commit while previous cleanup is suspended.
        // Assertion: interruption and cleanup defect remain visible, and later unmount cleans next once.
        const context = yield* makeContext;
        const parent = document.createElement("div");
        const previousNode = document.createElement("span");
        const nextNode = document.createElement("strong");
        const cleanupStarted = yield* Deferred.make<void>();
        const cleanupGate = yield* Deferred.make<void>();
        // oxlint-disable-next-line effect/no-built-in-error-constructor -- Stable identity verifies the cleanup defect is retained with interruption.
        const cleanupDefect = new Error("previous cleanup failed while interrupted");
        let nextCleanups = 0;
        parent.appendChild(previousNode);

        const previous: RenderResult = {
          node: previousNode,
          cleanup: Effect.gen(function* () {
            yield* Deferred.succeed(cleanupStarted, undefined);
            yield* Deferred.await(cleanupGate);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => previousNode.remove()).pipe(
                // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately verifies combined cleanup-Die and external interruption Causes.
                Effect.andThen(Effect.die(cleanupDefect)),
              ),
            ),
          ),
        };
        const next: RenderResult = {
          node: nextNode,
          cleanup: Effect.sync(() => {
            nextCleanups += 1;
            nextNode.remove();
          }),
        };
        let currentOwner: RenderResult = previous;

        const transactionFiber = yield* RenderTransaction.replace({
          parent,
          previous: Option.some(previous),
          renderNext: Effect.succeed(next),
          context,
          onCommit: (committed) => {
            currentOwner = committed;
          },
          releaseStagedScope: releaseNoStagedScope,
        }).pipe(Effect.forkChild);

        yield* Deferred.await(cleanupStarted);
        yield* Fiber.interrupt(transactionFiber);
        const transactionExit = yield* Fiber.await(transactionFiber);
        yield* Deferred.succeed(cleanupGate, undefined);

        assert.isTrue(Exit.hasInterrupts(transactionExit));
        assert.isTrue(Exit.hasDies(transactionExit));
        if (Exit.isFailure(transactionExit)) {
          assert.isTrue(
            transactionExit.cause.reasons.some(
              (reason) => Cause.isDieReason(reason) && reason.defect === cleanupDefect,
            ),
          );
        }
        assert.strictEqual(currentOwner, next);
        assert.strictEqual(parent.firstChild, nextNode);

        yield* RenderTransaction.cleanup(currentOwner);
        assert.strictEqual(nextCleanups, 1);
        assert.isNull(nextNode.parentNode);
      }),
  );
});
