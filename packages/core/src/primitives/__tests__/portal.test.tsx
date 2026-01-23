/**
 * Portal Tests (Red/Green TDD)
 *
 * Portal.make wraps content into a ComponentType that renders
 * into a different DOM location (the target).
 *
 * API:
 *   yield* Portal.make(element)                        — dynamic (creates div on body)
 *   yield* Portal.make(element, { target: "#id" })     — targeted (CSS selector)
 *   yield* Portal.make(element, { target: node })      — targeted (HTMLElement)
 *
 * Returns: ComponentType<{ visible?: MaybeSignal<boolean> }>
 *
 * Behaviors:
 * - Content renders into the target, not in-place
 * - Dynamic portals create a container div on document.body
 * - Dynamic containers are removed on scope close
 * - visible prop controls mount/unmount (destroy DOM, not display:none)
 * - Signal<boolean> visible is reactive (mount/unmount on signal change)
 * - Signals inside portalled content work normally (full reactivity)
 * - CSS selector target that doesn't exist → PortalTargetNotFoundError
 * - Anchor comment left in original position
 * - Content cleanup runs on scope close
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Scope, TestClock } from "effect";
import * as Component from "../component.js";
import * as Signal from "../signal.js";
import { render } from "../../testing/index.js";
import * as Portal from "../portal.js";

// =============================================================================
// Helpers
// =============================================================================

/** Get all portal anchor comment nodes from a container */
function getPortalAnchors(container: Node): Comment[] {
  const anchors: Comment[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    if (node.textContent === "portal") anchors.push(node as Comment);
  }
  return anchors;
}

/** Get portal containers created dynamically on document.body */
function getPortalContainers(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>("[data-portal-container]"));
}

// =============================================================================
// Targeted Portals — HTMLElement
// =============================================================================

describe("Portal.make — targeted (HTMLElement)", () => {
  it.scoped("renders content into the target element", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(
          <span data-testid="portal-content">Hello from portal</span>,
          { target },
        );
        return <MyPortal />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      assert.isNotNull(
        target.querySelector("[data-testid='portal-content']"),
        `Content should render inside the target element. Target innerHTML: ${target.innerHTML}`,
      );

      target.remove();
    }),
  );

  it.scoped("content does NOT appear in the component's own DOM position", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="ported">Teleported</span>, {
          target,
        });
        return (
          <div data-testid="app-root">
            <MyPortal />
          </div>
        );
      });

      const { container } = yield* render(<App />);
      yield* TestClock.adjust(100);

      // Content should be in target, NOT in the component tree
      const appRoot = container.querySelector("[data-testid='app-root']");
      assert.isNotNull(appRoot, "App root should exist");
      assert.isNull(
        appRoot!.querySelector("[data-testid='ported']"),
        `Content should NOT be in the component tree. App innerHTML: ${appRoot!.innerHTML}`,
      );
      assert.isNotNull(
        target.querySelector("[data-testid='ported']"),
        `Content should be in the target. Target innerHTML: ${target.innerHTML}`,
      );

      target.remove();
    }),
  );

  it.scoped("renders multiple children into target", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(
          <div>
            <span data-testid="child-a">A</span>
            <span data-testid="child-b">B</span>
          </div>,
          { target },
        );
        return <MyPortal />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      assert.isNotNull(target.querySelector("[data-testid='child-a']"));
      assert.isNotNull(target.querySelector("[data-testid='child-b']"));

      target.remove();
    }),
  );
});

// =============================================================================
// Targeted Portals — CSS Selector
// =============================================================================

describe("Portal.make — targeted (CSS selector)", () => {
  it.scoped("resolves CSS selector and renders content into matching element", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      target.id = "portal-selector-target";
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(
          <span data-testid="selector-content">Via selector</span>,
          { target: "#portal-selector-target" },
        );
        return <MyPortal />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      assert.isNotNull(
        target.querySelector("[data-testid='selector-content']"),
        `Content should render into the element matching the selector. Target innerHTML: ${target.innerHTML}`,
      );

      target.remove();
    }),
  );

  it.scoped("fails with PortalTargetNotFoundError when selector matches nothing", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span>Ghost</span>, {
          target: "#non-existent-element",
        });
        return <MyPortal />;
      });

      const result = yield* render(<App />).pipe(Effect.either);

      assert.isTrue(result._tag === "Left", "Should fail when target selector matches no element");
    }),
  );
});

// =============================================================================
// Dynamic Portals (no target)
// =============================================================================

describe("Portal.make — dynamic (no target)", () => {
  it.scoped("creates a container div on document.body", () =>
    Effect.gen(function* () {
      const containersBefore = getPortalContainers().length;

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="dynamic-content">Dynamic</span>);
        return <MyPortal />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      const containersAfter = getPortalContainers();
      assert.strictEqual(
        containersAfter.length,
        containersBefore + 1,
        "Should create exactly one portal container on body",
      );

      // Content should be inside the new container
      const portalContainer = containersAfter[containersAfter.length - 1];
      assert.isNotNull(
        portalContainer!.querySelector("[data-testid='dynamic-content']"),
        `Content should render inside the dynamic container. Container innerHTML: ${portalContainer!.innerHTML}`,
      );
    }),
  );

  it.scoped("content does not appear in the component's own DOM position", () =>
    Effect.gen(function* () {
      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="dynamic-ported">Teleported</span>);
        return (
          <div data-testid="dynamic-app-root">
            <MyPortal />
          </div>
        );
      });

      const { container } = yield* render(<App />);
      yield* TestClock.adjust(100);

      const appRoot = container.querySelector("[data-testid='dynamic-app-root']");
      assert.isNull(
        appRoot!.querySelector("[data-testid='dynamic-ported']"),
        `Content should NOT be in the component tree.`,
      );
    }),
  );

  it.scoped("dynamic container is removed when scope closes", () =>
    Effect.gen(function* () {
      const containersBefore = getPortalContainers().length;
      const scope = yield* Scope.make();

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span>Scoped content</span>);
        return <MyPortal />;
      });

      yield* render(<App />).pipe(Scope.extend(scope));
      yield* TestClock.adjust(100);

      // Container should exist while scope is open
      assert.strictEqual(
        getPortalContainers().length,
        containersBefore + 1,
        "Container should exist while scope is open",
      );

      // Close scope → container should be removed
      yield* Scope.close(scope, Exit.void);

      assert.strictEqual(
        getPortalContainers().length,
        containersBefore,
        "Container should be removed after scope closes",
      );
    }),
  );
});

// =============================================================================
// Visibility Control
// =============================================================================

describe("Portal.make — visible prop", () => {
  it.scoped("content is mounted when visible is not provided (always visible)", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="always-visible">Always</span>, {
          target,
        });
        return <MyPortal />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      assert.isNotNull(
        target.querySelector("[data-testid='always-visible']"),
        `Content should be visible when visible prop is not provided.`,
      );

      target.remove();
    }),
  );

  it.scoped("content is mounted when visible is true (static boolean)", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="visible-true">Shown</span>, {
          target,
        });
        return <MyPortal visible={true} />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      assert.isNotNull(
        target.querySelector("[data-testid='visible-true']"),
        `Content should be mounted when visible=true.`,
      );

      target.remove();
    }),
  );

  it.scoped("content is NOT mounted when visible is false (static boolean)", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="visible-false">Hidden</span>, {
          target,
        });
        return <MyPortal visible={false} />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      assert.isNull(
        target.querySelector("[data-testid='visible-false']"),
        `Content should NOT be mounted when visible=false. Target innerHTML: ${target.innerHTML}`,
      );

      target.remove();
    }),
  );

  it.scoped("content mounts/unmounts reactively with Signal<boolean> visible", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const isOpen = Signal.unsafeMake(false);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="reactive-vis">Reactive</span>, {
          target,
        });
        return <MyPortal visible={isOpen} />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      // Initially hidden
      assert.isNull(
        target.querySelector("[data-testid='reactive-vis']"),
        `Content should be hidden initially (visible=false).`,
      );

      // Set visible to true → should mount
      yield* Signal.set(isOpen, true);
      yield* TestClock.adjust(100);

      assert.isNotNull(
        target.querySelector("[data-testid='reactive-vis']"),
        `Content should mount when visible signal becomes true. Target innerHTML: ${target.innerHTML}`,
      );

      // Set visible back to false → should unmount (destroy DOM)
      yield* Signal.set(isOpen, false);
      yield* TestClock.adjust(100);

      assert.isNull(
        target.querySelector("[data-testid='reactive-vis']"),
        `Content should unmount (DOM destroyed) when visible signal becomes false.`,
      );

      target.remove();
    }),
  );

  it.scoped("unmount destroys DOM (not display:none)", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const isOpen = Signal.unsafeMake(true);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="destroy-check">Check</span>, {
          target,
        });
        return <MyPortal visible={isOpen} />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      // Visible — content is in DOM
      const el = target.querySelector("[data-testid='destroy-check']");
      assert.isNotNull(el, "Content should be in DOM when visible");

      // Hide — DOM node should be completely removed, not just hidden
      yield* Signal.set(isOpen, false);
      yield* TestClock.adjust(100);

      assert.isNull(
        target.querySelector("[data-testid='destroy-check']"),
        "DOM node should be removed, not just hidden",
      );
      // Verify it's truly gone (not hidden via CSS)
      assert.strictEqual(
        target.children.length,
        0,
        `Target should have no children after unmount. Target innerHTML: ${target.innerHTML}`,
      );

      target.remove();
    }),
  );
});

// =============================================================================
// Reactivity Inside Portal
// =============================================================================

describe("Portal.make — reactivity inside portalled content", () => {
  it.scoped("Signal updates text content inside portal", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const message = Signal.unsafeMake("Initial");

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="reactive-text">{message}</span>, {
          target,
        });
        return <MyPortal />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      const el = target.querySelector("[data-testid='reactive-text']");
      assert.isNotNull(el, "Portal content should render");
      assert.include(el!.textContent, "Initial");

      // Update signal → text should change in portal
      yield* Signal.set(message, "Updated");
      yield* TestClock.adjust(100);

      assert.include(
        el!.textContent,
        "Updated",
        `Text should update reactively inside portal. Content: ${el!.textContent}`,
      );

      target.remove();
    }),
  );

  it.scoped("Component with signals inside portal works normally", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const Counter = Component.gen(function* () {
        const count = yield* Signal.make(0);
        return (
          <div data-testid="counter">
            <span data-testid="count-value">{count}</span>
            <button data-testid="increment" onClick={() => Signal.update(count, (n) => n + 1)} />
          </div>
        );
      });

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<Counter />, { target });
        return <MyPortal />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      const countEl = target.querySelector("[data-testid='count-value']");
      assert.isNotNull(countEl, "Counter should render in portal");
      assert.include(countEl!.textContent, "0");

      // Click increment button
      const btn = target.querySelector("[data-testid='increment']") as HTMLButtonElement;
      assert.isNotNull(btn, "Button should be in portal");
      btn.click();
      yield* TestClock.adjust(100);

      assert.include(
        countEl!.textContent,
        "1",
        `Counter should increment inside portal. Content: ${countEl!.textContent}`,
      );

      target.remove();
    }),
  );
});

// =============================================================================
// Anchor Comment
// =============================================================================

describe("Portal.make — anchor in original position", () => {
  it.scoped("leaves a comment node as anchor where the portal is placed in JSX", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span>Ported</span>, { target });
        return (
          <div data-testid="anchor-check">
            <span>Before</span>
            <MyPortal />
            <span>After</span>
          </div>
        );
      });

      const { container } = yield* render(<App />);
      yield* TestClock.adjust(100);

      const anchorParent = container.querySelector("[data-testid='anchor-check']");
      assert.isNotNull(anchorParent, "Anchor parent should exist");

      const anchors = getPortalAnchors(anchorParent!);
      assert.isTrue(
        anchors.length > 0,
        `Should have at least one portal anchor comment. innerHTML: ${anchorParent!.innerHTML}`,
      );

      target.remove();
    }),
  );
});

// =============================================================================
// Cleanup / Lifecycle
// =============================================================================

describe("Portal.make — cleanup", () => {
  it.scoped("content is removed from target when scope closes", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);
      const scope = yield* Scope.make();

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(
          <span data-testid="cleanup-content">Will be cleaned</span>,
          { target },
        );
        return <MyPortal />;
      });

      yield* render(<App />).pipe(Scope.extend(scope));
      yield* TestClock.adjust(100);

      assert.isNotNull(
        target.querySelector("[data-testid='cleanup-content']"),
        "Content should exist before cleanup",
      );

      yield* Scope.close(scope, Exit.void);

      assert.isNull(
        target.querySelector("[data-testid='cleanup-content']"),
        `Content should be removed from target after scope closes. Target innerHTML: ${target.innerHTML}`,
      );

      target.remove();
    }),
  );

  it.scoped("multiple portals to the same target all render correctly", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const PortalA = yield* Portal.make(<span data-testid="multi-a">A</span>, { target });
        const PortalB = yield* Portal.make(<span data-testid="multi-b">B</span>, { target });
        return (
          <div>
            <PortalA />
            <PortalB />
          </div>
        );
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      assert.isNotNull(
        target.querySelector("[data-testid='multi-a']"),
        "Portal A should render in target",
      );
      assert.isNotNull(
        target.querySelector("[data-testid='multi-b']"),
        "Portal B should render in target",
      );

      target.remove();
    }),
  );

  it.scoped("portal with visible signal cleans up on scope close", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);
      const scope = yield* Scope.make();
      const isOpen = Signal.unsafeMake(true);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span data-testid="sub-cleanup">Subscribed</span>, {
          target,
        });
        return <MyPortal visible={isOpen} />;
      });

      yield* render(<App />).pipe(Scope.extend(scope));
      yield* TestClock.adjust(100);

      assert.isNotNull(
        target.querySelector("[data-testid='sub-cleanup']"),
        "Content should render while scope is open",
      );

      yield* Scope.close(scope, Exit.void);

      // After scope close, content should be gone
      assert.isNull(
        target.querySelector("[data-testid='sub-cleanup']"),
        "Content should be gone after scope close",
      );

      target.remove();
    }),
  );
});

// =============================================================================
// Return type matches ComponentType
// =============================================================================

describe("Portal.make — return type", () => {
  it.scoped("returns a ComponentType (callable with _tag EffectComponent)", () =>
    Effect.gen(function* () {
      const target = document.createElement("div");
      document.body.appendChild(target);

      const App = Component.gen(function* () {
        const MyPortal = yield* Portal.make(<span>Type check</span>, { target });

        // Should have the EffectComponent tag
        assert.strictEqual(
          (MyPortal as unknown as { _tag: string })._tag,
          "EffectComponent",
          "Portal.make should return a ComponentType with _tag EffectComponent",
        );

        // Should be callable
        assert.strictEqual(
          typeof MyPortal,
          "function",
          "Portal.make should return a callable function",
        );

        return <MyPortal />;
      });

      yield* render(<App />);
      yield* TestClock.adjust(100);

      target.remove();
    }),
  );
});
