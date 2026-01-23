import { Effect } from "effect";
import { Signal, Component, Portal } from "effect-ui";

export const Modal = Component.gen(function* () {
  const isOpen = yield* Signal.make(false);

  const open = () => Signal.set(isOpen, true);
  const close = () => Signal.set(isOpen, false);

  const handleBackdropClick = (e: Event) =>
    close().pipe(Effect.when(() => e.target === e.currentTarget));

  const PortalledModal = yield* Portal.make(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-1000 animate-fadeIn"
      onClick={handleBackdropClick}
    >
      <div className="bg-white p-6 rounded-lg max-w-100 w-[90%] shadow-[0_4px_24px_rgba(0,0,0,0.2)] animate-slideIn">
        <h2 className="m-0 mb-4 text-xl">Modal Title</h2>
        <p className="text-gray-500 m-0 mb-6 leading-relaxed">
          This modal is rendered via Portal to document.body, outside the normal component
          hierarchy. It can escape overflow:hidden containers and appear above all content.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            className="px-4 py-2 text-base border border-gray-300 rounded bg-white cursor-pointer transition-colors hover:bg-gray-100"
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="bg-blue-600 border-blue-600 text-white hover:bg-blue-700 px-4 py-2 text-base border rounded cursor-pointer transition-colors"
            onClick={close}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    { target: document.body },
  );

  return (
    <div>
      <h3>Modal Dialog</h3>
      <p>Modals render to document.body, escaping the component hierarchy.</p>

      <button
        className="bg-blue-600 border-blue-600 text-white hover:bg-blue-700 px-4 py-2 text-base border rounded cursor-pointer transition-colors"
        onClick={open}
      >
        Open Modal
      </button>

      <PortalledModal visible={isOpen} />
    </div>
  );
});
