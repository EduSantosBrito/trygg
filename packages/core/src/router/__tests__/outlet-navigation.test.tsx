/**
 * Outlet Navigation Tests
 *
 * Tests the full render cycle when navigating between routes
 * that have loading boundaries (AsyncLoader + SignalElement path).
 *
 * Root cause of the bug:
 * The Outlet component reads `Signal.get(router.current)` in its body,
 * causing it to RE-RENDER on every route change. Each re-render creates
 * a NEW `signalElement(loader.view)`, which tears down and recreates the
 * SignalElement subscription. This creates a window where the Ready
 * notification from the AsyncLoader's forked fiber can be lost.
 *
 * The fix: The Outlet should NOT re-render on route changes. The
 * AsyncLoader's view signal + SignalElement handles transitions reactively.
 * The route reading should happen inside the AsyncLoader's tracking, not
 * in the component body.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, TestClock } from "effect";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
import * as Router from "../service.js";
import { Outlet } from "../outlet.js";
import { renderElement } from "../../testing/index.js";
import { browserLayer, Renderer } from "../../primitives/renderer.js";
import { componentElement, text, signalElement } from "../../primitives/element.js";
import { Element } from "../../index.js";
import * as Signal from "../../primitives/signal.js";
import { AsyncLoader } from "../outlet-services.js";
import type { RouteComponent } from "../types.js";

// =============================================================================
// Helpers
// =============================================================================

/** Create a RouteComponent that renders a div with data-testid */
const identifiableComp = (testId: string, content: string): RouteComponent =>
  Object.assign(
    () =>
      componentElement(() =>
        Effect.succeed(
          Element.Intrinsic({
            tag: "div",
            props: { "data-testid": testId },
            children: [text(content)],
            key: null,
          }),
        ),
      ),
    { _tag: "EffectComponent" as const },
  );

/** Create a loading RouteComponent */
const loadingComp = (): RouteComponent =>
  Object.assign(
    () =>
      componentElement(() =>
        Effect.succeed(
          Element.Intrinsic({
            tag: "div",
            props: { "data-testid": "loading" },
            children: [text("Loading...")],
            key: null,
          }),
        ),
      ),
    { _tag: "EffectComponent" as const },
  );

/** Custom test layer with specified initial path */
const testLayerAt = (path: string): Layer.Layer<Renderer | Router.Router> =>
  Layer.merge(browserLayer, Router.testLayer(path));

// =============================================================================
// AsyncLoader: stale read window proof
// =============================================================================

describe("AsyncLoader - view signal during track", () => {
  it.scoped("view signal is stale (Refreshing) immediately after track returns", () =>
    Effect.gen(function* () {
      // Proves the stale read window exists:
      // After track() sets Refreshing, the view signal returns the PREVIOUS
      // element. A new SignalElement created at this moment would show stale content.
      const loadingElement = text("Loading...");
      const scope = yield* Effect.scope;
      const loader = yield* AsyncLoader.make(loadingElement, scope);

      // Initial: track dashboard → Ready(Dashboard)
      yield* loader.track("dashboard", Effect.succeed(text("Dashboard")));
      yield* TestClock.adjust(10);

      // Track users — sets Refreshing(previous: Dashboard) synchronously
      yield* loader.track("users", Effect.succeed(text("Users")));

      // Peek synchronously (no yield = no scheduler opportunity for fiber B)
      const staleRead = Signal.peekSync(loader.view);

      // The view is stale — shows Dashboard (from Refreshing.previous)
      assert.strictEqual(staleRead._tag, "Text");
      if (staleRead._tag === "Text") {
        assert.strictEqual(
          staleRead.content,
          "Dashboard",
          "View should be stale (Dashboard from Refreshing) immediately after track",
        );
      }

      // After fiber B completes, view transitions to Ready(Users)
      yield* TestClock.adjust(10);
      const finalRead = yield* Signal.get(loader.view);
      assert.strictEqual(finalRead._tag, "Text");
      if (finalRead._tag === "Text") assert.strictEqual(finalRead.content, "Users");
    }),
  );

  it.scoped("SignalElement from stale view signal eventually shows correct value", () =>
    Effect.gen(function* () {
      // Even though the initial read is stale, the swap should fix it
      // (this passes in tests because the scheduler is favorable)
      const loadingElement = text("Loading...");
      const scope = yield* Effect.scope;
      const loader = yield* AsyncLoader.make(loadingElement, scope);

      yield* loader.track("dashboard", Effect.succeed(text("Dashboard")));
      yield* TestClock.adjust(10);

      // Set Refreshing → stale view
      yield* loader.track("users", Effect.succeed(text("Users")));

      // Render SignalElement from the stale view
      const element = signalElement(loader.view as Signal.Signal<Element>);
      const { container } = yield* renderElement(element);

      // Wait for fiber + swap
      yield* TestClock.adjust(100);

      assert.include(
        container.textContent,
        "Users",
        `Should show Users. DOM: ${container.innerHTML}`,
      );
      assert.notInclude(
        container.textContent,
        "Dashboard",
        `Should not show Dashboard. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/"))),
  );
});

// =============================================================================
// Root cause: Outlet component re-renders on route change
// =============================================================================

describe("Outlet - Component re-render on navigation (root cause)", () => {
  it.scoped("Outlet component body should run only ONCE (not re-render on route change)", () =>
    Effect.gen(function* () {
      // The real Outlet uses SubscriptionRef.get (not Signal.get) to read the
      // route, so it does NOT register router.current as a component dependency.
      // Route transitions are handled reactively via subscription + AsyncLoader.
      //
      // This test verifies: the Outlet's signalElement anchor remains the SAME
      // DOM node after navigation (proving the component body did not re-run
      // and create a fresh signalElement).
      const DashComp = identifiableComp("dashboard", "Dashboard Page");
      const UsersComp = identifiableComp("users", "Users Page");
      const LoadingComp = loadingComp();

      const manifest = Routes.make()
        .add(Route.make("/dashboard").component(DashComp).loading(LoadingComp))
        .add(Route.make("/users").component(UsersComp).loading(LoadingComp)).manifest;

      const outlet = Outlet({ routes: manifest });
      const { container } = yield* renderElement(outlet);
      yield* TestClock.adjust(100);

      // Verify initial state
      assert.isNotNull(
        container.querySelector("[data-testid='dashboard']"),
        `Dashboard should render initially. DOM: ${container.innerHTML}`,
      );

      // Capture signal-element anchors (comment nodes) BEFORE navigation
      const anchorsBefore = getSignalElementAnchors(container);
      assert.isTrue(anchorsBefore.length > 0, "Should have signal-element anchors");

      // Navigate to /users
      const router = yield* Router.Router;
      yield* router.navigate("/users");
      yield* TestClock.adjust(100);

      // Capture anchors AFTER navigation
      const anchorsAfter = getSignalElementAnchors(container);

      // If the component body re-ran, the old signalElement was torn down
      // and a new one created → different anchor nodes. Same nodes = no re-render.
      assert.strictEqual(
        anchorsBefore.length,
        anchorsAfter.length,
        `Anchor count should be stable (no re-render).`,
      );
      const sameAnchors = anchorsBefore.every((anchor, i) => anchor === anchorsAfter[i]);
      assert.isTrue(
        sameAnchors,
        `Outlet should NOT re-render on route change. ` +
          `The SignalElement anchor nodes should be the SAME DOM nodes after navigation.`,
      );

      // Also verify the content actually changed
      assert.isNotNull(
        container.querySelector("[data-testid='users']"),
        `Users should be visible after navigation. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/dashboard"))),
  );

  it.scoped("view signal subscription should not be torn down on navigation", () =>
    Effect.gen(function* () {
      // When the component re-renders, it returns a NEW signalElement(view).
      // The renderer tears down the OLD SignalElement (unsubscribes) and
      // sets up the NEW one (subscribes). This tear-down/re-subscribe is
      // the mechanism by which notifications can be lost.
      //
      // This test proves that the subscription is torn down and recreated
      // (which is the bug). After the fix, the subscription should persist.

      const DashComp = identifiableComp("dashboard", "Dashboard Page");
      const UsersComp = identifiableComp("users", "Users Page");
      const LoadingComp = loadingComp();

      const manifest = Routes.make()
        .add(Route.make("/dashboard").component(DashComp).loading(LoadingComp))
        .add(Route.make("/users").component(UsersComp).loading(LoadingComp)).manifest;

      const outlet = Outlet({ routes: manifest });
      const { container } = yield* renderElement(outlet);
      yield* TestClock.adjust(100);

      // Get current signal-element comment nodes and their identity
      const anchorsBefore = getSignalElementAnchors(container);
      assert.isTrue(anchorsBefore.length > 0, "Should have signal-element anchors");

      // Navigate
      const router = yield* Router.Router;
      yield* router.navigate("/users");
      yield* TestClock.adjust(100);

      // Check if the signal-element anchor is the SAME node (not recreated)
      const anchorsAfter = getSignalElementAnchors(container);

      // If the component re-rendered, the old anchor was removed and a new one
      // was created. The anchors should be the SAME DOM nodes if no re-render.
      const sameAnchors = anchorsBefore.every((anchor, i) => anchor === anchorsAfter[i]);
      assert.isTrue(
        sameAnchors,
        `Signal-element anchors should be the SAME DOM nodes after navigation ` +
          `(not torn down and recreated). This proves the component did not re-render.`,
      );
    }).pipe(Effect.provide(testLayerAt("/dashboard"))),
  );
});

// =============================================================================
// Full navigation (integration)
// =============================================================================

describe("Outlet - Navigation integration", () => {
  it.scoped("should show new route content after navigation", () =>
    Effect.gen(function* () {
      const DashComp = identifiableComp("dashboard", "Dashboard Page");
      const UsersComp = identifiableComp("users", "Users Page");
      const LoadingComp = loadingComp();

      const manifest = Routes.make()
        .add(Route.make("/dashboard").component(DashComp).loading(LoadingComp))
        .add(Route.make("/users").component(UsersComp).loading(LoadingComp)).manifest;

      const outlet = Outlet({ routes: manifest });
      const { container } = yield* renderElement(outlet);
      yield* TestClock.adjust(100);

      assert.isNotNull(
        container.querySelector("[data-testid='dashboard']"),
        `Dashboard should be visible initially. DOM: ${container.innerHTML}`,
      );

      const router = yield* Router.Router;
      yield* router.navigate("/users");
      yield* TestClock.adjust(100);

      assert.isNotNull(
        container.querySelector("[data-testid='users']"),
        `Users should be visible after navigation. DOM: ${container.innerHTML}`,
      );
      assert.isNull(
        container.querySelector("[data-testid='dashboard']"),
        `Dashboard should be gone after navigation. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/dashboard"))),
  );

  it.scoped("should show new route after navigating back and forth", () =>
    Effect.gen(function* () {
      const DashComp = identifiableComp("dashboard", "Dashboard Page");
      const UsersComp = identifiableComp("users", "Users Page");
      const LoadingComp = loadingComp();

      const manifest = Routes.make()
        .add(Route.make("/dashboard").component(DashComp).loading(LoadingComp))
        .add(Route.make("/users").component(UsersComp).loading(LoadingComp)).manifest;

      const outlet = Outlet({ routes: manifest });
      const { container } = yield* renderElement(outlet);
      yield* TestClock.adjust(100);

      const router = yield* Router.Router;
      yield* router.navigate("/users");
      yield* TestClock.adjust(100);

      assert.isNotNull(
        container.querySelector("[data-testid='users']"),
        `Users should be visible. DOM: ${container.innerHTML}`,
      );

      yield* router.navigate("/dashboard");
      yield* TestClock.adjust(100);

      assert.isNotNull(
        container.querySelector("[data-testid='dashboard']"),
        `Dashboard should be visible after navigating back. DOM: ${container.innerHTML}`,
      );
      assert.isNull(
        container.querySelector("[data-testid='users']"),
        `Users should be gone. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/dashboard"))),
  );
});

// =============================================================================
// Helpers
// =============================================================================

/** Get all signal-element comment nodes from a container */
function getSignalElementAnchors(container: HTMLElement): Comment[] {
  const anchors: Comment[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    if (node.textContent === "signal-element") anchors.push(node as Comment);
  }
  return anchors;
}
