// @vitest-environment happy-dom

import { Cause, Deferred, Effect, Exit, Fiber, Layer, Ref, Scope } from "effect";
import * as Logger from "effect/Logger";
import { assert, describe, it, vi } from "@effect/vitest";
import { Component, renderDocument, Signal } from "trygg";
import { click, testLayer } from "trygg/testing";
import {
  installCommandPaletteShortcut,
  subscribeCommandPaletteOpen,
  type ShortcutListenerHost,
} from "../../templates/incident/app/command-palette-lifecycle";
import Settings from "../../templates/incident/app/pages/settings";
import {
  AppTheme,
  ThemeBrowser,
  type AppThemeService,
  type ThemeBrowserHost,
} from "../../templates/incident/app/services/theme";

const makeBlockedCallback = Effect.fn("IncidentTemplateTest.makeBlockedCallback")(function* () {
  const started = yield* Deferred.make<void>();
  const finalizerStarted = yield* Deferred.make<void>();
  const allowFinalizer = yield* Deferred.make<void>();
  const starts = yield* Ref.make(0);
  const finalized = yield* Ref.make(false);

  const callback = Effect.acquireRelease(
    Ref.update(starts, (count) => count + 1).pipe(
      Effect.andThen(Deferred.succeed(started, undefined)),
    ),
    () =>
      Deferred.succeed(finalizerStarted, undefined).pipe(
        Effect.andThen(Deferred.await(allowFinalizer)),
        Effect.andThen(Ref.set(finalized, true)),
      ),
  ).pipe(Effect.andThen(Effect.never));

  return { allowFinalizer, callback, finalized, finalizerStarted, started, starts };
});

describe("incident template UI ownership", () => {
  for (const phase of ["construction", "execution"]) {
    it.effect(`should contain and report a shortcut ${phase} defect once`, () =>
      Effect.gen(function* () {
        // Scope: the exact layout shortcut bridge owns both thunk construction and Effect execution.
        // Assertion: native delivery succeeds and its one terminal defect reaches the configured logger.
        let listener: ((event: KeyboardEvent) => void) | undefined;
        const messages: Array<unknown> = [];
        const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
          if (logLevel === "Error") messages.push(message);
        });
        yield* Effect.gen(function* () {
          yield* installCommandPaletteShortcut(
            {
              addKeydownListener: (callback) => {
                listener = callback;
              },
              removeKeydownListener: () => {},
            },
            () => {
              if (phase === "construction") {
                // oxlint-disable-next-line effect/no-raw-throw -- Exercises containment of a host callback thunk defect.
                throw "shortcut-construction-defect";
              }
              return Effect.failCause(Cause.die("shortcut-execution-defect"));
            },
          );
          assert.isDefined(listener);
          const exit = yield* Effect.exit(
            Effect.sync(() =>
              listener?.(new KeyboardEvent("keydown", { ctrlKey: true, key: "k" })),
            ),
          );
          assert.isTrue(Exit.isSuccess(exit));
          yield* Effect.yieldNow;
          assert.strictEqual(messages.length, 1);
        }).pipe(Effect.provide(Logger.layer([logger])));
      }),
    );
  }

  it.effect(
    "should reject shortcut work when the native event closes its owner during dispatch",
    () =>
      Effect.gen(function* () {
        // Scope: preventDefault can reenter host lifecycle before the shortcut handler starts.
        // Assertion: closing the owner cannot be followed by newly constructed shortcut work.
        const scope = yield* Scope.make();
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
        let listener: ((event: KeyboardEvent) => void) | undefined;
        let constructed = 0;
        yield* installCommandPaletteShortcut(
          {
            addKeydownListener: (next) => {
              listener = next;
            },
            removeKeydownListener: () => {},
          },
          () => {
            constructed++;
            return Effect.void;
          },
        ).pipe(Scope.provide(scope));
        const event = new KeyboardEvent("keydown", { ctrlKey: true, key: "k" });
        const services = yield* Effect.context();
        let closing: Fiber.Fiber<void> | undefined;
        const prevent = vi.spyOn(event, "preventDefault").mockImplementation(() => {
          closing = Effect.runForkWith(services)(Scope.close(scope, Exit.void));
        });
        yield* Effect.sync(() => listener?.(event)).pipe(
          Effect.ensuring(Effect.sync(() => prevent.mockRestore())),
        );
        assert.isDefined(closing);
        if (closing !== undefined) yield* Fiber.join(closing);
        assert.strictEqual(constructed, 0);
      }),
  );

  it.effect(
    "should unsubscribe when interruption arrives during command-palette registration",
    () =>
      Effect.gen(function* () {
        // Scope: interrupt at the actual Signal listener insertion, before acquisition returns.
        // Assertion: the signal retains no subscription and the acquiring fiber stays interrupted.
        const open = yield* Signal.make(false);
        const add = open._listeners.add.bind(open._listeners);
        const registration = vi.spyOn(open._listeners, "add");
        let acquired = 0;
        yield* Effect.gen(function* () {
          const owner = yield* Effect.gen(function* () {
            const fiber = yield* Effect.withFiber((current) => Effect.succeed(current));
            registration.mockImplementation((listener) => {
              const result = add(listener);
              acquired++;
              fiber.interruptUnsafe(fiber.id);
              return result;
            });
            yield* subscribeCommandPaletteOpen(open, () => Effect.void);
          }).pipe(Effect.scoped, Effect.forkChild);
          const exit = yield* Fiber.await(owner);
          assert.isTrue(Exit.hasInterrupts(exit));
          assert.strictEqual(acquired, 1);
          assert.strictEqual(open._listeners.size, 0);
        }).pipe(Effect.ensuring(Effect.sync(() => registration.mockRestore())));
      }),
  );

  it.effect("should remove the layout shortcut and await blocked callback finalization", () =>
    Effect.gen(function* () {
      // Scope: exercises the exact shortcut lifecycle installed by the document layout.
      // Assertion: close removes the same listener, interrupts its callback, and waits for release.
      const listeners: Array<(event: KeyboardEvent) => void> = [];
      const removed: Array<(event: KeyboardEvent) => void> = [];
      const host: ShortcutListenerHost = {
        addKeydownListener: (listener) => listeners.push(listener),
        removeKeydownListener: (listener) => removed.push(listener),
      };
      const blocked = yield* makeBlockedCallback();
      const installed = yield* Deferred.make<void>();

      const owner = yield* Effect.scoped(
        installCommandPaletteShortcut(host, () => blocked.callback).pipe(
          Effect.andThen(Deferred.succeed(installed, undefined)),
          Effect.andThen(Effect.never),
        ),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(installed);
      const listener = listeners[0];
      assert.isDefined(listener);
      if (listener === undefined) return;

      listener(new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }));
      yield* Deferred.await(blocked.started);

      const closeFiber = yield* Fiber.interrupt(owner).pipe(Effect.forkChild);
      yield* Deferred.await(blocked.finalizerStarted);
      const removedBeforeRelease = [...removed];
      const closePending = closeFiber.pollUnsafe() === undefined;
      const finalizedBeforeRelease = yield* Ref.get(blocked.finalized);

      listener(new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }));
      yield* Effect.yieldNow;
      const startsWhileClosing = yield* Ref.get(blocked.starts);
      yield* Deferred.succeed(blocked.allowFinalizer, undefined);
      yield* Fiber.join(closeFiber);

      listener(new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }));
      yield* Effect.yieldNow;
      assert.deepEqual(removedBeforeRelease, [listener]);
      assert.isTrue(closePending);
      assert.isFalse(finalizedBeforeRelease);
      assert.strictEqual(startsWhileClosing, 1);
      assert.isTrue(yield* Ref.get(blocked.finalized));
      assert.strictEqual(yield* Ref.get(blocked.starts), 1);
    }),
  );

  it.effect(
    "should unsubscribe command-palette state and await blocked callback finalization",
    () =>
      Effect.gen(function* () {
        // Scope: exercises the exact Signal subscription lifecycle used by CommandPalette.
        // Assertion: closing removes future admission, interrupts in-flight work, and awaits its finalizer.
        const open = yield* Signal.make(false);
        const blocked = yield* makeBlockedCallback();
        const installed = yield* Deferred.make<void>();

        const owner = yield* Effect.scoped(
          subscribeCommandPaletteOpen(open, () => blocked.callback).pipe(
            Effect.andThen(Deferred.succeed(installed, undefined)),
            Effect.andThen(Effect.never),
          ),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(installed);
        assert.strictEqual(open._listeners.size, 1);
        yield* Signal.set(open, true);
        yield* Deferred.await(blocked.started);

        const closeFiber = yield* Fiber.interrupt(owner).pipe(Effect.forkChild);
        yield* Deferred.await(blocked.finalizerStarted);
        const closePending = closeFiber.pollUnsafe() === undefined;
        const finalizedBeforeRelease = yield* Ref.get(blocked.finalized);

        yield* Signal.set(open, false);
        yield* Effect.yieldNow;
        const startsWhileClosing = yield* Ref.get(blocked.starts);

        yield* Deferred.succeed(blocked.allowFinalizer, undefined);
        yield* Fiber.join(closeFiber);

        assert.strictEqual(open._listeners.size, 0);

        yield* Signal.set(open, true);
        yield* Effect.yieldNow;
        assert.isTrue(closePending);
        assert.isFalse(finalizedBeforeRelease);
        assert.strictEqual(startsWhileClosing, 1);
        assert.isTrue(yield* Ref.get(blocked.finalized));
        assert.strictEqual(yield* Ref.get(blocked.starts), 1);
      }),
  );

  it.effect("should let Settings update the one theme instance bound to root html", () =>
    Effect.gen(function* () {
      // Scope: renders the real Settings component through the route pass-through under a document root.
      // Assertion: Settings sees the exact root service; one acquisition updates the root html Signal.
      let acquisitions = 0;
      let added = 0;
      let removed = 0;
      let rootTheme: AppThemeService | undefined;
      let settingsTheme: AppThemeService | undefined;
      const settingsReady = yield* Deferred.make<void>();
      const host: ThemeBrowserHost = {
        readCookies: () => "",
        writeCookie: () => {},
        matchMedia: () => ({
          matches: true,
          addChangeListener: () => {
            added += 1;
          },
          removeChangeListener: () => {
            removed += 1;
          },
        }),
      };
      const baseThemeLayer = AppTheme.layer("dark").pipe(Layer.provide(ThemeBrowser.layer(host)));
      const themeLayer = Layer.effect(
        AppTheme,
        Effect.sync(() => {
          acquisitions += 1;
        }).pipe(Effect.andThen(AppTheme)),
      ).pipe(Layer.provide(baseThemeLayer));

      const SettingsRoute = Component.gen(function* () {
        settingsTheme = yield* AppTheme;
        yield* Deferred.succeed(settingsReady, undefined);
        return <Settings />;
      }).pipe(Component.provide(AppTheme.fromRoot));

      const Root = Component.gen(function* () {
        rootTheme = yield* AppTheme;
        return (
          <html lang="en" data-theme={rootTheme.mode}>
            <body>
              <SettingsRoute />
            </body>
          </html>
        );
      }).pipe(Component.provide(themeLayer));

      const owner = yield* Effect.scoped(renderDocument(Effect.succeed(<Root />))).pipe(
        Effect.provide(testLayer),
        Effect.forkChild,
      );
      yield* Effect.raceFirst(Deferred.await(settingsReady), Fiber.join(owner).pipe(Effect.asVoid));
      yield* Effect.yieldNow;

      assert.strictEqual(acquisitions, 1);
      assert.strictEqual(added, 1);
      assert.isDefined(rootTheme);
      assert.isDefined(settingsTheme);
      assert.strictEqual(settingsTheme, rootTheme);
      assert.strictEqual(document.documentElement.getAttribute("data-theme"), "dark");

      const light = document.querySelector<HTMLInputElement>('input[value="light"]');
      assert.instanceOf(light, HTMLInputElement);
      if (!(light instanceof HTMLInputElement)) return;
      yield* click(light);
      assert.strictEqual(document.documentElement.getAttribute("data-theme"), "light");
      if (rootTheme !== undefined) {
        assert.strictEqual(yield* Signal.peek(rootTheme.mode), "light");
      }

      yield* Fiber.interrupt(owner);
      assert.strictEqual(removed, 1);
    }),
  );
});
