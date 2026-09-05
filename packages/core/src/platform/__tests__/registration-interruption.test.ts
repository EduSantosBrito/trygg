import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { PlatformEventTarget, browser as eventTargetBrowser } from "../event-target.js";
import { Idle, browser as idleBrowser } from "../idle.js";
import { Observer, browser as observerBrowser } from "../observer.js";

describe("native registration ownership", () => {
  it.effect.each(["event", "idle", "intersection", "mutation"])(
    "should release a native %s registration when interruption arrives during acquisition",
    (kind) =>
      Effect.gen(function* () {
        // Scope: the native registration itself interrupts its currently acquiring fiber.
        // Assertion: interruption remains visible and each acquired resource releases exactly once.
        let acquired = 0;
        let released = 0;
        const restore: Array<() => void> = [];
        yield* Effect.gen(function* () {
          const attempt = yield* Effect.gen(function* () {
            const owner = yield* Effect.withFiber((fiber) => Effect.succeed(fiber));
            const interrupt = () => owner.interruptUnsafe(owner.id);
            if (kind === "event") {
              const target = new EventTarget();
              const register = target.addEventListener.bind(target);
              const unregister = target.removeEventListener.bind(target);
              const add = vi.spyOn(target, "addEventListener").mockImplementation((...args) => {
                register(...args);
                acquired++;
                interrupt();
              });
              const remove = vi
                .spyOn(target, "removeEventListener")
                .mockImplementation((...args) => {
                  unregister(...args);
                  released++;
                });
              restore.push(
                () => add.mockRestore(),
                () => remove.mockRestore(),
              );
              yield* Effect.flatMap(PlatformEventTarget, (events) =>
                events.on(target, "test", () => Effect.void),
              ).pipe(Effect.provide(eventTargetBrowser));
            } else if (kind === "idle") {
              vi.stubGlobal("requestIdleCallback", () => {
                acquired++;
                interrupt();
                return 1;
              });
              vi.stubGlobal("cancelIdleCallback", () => {
                released++;
              });
              yield* Effect.flatMap(Idle, (idle) => idle.request(() => Effect.void)).pipe(
                Effect.provide(idleBrowser),
              );
            } else {
              vi.stubGlobal(
                "IntersectionObserver",
                class {
                  constructor() {
                    acquired++;
                    interrupt();
                  }
                  disconnect() {
                    released++;
                  }
                },
              );
              vi.stubGlobal(
                "MutationObserver",
                class {
                  constructor() {
                    acquired++;
                  }
                  observe() {
                    interrupt();
                  }
                  disconnect() {
                    released++;
                  }
                },
              );
              yield* Effect.flatMap(Observer, (observers) =>
                kind === "intersection"
                  ? observers.intersection({ onIntersect: () => Effect.void }).pipe(Effect.asVoid)
                  : observers.mutation(
                      document.createElement("div"),
                      { childList: true },
                      () => Effect.void,
                    ),
              ).pipe(Effect.provide(observerBrowser));
            }
          }).pipe(Effect.scoped, Effect.forkChild);
          const exit = yield* Fiber.await(attempt);
          assert.isTrue(Exit.hasInterrupts(exit));
          assert.strictEqual(acquired, 1);
          assert.strictEqual(released, 1);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              for (const action of restore) action();
              vi.unstubAllGlobals();
            }),
          ),
        );
      }),
  );
});
