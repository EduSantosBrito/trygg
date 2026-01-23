import { Effect } from "effect";
import { Signal, Component, Portal } from "effect-ui";

export const NestedModal = Component.gen(function* () {
  const firstOpen = yield* Signal.make(false);
  const secondOpen = yield* Signal.make(false);

  const FirstModal = yield* Portal.make(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] animate-fadeIn"
      onClick={() => Signal.set(firstOpen, false)}
    >
      <div
        className="bg-white p-6 rounded-lg max-w-[400px] w-[90%] shadow-[0_4px_24px_rgba(0,0,0,0.2)] animate-slideIn"
        onClick={(e: Event) => Effect.sync(() => e.stopPropagation())}
      >
        <h2>First Modal</h2>
        <p>This is the first modal. Click below to open another modal on top.</p>
        <div className="flex gap-2 justify-end">
          <button
            className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
            onClick={() => Signal.set(firstOpen, false)}
          >
            Close
          </button>
          <button
            className="px-4 py-2 text-base border border-blue-600 rounded bg-blue-600 text-white cursor-pointer transition-colors hover:bg-blue-700"
            onClick={() => Signal.set(secondOpen, true)}
          >
            Open Second Modal
          </button>
        </div>
      </div>
    </div>,
    { target: document.body },
  );

  const SecondModal = yield* Portal.make(
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-[1001] animate-fadeIn"
      onClick={() => Signal.set(secondOpen, false)}
    >
      <div
        className="bg-white p-6 rounded-lg max-w-[400px] w-[90%] shadow-[0_4px_24px_rgba(0,0,0,0.2)] animate-slideIn"
        onClick={(e: Event) => Effect.sync(() => e.stopPropagation())}
      >
        <h2>Second Modal</h2>
        <p>This modal stacks on top of the first one!</p>
        <div className="flex gap-2 justify-end">
          <button
            className="px-4 py-2 text-base border border-blue-600 rounded bg-blue-600 text-white cursor-pointer transition-colors hover:bg-blue-700"
            onClick={() => Signal.set(secondOpen, false)}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    { target: document.body },
  );

  return (
    <div>
      <h3>Nested Modals</h3>
      <p>Portals can be nested - each renders to the same target but stacks correctly.</p>

      <button
        className="px-4 py-2 text-base border border-blue-600 rounded bg-blue-600 text-white cursor-pointer transition-colors hover:bg-blue-700"
        onClick={() => Signal.set(firstOpen, true)}
      >
        Open First Modal
      </button>

      <FirstModal visible={firstOpen} />
      <SecondModal visible={secondOpen} />
    </div>
  );
});
