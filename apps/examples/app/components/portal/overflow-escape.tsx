import { Effect, Fiber, Option, Ref } from "effect";
import { Signal, Component, Portal } from "trygg";

export const OverflowEscape = Component.gen(function* () {
  const showTooltip = yield* Signal.make(false);
  const hideFiber = yield* Ref.make<Option.Option<Fiber.Fiber<void>>>(Option.none());

  const show = () =>
    Effect.gen(function* () {
      const pending = yield* Ref.get(hideFiber);
      if (Option.isSome(pending)) {
        yield* Fiber.interrupt(pending.value);
      }
      yield* Ref.set(hideFiber, Option.none());
      yield* Signal.set(showTooltip, true);
    });

  const hide = () =>
    Effect.gen(function* () {
      const fiber = yield* Signal.set(showTooltip, false).pipe(
        Effect.delay("100 millis"),
        Effect.forkDaemon,
      );
      yield* Ref.set(hideFiber, Option.some(fiber));
    });

  const Tooltip = yield* Portal.make(
    <div
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 text-white py-3 px-4 rounded-md text-sm max-w-[300px] text-center z-[1000] shadow-[0_4px_12px_rgba(0,0,0,0.3)] animate-fadeIn"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      This tooltip renders via Portal and escapes the overflow:hidden container!
    </div>,
    { target: document.body },
  );

  return (
    <div>
      <h3>Escaping Overflow</h3>
      <p>Portals escape overflow:hidden containers that would clip regular content.</p>

      <div className="p-4 bg-gray-100 rounded-lg overflow-hidden relative mb-4">
        <span className="block text-xs text-gray-400 mb-3">Container with overflow:hidden</span>
        <div>
          <button
            className="cursor-pointer px-4 py-2 text-base border border-gray-300 rounded bg-white transition-colors hover:bg-gray-100"
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            Hover me
          </button>

          <Tooltip visible={showTooltip} />
        </div>
      </div>

      <p>Without Portal, the tooltip would be clipped by the container's overflow:hidden.</p>
    </div>
  );
});
