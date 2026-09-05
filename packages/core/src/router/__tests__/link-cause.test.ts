import { assert, describe } from "@effect/vitest";
import { Cause, Effect, Equal, Exit, Predicate } from "effect";
import { unsafeEraseR } from "../../internal/unsafe.js";
import { scoped } from "../../testing/effect-vitest.js";
import * as Trace from "../../trace/index.js";
import { Link } from "../link.js";
import * as Router from "../service.js";
import { NavigationError } from "../types.js";

const clickWithCause = Effect.fnUntraced(function* (cause: Cause.Cause<NavigationError>) {
  const router = yield* Router.get;
  const link = Link({ to: "/next", prefetch: false });
  assert.strictEqual(link._tag, "Component");
  if (!Predicate.isTagged(link, "Component")) return Exit.void;
  const anchor = yield* unsafeEraseR(link.run()).pipe(
    Effect.provideService(Router.Router, {
      ...router,
      navigate: () => Effect.failCause(cause),
    }),
  );
  assert.strictEqual(anchor._tag, "Intrinsic");
  if (!Predicate.isTagged(anchor, "Intrinsic")) return Exit.void;
  const onClick = anchor.props.onClick;
  assert.isDefined(onClick);
  if (onClick === undefined) return Exit.void;
  const event = new MouseEvent("click", { cancelable: true });
  const exit = yield* Effect.exit(unsafeEraseR(onClick(event)));
  assert.isTrue(event.defaultPrevented);
  return exit;
});

describe("Link navigation Cause policy", () => {
  scoped("should recover expected navigation failures while reporting the handled error", () =>
    Effect.gen(function* () {
      // Scope: the actual Link callback handles the Router port's typed failure.
      // Assertion: the click succeeds and emits the existing recovery diagnostic.
      const recorder = Trace.makeRecorder();
      const failure = new NavigationError({ operation: "navigate", cause: "offline" });
      const exit = yield* Trace.record(clickWithCause(Cause.fail(failure)), recorder);
      assert.isTrue(Exit.isSuccess(exit));
      assert.isTrue(recorder.records().some((record) => record.name === "effect.error.ignored"));
    }).pipe(Effect.provide(Router.testLayer())),
  );

  scoped("should preserve defect and interruption Causes while handling a link click", () =>
    Effect.gen(function* () {
      // Scope: callback recovery must not erase cancellation, bugs, or mixed failures.
      // Assertion: every terminal Cause survives exactly and is not reported as ignored.
      const failure = new NavigationError({ operation: "navigate", cause: "offline" });
      const causes = [
        Cause.die("navigation defect"),
        Cause.interrupt(42),
        Cause.combine(Cause.fail(failure), Cause.die("mixed defect")),
        Cause.combine(Cause.fail(failure), Cause.interrupt(43)),
      ];
      for (const cause of causes) {
        const recorder = Trace.makeRecorder();
        const exit = yield* Trace.record(clickWithCause(cause), recorder);
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.isTrue(Equal.equals(exit.cause, cause));
        assert.isFalse(recorder.records().some((record) => record.name === "effect.error.ignored"));
      }
    }).pipe(Effect.provide(Router.testLayer())),
  );
});
