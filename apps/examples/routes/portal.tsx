/**
 * Portal Example
 *
 * Demonstrates:
 * - Portal component for rendering outside the DOM hierarchy
 * - Modal dialogs that render to document body
 * - Tooltips that escape container overflow
 * - Signal-based open/close state
 */
import { Effect } from "effect";
import { Signal, Component, Portal } from "effect-ui";

// =============================================================================
// Modal Component
// =============================================================================

const Modal = Component.gen(function* () {
  const isOpen = yield* Signal.make(false);
  const isOpenValue = yield* Signal.get(isOpen);

  const open = () => Signal.set(isOpen, true);
  const close = () => Signal.set(isOpen, false);

  const handleBackdropClick = (e: Event) =>
    Effect.sync(() => {
      if (e.target === e.currentTarget) {
        return true;
      }
      return false;
    }).pipe(Effect.flatMap((shouldClose) => (shouldClose ? close() : Effect.void)));

  return (
    <div className="portal-demo-section">
      <h3>Modal Dialog</h3>
      <p>Modals render to #portal-root, escaping the component hierarchy.</p>

      <button className="primary" onClick={open}>
        Open Modal
      </button>

      {isOpenValue && (
        <Portal target="#portal-root">
          <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal-content">
              <h2>Modal Title</h2>
              <p>
                This modal is rendered via Portal to #portal-root, outside the normal component
                hierarchy. It can escape overflow:hidden containers and appear above all content.
              </p>
              <div className="modal-actions">
                <button onClick={close}>Cancel</button>
                <button className="primary" onClick={close}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
});

// =============================================================================
// Nested Modal Component
// =============================================================================

const NestedModal = Component.gen(function* () {
  const firstOpen = yield* Signal.make(false);
  const secondOpen = yield* Signal.make(false);
  const firstOpenValue = yield* Signal.get(firstOpen);
  const secondOpenValue = yield* Signal.get(secondOpen);

  return (
    <div className="portal-demo-section">
      <h3>Nested Modals</h3>
      <p>Portals can be nested - each renders to the same target but stacks correctly.</p>

      <button className="primary" onClick={() => Signal.set(firstOpen, true)}>
        Open First Modal
      </button>

      {firstOpenValue && (
        <Portal target="#portal-root">
          <div className="modal-backdrop" onClick={() => Signal.set(firstOpen, false)}>
            <div className="modal-content" onClick={(e: Event) => Effect.sync(() => e.stopPropagation())}>
              <h2>First Modal</h2>
              <p>This is the first modal. Click below to open another modal on top.</p>
              <div className="modal-actions">
                <button onClick={() => Signal.set(firstOpen, false)}>Close</button>
                <button className="primary" onClick={() => Signal.set(secondOpen, true)}>
                  Open Second Modal
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {secondOpenValue && (
        <Portal target="#portal-root">
          <div className="modal-backdrop modal-backdrop-nested" onClick={() => Signal.set(secondOpen, false)}>
            <div className="modal-content" onClick={(e: Event) => Effect.sync(() => e.stopPropagation())}>
              <h2>Second Modal</h2>
              <p>This modal stacks on top of the first one!</p>
              <div className="modal-actions">
                <button className="primary" onClick={() => Signal.set(secondOpen, false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
});

// =============================================================================
// Overflow Escape Demo
// =============================================================================

const OverflowEscape = Component.gen(function* () {
  const showTooltip = yield* Signal.make(false);
  const showTooltipValue = yield* Signal.get(showTooltip);

  return (
    <div className="portal-demo-section">
      <h3>Escaping Overflow</h3>
      <p>Portals escape overflow:hidden containers that would clip regular content.</p>

      <div className="overflow-container">
        <span>Container with overflow:hidden</span>
        <div className="tooltip-trigger-wrapper">
          <button
            className="tooltip-trigger"
            onMouseenter={() => Signal.set(showTooltip, true)}
            onMouseleave={() => Signal.set(showTooltip, false)}
          >
            Hover me
          </button>

          {showTooltipValue && (
            <Portal target="#portal-root">
              <div className="portal-tooltip">
                This tooltip renders via Portal and escapes the overflow:hidden container!
              </div>
            </Portal>
          )}
        </div>
      </div>

      <p className="note">
        Without Portal, the tooltip would be clipped by the container's overflow:hidden.
      </p>
    </div>
  );
});

// =============================================================================
// Main Portal Demo
// =============================================================================

const PortalDemo = Component.gen(function* () {
  return (
    <div className="example">
      <h2>Portal</h2>
      <p className="description">
        Render content outside the component's DOM hierarchy using Portal
      </p>

      <Modal />
      <NestedModal />
      <OverflowEscape />

      <div className="code-example">
        <h3>Portal Usage</h3>
        <pre>{`import { Portal } from "effect-ui"

// Render modal to a different DOM node
const Modal = Component.gen(function* () {
  const isOpen = yield* Signal.make(false)
  const isOpenValue = yield* Signal.get(isOpen)

  return (
    <>
      <button onClick={() => Signal.set(isOpen, true)}>
        Open Modal
      </button>

      {isOpenValue && (
        <Portal target="#portal-root">
          <div className="modal-backdrop">
            <div className="modal-content">
              <h2>Modal Title</h2>
              <button onClick={() => Signal.set(isOpen, false)}>
                Close
              </button>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
})`}</pre>
      </div>
    </div>
  );
});

export default PortalDemo;
