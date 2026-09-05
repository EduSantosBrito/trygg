import { assert, describe } from "@effect/vitest";
import { Cause, Deferred, Effect, Equal, Exit, Schema, Scope } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { unsafeEraseR } from "../../internal/unsafe.js";
import * as Component from "../component.js";
import { Element } from "../element.js";
import * as Signal from "../signal.js";

class MixedSignalFailure extends Schema.TaggedError<MixedSignalFailure>()("MixedSignalFailure", {
  message: Schema.String,
}) {}

const text = (content: string): Element => Element.Text({ content });

const mockComponent = <E>(effect: Effect.Effect<Element, E>) =>
  Component.gen(function* () {
    return yield* effect;
  });

describe("signal Cause and worker regressions", () => {
  scoped("should recover only all-Fail listener Causes and preserve mixed Causes unchanged", () =>
    Effect.gen(function* () {
      // Scope: drives listener isolation through all-Fail, Fail+Die, and Fail+Interrupt Causes.
      // Assertion: only all-Fail succeeds; each mixed terminal Exit retains both original reasons.
      const allFailCause = Cause.combine(
        Cause.fail(new MixedSignalFailure({ message: "all-fail-a" })),
        Cause.fail(new MixedSignalFailure({ message: "all-fail-b" })),
      );
      const allFailSignal = yield* Signal.make(0);
      yield* Signal.subscribe(allFailSignal, () => Effect.failCause(allFailCause)).pipe(
        Effect.asVoid,
      );
      assert.isTrue(Exit.isSuccess(yield* Effect.exit(Signal.set(allFailSignal, 1))));

      const mixedDefectCause = Cause.combine(
        Cause.fail(new MixedSignalFailure({ message: "mixed-defect-fail" })),
        Cause.die("mixed-listener-defect"),
      );
      const mixedDefectSignal = yield* Signal.make(0);
      yield* Signal.subscribe(mixedDefectSignal, () => Effect.failCause(mixedDefectCause)).pipe(
        Effect.asVoid,
      );
      const mixedDefectExit = yield* Effect.exit(Signal.set(mixedDefectSignal, 1));
      assert.isTrue(Exit.isFailure(mixedDefectExit));
      if (Exit.isFailure(mixedDefectExit)) {
        assert.isTrue(Equal.equals(mixedDefectExit.cause, mixedDefectCause));
      }

      const mixedInterruptCause = Cause.combine(
        Cause.fail(new MixedSignalFailure({ message: "mixed-interrupt-fail" })),
        Cause.interrupt(52),
      );
      const mixedInterruptSignal = yield* Signal.make(0);
      yield* Signal.subscribe(mixedInterruptSignal, () =>
        Effect.failCause(mixedInterruptCause),
      ).pipe(Effect.asVoid);
      const mixedInterruptExit = yield* Effect.exit(Signal.set(mixedInterruptSignal, 1));
      assert.isTrue(Exit.isFailure(mixedInterruptExit));
      if (Exit.isFailure(mixedInterruptExit)) {
        assert.isTrue(Equal.equals(mixedInterruptExit.cause, mixedInterruptCause));
      }
    }),
  );

  scoped("should send every all-Fail suspend reason to fallback", () =>
    Effect.gen(function* () {
      // Scope: rebuilds suspend failure UI from a Cause containing two expected failures.
      // Assertion: fallback receives the complete Cause instead of one selected error.
      const expectedCause = Cause.combine(
        Cause.fail(new MixedSignalFailure({ message: "fallback-a" })),
        Cause.fail(new MixedSignalFailure({ message: "fallback-b" })),
      );
      const services = yield* Effect.context<never>();
      const fallbackReached = yield* Deferred.make<void>();
      const observedCauses: Array<Cause.Cause<unknown>> = [];
      const renderFailure = (cause: Cause.Cause<unknown>, _stale: Element | null): Element => {
        observedCauses.push(cause);
        Effect.runSyncWith(services)(
          Deferred.succeed(fallbackReached, undefined).pipe(Effect.asVoid),
        );
        return text("failed");
      };
      const suspended = yield* Signal.suspend(mockComponent(Effect.failCause(expectedCause))).pipe(
        Signal.on("Pending", text("loading")),
        Signal.on("Failure", renderFailure),
        Signal.exhaustive,
      );
      const element = suspended({});
      assert.strictEqual(element._tag, "Component");
      const owner = yield* Scope.make();
      yield* unsafeEraseR(element.run()).pipe(Scope.provide(owner));

      yield* Deferred.await(fallbackReached);
      const observedCause = observedCauses[0];
      assert.isDefined(observedCause);
      if (observedCause !== undefined) {
        assert.deepStrictEqual(
          observedCause.reasons
            .filter(Cause.isFailReason)
            .map((reason) =>
              reason.error instanceof MixedSignalFailure ? reason.error.message : null,
            ),
          ["fallback-a", "fallback-b"],
        );
      }
      yield* Scope.close(owner, Exit.void);
    }),
  );

  scoped("should report mixed terminal suspend Causes and ignore owner interruption", () =>
    Effect.gen(function* () {
      // Scope: observes completed worker fibers and then closes a separately blocked worker owner.
      // Assertion: mixed fatal Exits report both reasons; normal scope interruption reports nothing.
      const services = yield* Effect.context<never>();
      const reports: Array<Exit.Exit<unknown, unknown>> = [];
      let reportTarget: Deferred.Deferred<void> | null = null;
      const reporter: Signal.SignalWorkerExitReporter = (exit) => {
        reports.push(exit);
        if (reportTarget !== null) {
          Effect.runSyncWith(services)(
            Deferred.succeed(reportTarget, undefined).pipe(Effect.asVoid),
          );
        }
      };

      const runFatal = Effect.fnUntraced(function* (cause: Cause.Cause<MixedSignalFailure>) {
        const reported = yield* Deferred.make<void>();
        reportTarget = reported;
        let fallbackCalls = 0;
        const suspended = yield* Signal.suspend(mockComponent(Effect.failCause(cause))).pipe(
          Signal.on("Pending", text("loading")),
          Signal.on("Failure", () => {
            fallbackCalls += 1;
            return text("failed");
          }),
          Signal.exhaustive,
        );
        const element = suspended({});
        assert.strictEqual(element._tag, "Component");
        const owner = yield* Scope.make();
        yield* unsafeEraseR(element.run()).pipe(
          Scope.provide(owner),
          Effect.provideService(Signal.CurrentSignalWorkerExitReporter, reporter),
        );
        yield* Deferred.await(reported);
        yield* Scope.close(owner, Exit.void);
        reportTarget = null;
        return fallbackCalls;
      });

      const failDefect = Cause.combine(
        Cause.fail(new MixedSignalFailure({ message: "worker-fail-defect" })),
        Cause.die("worker-defect"),
      );
      assert.strictEqual(yield* runFatal(failDefect), 0);
      const defectExit = reports[0];
      assert.isDefined(defectExit);
      if (defectExit !== undefined && Exit.isFailure(defectExit)) {
        assert.deepStrictEqual(
          defectExit.cause.reasons.map((reason) => reason._tag),
          ["Fail", "Die"],
        );
      }

      const failInterrupt = Cause.combine(
        Cause.fail(new MixedSignalFailure({ message: "worker-fail-interrupt" })),
        Cause.interrupt(53),
      );
      assert.strictEqual(yield* runFatal(failInterrupt), 0);
      const interruptExit = reports[1];
      assert.isDefined(interruptExit);
      if (interruptExit !== undefined && Exit.isFailure(interruptExit)) {
        assert.deepStrictEqual(
          interruptExit.cause.reasons.map((reason) => reason._tag),
          ["Fail", "Interrupt"],
        );
      }

      const started = yield* Deferred.make<void>();
      const blocked = mockComponent(
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      );
      const suspended = yield* Signal.suspend(blocked).pipe(
        Signal.on("Pending", text("loading")),
        Signal.on("Failure", () => text("failed")),
        Signal.exhaustive,
      );
      const element = suspended({});
      assert.strictEqual(element._tag, "Component");
      const owner = yield* Scope.make();
      yield* unsafeEraseR(element.run()).pipe(
        Scope.provide(owner),
        Effect.provideService(Signal.CurrentSignalWorkerExitReporter, reporter),
      );
      yield* Deferred.await(started);
      yield* Scope.close(owner, Exit.void);

      assert.strictEqual(reports.length, 2);
    }),
  );

  scoped("should settle and report source interruption but suppress owner cancellation", () =>
    Effect.gen(function* () {
      // Scope: compares a source that self-interrupts with a blocked source cancelled by owner close.
      // Assertion: the actual self-interrupted worker Exit reports once and leaves Failure UI; owner cancellation reports nothing.
      const services = yield* Effect.context<never>();
      const reports: Array<Exit.Exit<unknown, unknown>> = [];
      const reported = yield* Deferred.make<void>();
      const reporter: Signal.SignalWorkerExitReporter = (exit) => {
        reports.push(exit);
        Effect.runSyncWith(services)(Deferred.succeed(reported, undefined).pipe(Effect.asVoid));
      };

      let interruptionFallbackCalls = 0;
      const interrupted = yield* Signal.suspend(mockComponent(Effect.interrupt)).pipe(
        Signal.on("Pending", text("loading")),
        Signal.on("Failure", (cause: Cause.Cause<unknown>) => {
          interruptionFallbackCalls += 1;
          assert.isTrue(Cause.hasInterruptsOnly(cause));
          return text("interrupted");
        }),
        Signal.exhaustive,
      );
      const interruptedElement = interrupted({});
      assert.strictEqual(interruptedElement._tag, "Component");
      const interruptedOwner = yield* Scope.make();
      const interruptedView = yield* unsafeEraseR(interruptedElement.run()).pipe(
        Scope.provide(interruptedOwner),
        Effect.provideService(Signal.CurrentSignalWorkerExitReporter, reporter),
      );

      yield* Deferred.await(reported);
      assert.strictEqual(reports.length, 1);
      const workerExit = reports[0];
      assert.isDefined(workerExit);
      if (workerExit !== undefined) assert.isTrue(Exit.hasInterrupts(workerExit));
      assert.strictEqual(interruptionFallbackCalls, 1);
      assert.isTrue(Element.$is("SignalElement")(interruptedView));
      if (Element.$is("SignalElement")(interruptedView)) {
        const settled = yield* Signal.peek(interruptedView.signal);
        assert.isTrue(Element.$is("Text")(settled));
        if (Element.$is("Text")(settled)) assert.strictEqual(settled.content, "interrupted");
      }
      yield* Scope.close(interruptedOwner, Exit.void);
      assert.strictEqual(reports.length, 1);

      const ownerCancelled = yield* Deferred.make<void>();
      let ownerFallbackCalls = 0;
      const blocked = mockComponent(
        Deferred.succeed(ownerCancelled, undefined).pipe(Effect.andThen(Effect.never)),
      );
      const suspended = yield* Signal.suspend(blocked).pipe(
        Signal.on("Pending", text("loading")),
        Signal.on("Failure", () => {
          ownerFallbackCalls += 1;
          return text("failed");
        }),
        Signal.exhaustive,
      );
      const element = suspended({});
      assert.strictEqual(element._tag, "Component");
      const owner = yield* Scope.make();
      yield* unsafeEraseR(element.run()).pipe(
        Scope.provide(owner),
        Effect.provideService(Signal.CurrentSignalWorkerExitReporter, reporter),
      );
      yield* Deferred.await(ownerCancelled);
      yield* Scope.close(owner, Exit.void);

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(ownerFallbackCalls, 0);
    }),
  );
});
