import { assert, describe } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import { scoped } from "../../testing/effect-vitest.js";
import { unsafeEraseR, unsafeWidenContext } from "../../internal/unsafe.js";
import * as SafeUrl from "../../security/safe-url.js";
import { Element } from "../element.js";
import { runOwnedRenderFiber } from "../render-cleanup.js";
import { renderSignalElement } from "../render-signal-element.js";
import type { RenderContext, RenderResult } from "../renderer.js";
import * as Signal from "../signal.js";

class SignalElementSwapFailure extends Schema.TaggedError<SignalElementSwapFailure>()(
  "SignalElementSwapFailure",
  { mode: Schema.Literal("typed") },
) {}

const textResult = (content: string, parent: Node): RenderResult => {
  const node = document.createTextNode(content);
  parent.appendChild(node);
  return {
    node,
    cleanup: Effect.sync(() => node.remove()),
  };
};

type SwapMode = "typed" | "defect" | "interrupt";

describe("SignalElement RFC regressions", () => {
  scoped("should admit one worker and retain only the latest pending swap", () =>
    Effect.gen(function* () {
      // Scope: blocks the active swap while one thousand newer values arrive.
      // Assertion: one worker is admitted and only the blocked plus latest values render.
      const source = yield* Signal.make("initial");
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const committed = yield* Deferred.make<void>();
      const parent = document.createElement("div");
      const scope = yield* Effect.scope;
      const services = unsafeWidenContext(yield* Effect.context<never>());
      const renderContext: RenderContext = {
        services,
        scope,
        safeUrlConfig: SafeUrl.defaultConfig,
      };
      const renderedValues: Array<string> = [];
      let workerForks = 0;

      const result = yield* renderSignalElement(
        source,
        () => Deferred.succeed(committed, undefined).pipe(Effect.asVoid),
        parent,
        renderContext,
        null,
        { errorHandler: null },
        {
          renderElement: (element, target) =>
            Effect.gen(function* () {
              if (!Element.$is("Text")(element)) {
                // oxlint-disable-next-line effect/no-effect-escape-hatch -- Fail-loud test adapter for an impossible renderer input.
                return yield* Effect.die("Expected a Text element");
              }
              renderedValues.push(element.content);
              if (element.content === "blocked") {
                yield* Deferred.succeed(started, undefined).pipe(Effect.asVoid);
                yield* Deferred.await(release);
              }
              return textResult(element.content, target);
            }),
          runForkInRenderContext: <E, R>(
            effect: Effect.Effect<void, E, R>,
            currentRenderContext: RenderContext,
            _context: Context.Context<unknown> | null,
          ) => {
            workerForks += 1;
            runOwnedRenderFiber(
              unsafeEraseR(effect),
              currentRenderContext.services,
              currentRenderContext.scope,
            );
          },
        },
      );

      yield* Signal.set(source, "blocked");
      yield* Deferred.await(started);

      for (let index = 0; index < 1_000; index++) {
        yield* Signal.set(source, `latest-${index}`);
      }

      assert.strictEqual(workerForks, 1);
      yield* Deferred.succeed(release, undefined).pipe(Effect.asVoid);
      yield* Deferred.await(committed);

      assert.deepStrictEqual(renderedValues, ["initial", "blocked", "latest-999"]);
      assert.strictEqual(parent.textContent, "latest-999");
      assert.strictEqual(workerForks, 1);

      yield* result.cleanup;
    }),
  );

  scoped("should preserve typed, defect, and interruption swap Causes", () =>
    Effect.gen(function* () {
      // Scope: exercises the asynchronous SignalElement worker's terminal Cause policy.
      // Assertion: only typed failure reaches recovery; defect and interruption remain in Exit.
      const runCase = Effect.fnUntraced(function* (mode: SwapMode) {
        const source = yield* Signal.make("stable");
        const parent = document.createElement("div");
        const scope = yield* Effect.scope;
        const services = unsafeWidenContext(yield* Effect.context<never>());
        const renderContext: RenderContext = {
          services,
          scope,
          safeUrlConfig: SafeUrl.defaultConfig,
        };
        const reported: Array<Cause.Cause<unknown>> = [];
        const workerExits: Array<Exit.Exit<void, unknown>> = [];

        const result = yield* renderSignalElement(
          source,
          undefined,
          parent,
          renderContext,
          null,
          {
            errorHandler: (cause) => {
              reported.push(cause);
            },
          },
          {
            renderElement: (element, target) =>
              Effect.gen(function* () {
                if (!Element.$is("Text")(element)) {
                  // oxlint-disable-next-line effect/no-effect-escape-hatch -- Fail-loud test adapter for an impossible renderer input.
                  return yield* Effect.die("Expected a Text element");
                }
                if (element.content === "typed") {
                  return yield* new SignalElementSwapFailure({ mode: "typed" });
                }
                if (element.content === "defect") {
                  // oxlint-disable-next-line effect/no-effect-escape-hatch -- This branch deliberately supplies the Die case in the Cause matrix.
                  return yield* Effect.die("signal-element-defect");
                }
                if (element.content === "interrupt") {
                  return yield* Effect.interrupt;
                }
                return textResult(element.content, target);
              }),
            runForkInRenderContext: (effect, currentRenderContext) => {
              workerExits.push(
                Effect.runSyncExitWith(currentRenderContext.services)(
                  unsafeEraseR(effect.pipe(Scope.provide(currentRenderContext.scope))),
                ),
              );
            },
          },
        );

        yield* Signal.set(source, mode);
        assert.strictEqual(parent.textContent, "stable");
        yield* result.cleanup;
        return { reported, workerExits };
      });

      const typed = yield* runCase("typed");
      const defect = yield* runCase("defect");
      const interruption = yield* runCase("interrupt");

      assert.strictEqual(typed.reported.length, 1);
      const [typedCause] = typed.reported;
      assert.isDefined(typedCause);
      if (typedCause !== undefined) {
        assert.isTrue(Cause.hasFails(typedCause));
        assert.isFalse(Cause.hasDies(typedCause));
        assert.isFalse(Cause.hasInterrupts(typedCause));
        assert.instanceOf(Cause.squash(typedCause), SignalElementSwapFailure);
      }
      assert.strictEqual(typed.workerExits.length, 1);
      const [typedExit] = typed.workerExits;
      assert.isDefined(typedExit);
      if (typedExit !== undefined) assert.isTrue(Exit.isSuccess(typedExit));

      assert.strictEqual(defect.reported.length, 0);
      assert.strictEqual(defect.workerExits.length, 1);
      const [defectExit] = defect.workerExits;
      assert.isDefined(defectExit);
      if (defectExit !== undefined) assert.isTrue(Exit.hasDies(defectExit));

      assert.strictEqual(interruption.reported.length, 0);
      assert.strictEqual(interruption.workerExits.length, 1);
      const [interruptExit] = interruption.workerExits;
      assert.isDefined(interruptExit);
      if (interruptExit !== undefined) assert.isTrue(Exit.hasInterrupts(interruptExit));
    }),
  );
});
