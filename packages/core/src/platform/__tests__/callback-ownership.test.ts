import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { PlatformEventTarget, browser as eventTargetBrowser } from "../event-target.js";
import { Idle, browser as idleBrowser } from "../idle.js";

describe("callback admission after scope closure", () => {
  it.effect("should reject a queued event callback while its registration scope is closed", () =>
    Effect.gen(function* () {
      // Scope: a host can retain a callback already queued before removeEventListener.
      // Assertion: invoking that retained callback cannot construct or run the user handler.
      const target = new EventTarget();
      const registrations = vi.spyOn(target, "addEventListener");
      const owner = yield* Scope.make();
      let constructed = 0;
      let executed = 0;
      yield* Effect.gen(function* () {
        const service = yield* PlatformEventTarget;
        yield* service
          .on(target, "click", () => {
            constructed++;
            return Effect.sync(() => {
              executed++;
            });
          })
          .pipe(Scope.provide(owner));
        const listener = registrations.mock.calls[0]?.[1];
        assert.isDefined(listener);
        yield* Scope.close(owner, Exit.void);
        yield* Effect.sync(() => {
          if (typeof listener === "function") listener.call(target, new Event("click"));
          else listener?.handleEvent(new Event("click"));
        });
        assert.strictEqual(constructed, 0);
        assert.strictEqual(executed, 0);
      }).pipe(Effect.ensuring(Effect.sync(() => registrations.mockRestore())));
    }).pipe(Effect.provide(eventTargetBrowser)),
  );

  it.effect("should reject a retained idle callback while cancellation has closed its owner", () =>
    Effect.gen(function* () {
      // Scope: browser cancellation can race a callback already retained by the host.
      // Assertion: no user callback is admitted after the structural owner has closed.
      let callback: IdleRequestCallback | undefined;
      vi.stubGlobal("requestIdleCallback", (next: IdleRequestCallback) => {
        callback = next;
        return 1;
      });
      vi.stubGlobal("cancelIdleCallback", () => {});
      let constructed = 0;
      yield* Effect.gen(function* () {
        const idle = yield* Idle;
        const owner = yield* Scope.make();
        yield* idle
          .request(() => {
            constructed++;
            return Effect.void;
          })
          .pipe(Scope.provide(owner));
        yield* Scope.close(owner, Exit.void);
        assert.isDefined(callback);
        yield* Effect.sync(() => callback?.({ didTimeout: false, timeRemaining: () => 0 }));
        assert.strictEqual(constructed, 0);
      }).pipe(
        Effect.provide(idleBrowser),
        Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())),
      );
    }),
  );
});
