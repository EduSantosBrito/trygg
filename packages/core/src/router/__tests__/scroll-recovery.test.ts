import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { DomError } from "../../platform/dom.js";
import { ScrollError } from "../../platform/scroll.js";
import { StorageError } from "../../platform/storage.js";
import { ScrollStrategyType } from "../scroll-strategy.js";
import { applyScrollForNavigation } from "../service.js";

const auto = ScrollStrategyType.Auto();

const baseStorage = { get: () => Effect.succeed<string | null>(null) };
const baseDom = { getElementById: () => Effect.succeed<Element | null>(null) };
const baseScroll = {
  scrollIntoView: () => Effect.void,
  scrollTo: () => Effect.void,
};

describe("Router scroll recovery", () => {
  it.effect("recovers only typed DOM failures", () =>
    Effect.gen(function* () {
      // Scope: hash lookup is the DOM boundary used by production scroll application.
      // Assertion: typed failure is best-effort, while defect and interruption retain Cause.
      const options = {
        strategy: auto,
        intent: { navigationId: 1, isPopstate: false, hash: "#target", scrollKey: "nav-1" },
      };
      const failure = yield* applyScrollForNavigation(
        {
          storage: baseStorage,
          scroll: baseScroll,
          dom: {
            getElementById: () =>
              Effect.fail(new DomError({ operation: "getElementById", cause: "unavailable" })),
          },
        },
        options,
      );
      const defect = yield* Effect.exit(
        applyScrollForNavigation(
          {
            storage: baseStorage,
            scroll: baseScroll,
            dom: {
              // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately supplies the DOM Die branch of the recovery matrix.
              getElementById: () => Effect.die("DOM defect"),
            },
          },
          options,
        ),
      );
      const interrupted = yield* Effect.exit(
        applyScrollForNavigation(
          {
            storage: baseStorage,
            scroll: baseScroll,
            dom: { getElementById: () => Effect.interrupt },
          },
          options,
        ),
      );

      assert.strictEqual(failure.kind, "ignoredError");
      assert.isTrue(Exit.isFailure(defect));
      if (Exit.isFailure(defect)) assert.isTrue(Cause.hasDies(defect.cause));
      assert.isTrue(Exit.isFailure(interrupted));
      if (Exit.isFailure(interrupted)) assert.isTrue(Cause.hasInterrupts(interrupted.cause));
    }),
  );

  it.effect("recovers only typed storage failures", () =>
    Effect.gen(function* () {
      // Scope: popstate restoration reads the activation's history-entry storage key.
      // Assertion: typed failure is ignored, while defect and interruption are observable.
      const options = {
        strategy: auto,
        intent: { navigationId: 2, isPopstate: true, hash: "", scrollKey: "nav-2" },
      };
      const failure = yield* applyScrollForNavigation(
        {
          storage: {
            get: (key) =>
              Effect.fail(new StorageError({ operation: "get", key, cause: "unavailable" })),
          },
          scroll: baseScroll,
          dom: baseDom,
        },
        options,
      );
      const defect = yield* Effect.exit(
        applyScrollForNavigation(
          {
            storage: {
              // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately supplies the storage Die branch of the recovery matrix.
              get: () => Effect.die("storage defect"),
            },
            scroll: baseScroll,
            dom: baseDom,
          },
          options,
        ),
      );
      const interrupted = yield* Effect.exit(
        applyScrollForNavigation(
          {
            storage: { get: () => Effect.interrupt },
            scroll: baseScroll,
            dom: baseDom,
          },
          options,
        ),
      );

      assert.strictEqual(failure.kind, "ignoredError");
      assert.isTrue(Exit.isFailure(defect));
      if (Exit.isFailure(defect)) assert.isTrue(Cause.hasDies(defect.cause));
      assert.isTrue(Exit.isFailure(interrupted));
      if (Exit.isFailure(interrupted)) assert.isTrue(Cause.hasInterrupts(interrupted.cause));
    }),
  );

  it.effect("recovers only typed scroll failures", () =>
    Effect.gen(function* () {
      // Scope: new-route top scrolling is the Scroll adapter boundary.
      // Assertion: typed failure is ignored, while defect and interruption are observable.
      const options = {
        strategy: auto,
        intent: { navigationId: 3, isPopstate: false, hash: "", scrollKey: "nav-3" },
      };
      const failure = yield* applyScrollForNavigation(
        {
          storage: baseStorage,
          scroll: {
            scrollIntoView: () => Effect.void,
            scrollTo: () =>
              Effect.fail(new ScrollError({ operation: "scrollTo", cause: "unavailable" })),
          },
          dom: baseDom,
        },
        options,
      );
      const defect = yield* Effect.exit(
        applyScrollForNavigation(
          {
            storage: baseStorage,
            scroll: {
              scrollIntoView: () => Effect.void,
              // oxlint-disable-next-line effect/no-effect-escape-hatch -- Deliberately supplies the scroll Die branch of the recovery matrix.
              scrollTo: () => Effect.die("scroll defect"),
            },
            dom: baseDom,
          },
          options,
        ),
      );
      const interrupted = yield* Effect.exit(
        applyScrollForNavigation(
          {
            storage: baseStorage,
            scroll: { scrollIntoView: () => Effect.void, scrollTo: () => Effect.interrupt },
            dom: baseDom,
          },
          options,
        ),
      );

      assert.strictEqual(failure.kind, "ignoredError");
      assert.isTrue(Exit.isFailure(defect));
      if (Exit.isFailure(defect)) assert.isTrue(Cause.hasDies(defect.cause));
      assert.isTrue(Exit.isFailure(interrupted));
      if (Exit.isFailure(interrupted)) assert.isTrue(Cause.hasInterrupts(interrupted.cause));
    }),
  );

  it.effect("restores from the scroll key carried by the activation intent", () =>
    Effect.gen(function* () {
      let requestedKey = "";
      let restored = { x: 0, y: 0 };
      const payload = yield* applyScrollForNavigation(
        {
          storage: {
            get: (key) =>
              Effect.sync(() => {
                requestedKey = key;
                return '{"x":12,"y":34}';
              }),
          },
          scroll: {
            scrollIntoView: () => Effect.void,
            scrollTo: (x, y) =>
              Effect.sync(() => {
                restored = { x, y };
              }),
          },
          dom: baseDom,
        },
        {
          strategy: auto,
          intent: {
            navigationId: 4,
            isPopstate: true,
            hash: "",
            scrollKey: "history-entry-4",
          },
        },
      );

      assert.strictEqual(requestedKey, "trygg:scroll:history-entry-4");
      assert.deepStrictEqual(restored, { x: 12, y: 34 });
      assert.strictEqual(payload.kind, "restore");
      assert.strictEqual(payload.scrollKey, "history-entry-4");
    }),
  );
});
