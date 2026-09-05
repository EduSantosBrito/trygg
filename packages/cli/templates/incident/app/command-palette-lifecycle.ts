import { Cause, Effect, Predicate, Schema, Scope } from "effect";
import { Signal } from "trygg";

export class ShortcutListenerError extends Schema.TaggedError<ShortcutListenerError>()(
  "ShortcutListenerError",
  {
    operation: Schema.Union([
      Schema.Literal("register"),
      Schema.Literal("callback"),
      Schema.Literal("remove"),
    ]),
    cause: Schema.Unknown,
  },
) {}

export interface ShortcutListenerHost {
  readonly addKeydownListener: (listener: (event: KeyboardEvent) => void) => void;
  readonly removeKeydownListener: (listener: (event: KeyboardEvent) => void) => void;
}

const reportCallbackCause = (
  source: "keyboard shortcut" | "open-state subscription",
  cause: Cause.Cause<unknown>,
): Effect.Effect<void> =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.interrupt
    : Effect.logError(`Command palette ${source} failed`).pipe(
        Effect.annotateLogs("cause", Cause.pretty(cause)),
        Effect.asVoid,
      );

export const installCommandPaletteShortcut = Effect.fn("CommandPalette.installShortcut")(function* <
  R,
>(host: ShortcutListenerHost, onShortcut: () => Effect.Effect<void, unknown, R | Scope.Scope>) {
  const owner = yield* Effect.scope;
  const scope = yield* Scope.fork(owner);
  const services = yield* Effect.context<R>();
  // Native calls may reenter shutdown. Admit the child before its first
  // instruction, then restore captured services inside the owned fiber. The
  // child Scope is registered first so native listeners are removed before
  // shutdown waits for active callbacks to finalize.
  const runCallback = (effect: Effect.Effect<void, never, R>): void => {
    if (Predicate.isTagged(owner.state, "Closed")) return;
    Effect.runSyncWith(services)(Effect.forkIn(effect.pipe(Effect.provide(services)), scope));
  };

  yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const listener = (event: KeyboardEvent) => {
          runCallback(
            Effect.try({
              try: () => {
                const matches = (event.metaKey || event.ctrlKey) && event.key === "k";
                if (matches) {
                  event.preventDefault();
                }
                return matches;
              },
              catch: (cause) => new ShortcutListenerError({ operation: "callback", cause }),
            }).pipe(
              Effect.flatMap((matches) =>
                matches ? Effect.scoped(Effect.suspend(onShortcut)) : Effect.void,
              ),
              Effect.withSpan("CommandPalette.shortcutCallback"),
              Effect.catchCause((cause) => reportCallbackCause("keyboard shortcut", cause)),
            ),
          );
        };

        host.addKeydownListener(listener);
        return listener;
      },
      catch: (cause) => new ShortcutListenerError({ operation: "register", cause }),
    }),
    (listener) =>
      Effect.try({
        try: () => host.removeKeydownListener(listener),
        catch: (cause) => new ShortcutListenerError({ operation: "remove", cause }),
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Command palette shortcut cleanup failed").pipe(
            Effect.annotateLogs("error", error),
            Effect.asVoid,
          ),
        ),
      ),
  );
});

export const documentShortcutListenerHost: ShortcutListenerHost = {
  addKeydownListener: (listener) => document.addEventListener("keydown", listener),
  removeKeydownListener: (listener) => document.removeEventListener("keydown", listener),
};

export const subscribeCommandPaletteOpen = Effect.fn("CommandPalette.subscribeOpen")(function* <R>(
  open: Signal.Signal<boolean>,
  onChange: () => Effect.Effect<void, unknown, R | Scope.Scope>,
) {
  const owner = yield* Effect.scope;
  const scope = yield* Scope.fork(owner);
  const services = yield* Effect.context<R>();
  // Native calls may reenter shutdown. Admit the child before its first
  // instruction, then restore captured services inside the owned fiber. The
  // child Scope is registered first so native listeners are removed before
  // shutdown waits for active callbacks to finalize.
  const runCallback = (effect: Effect.Effect<void, never, R>): void => {
    if (Predicate.isTagged(owner.state, "Closed")) return;
    Effect.runSyncWith(services)(Effect.forkIn(effect.pipe(Effect.provide(services)), scope));
  };

  yield* Effect.acquireRelease(
    Signal.subscribe(open, () =>
      Effect.sync(() => {
        runCallback(
          Effect.scoped(Effect.suspend(onChange)).pipe(
            Effect.withSpan("CommandPalette.openStateCallback"),
            Effect.catchCause((cause) => reportCallbackCause("open-state subscription", cause)),
          ),
        );
      }),
    ),
    (unsubscribe) => unsubscribe,
  ).pipe(Effect.asVoid);
});
