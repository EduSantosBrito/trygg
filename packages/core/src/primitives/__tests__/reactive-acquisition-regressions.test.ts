import { assert, describe } from "@effect/vitest";
import { Effect } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import { cx } from "../cx.js";
import * as Signal from "../signal.js";

describe("reactive acquisition regressions", () => {
  scoped("should not let a second projection-time update overwrite derive with stale output", () =>
    Effect.gen(function* () {
      // Scope: performs one source update before subscription and another during handshake projection.
      // Assertion: the older outer projection cannot overwrite the listener's latest value.
      const source = yield* Signal.make(0);
      const services = yield* Effect.context<never>();
      let projections = 0;

      const derived = yield* Signal.derive(source, (value) => {
        projections += 1;
        if (projections === 1) {
          Effect.runSyncWith(services)(Signal.set(source, 1));
        } else if (projections === 2) {
          Effect.runSyncWith(services)(Signal.set(source, 2));
        }
        return value;
      });

      assert.strictEqual(yield* Signal.peek(source), 2);
      assert.strictEqual(yield* Signal.peek(derived), 2);
    }),
  );

  scoped(
    "should not let a second projection-time update overwrite deriveAll with stale output",
    () =>
      Effect.gen(function* () {
        // Scope: repeats the two-update acquisition race through the multi-source projection path.
        // Assertion: deriveAll publishes the source version observed after both updates.
        const left = yield* Signal.make(0);
        const right = yield* Signal.make("stable");
        const services = yield* Effect.context<never>();
        let projections = 0;

        const combined = yield* Signal.deriveAll([left, right], (leftValue, rightValue) => {
          projections += 1;
          if (projections === 1) {
            Effect.runSyncWith(services)(Signal.set(left, 1));
          } else if (projections === 2) {
            Effect.runSyncWith(services)(Signal.set(left, 2));
          }
          return `${leftValue}:${rightValue}`;
        });

        assert.strictEqual(yield* Signal.peek(left), 2);
        assert.strictEqual(yield* Signal.peek(combined), "2:stable");
      }),
  );

  scoped("should not let a second projection-time update overwrite cx with stale classes", () =>
    Effect.gen(function* () {
      // Scope: a hostile class-map getter updates the signal before and during acquisition handshake.
      // Assertion: cx returns the class computed from the second update, not the outer stale snapshot.
      const variant = yield* Signal.make("primary");
      const services = yield* Effect.context<never>();
      let projections = 0;
      const raceInput: Record<string, boolean | undefined> = {
        get trigger() {
          projections += 1;
          if (projections === 1) {
            Effect.runSyncWith(services)(Signal.set(variant, "secondary"));
          } else if (projections === 2) {
            Effect.runSyncWith(services)(Signal.set(variant, "tertiary"));
          }
          return false;
        },
      };

      const className = yield* cx("button", variant, raceInput);
      if (typeof className === "string") {
        return assert.fail("Expected cx with a signal input to return a Signal");
      }

      assert.strictEqual(yield* Signal.peek(variant), "tertiary");
      assert.strictEqual(yield* Signal.peek(className), "button tertiary");
    }),
  );

  scoped("should reconcile every deriveAll source changed before subscription", () =>
    Effect.gen(function* () {
      // Scope: forces both source writes through the initial projection-to-subscribe window.
      // Assertion: deriveAll returns the latest combined snapshot without another source event.
      const left = yield* Signal.make(1);
      const right = yield* Signal.make(2);
      const services = yield* Effect.context<never>();
      let firstProjection = true;

      const total = yield* Signal.deriveAll([left, right], (leftValue, rightValue) => {
        if (firstProjection) {
          firstProjection = false;
          Effect.runSyncWith(services)(
            Effect.all([Signal.set(left, 10), Signal.set(right, 20)], { discard: true }),
          );
        }
        return leftValue + rightValue;
      });

      assert.strictEqual(yield* Signal.peek(left), 10);
      assert.strictEqual(yield* Signal.peek(right), 20);
      assert.strictEqual(yield* Signal.peek(total), 30);
    }),
  );

  scoped("should reconcile a cx input changed before subscription", () =>
    Effect.gen(function* () {
      // Scope: mutates a signal while cx is computing its initial class snapshot.
      // Assertion: the returned signal already contains the post-mutation class value.
      const variant = yield* Signal.make("primary");
      const services = yield* Effect.context<never>();
      let changed = false;
      const raceInput: Record<string, boolean | undefined> = {
        get trigger() {
          if (!changed) {
            changed = true;
            Effect.runSyncWith(services)(Signal.set(variant, "secondary"));
          }
          return false;
        },
      };

      const className = yield* cx("button", variant, raceInput);
      if (typeof className === "string") {
        return assert.fail("Expected cx with a signal input to return a Signal");
      }

      assert.strictEqual(yield* Signal.peek(variant), "secondary");
      assert.strictEqual(yield* Signal.peek(className), "button secondary");
    }),
  );
});
