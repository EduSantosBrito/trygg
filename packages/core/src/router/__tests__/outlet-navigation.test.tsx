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
import { scoped } from "../../testing/effect-vitest.js";
import { Deferred, Effect, Fiber, Layer, Ref, Schema, SubscriptionRef } from "effect";
import * as Context from "effect/Context";
import { TestClock } from "effect/testing";
import * as Components from "../../primitives/component.js";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
import * as Router from "../service.js";
import { Outlet } from "../outlet.js";
import { render, renderElement, type as typeInput } from "../../testing/index.js";
import { browserLayer, Renderer } from "../../primitives/renderer.js";
import { text, signalElement, type Element as ElementType } from "../../primitives/element.js";
import { Element } from "../../index.js";
import * as Signal from "../../primitives/signal.js";
import { AsyncLoader } from "../outlet-services.js";
import type { NavigationError, RouteComponent } from "../types.js";
import { unsafeEraseR } from "../../internal/unsafe.js";
import type { Layer as LayerType } from "effect/Layer";

// =============================================================================
// Helpers
// =============================================================================

/** Create a RouteComponent that renders a div with data-testid */
const routeElement = (testId: string, content: string): RouteComponent =>
  Effect.succeed(
    Element.Intrinsic({
      tag: "div",
      props: { "data-testid": testId },
      children: [text(content)],
      key: null,
    }),
  );

/** Create a RouteComponent that renders a div with data-testid */
const identifiableComp = (testId: string, content: string): RouteComponent =>
  routeElement(testId, content);

/** Create a loading RouteComponent */
const loadingComp = (): RouteComponent => routeElement("loading", "Loading...");

const requireInputElement = (element: globalThis.Element, testId: string): HTMLInputElement => {
  if (element instanceof HTMLInputElement) {
    return element;
  }
  return assert.fail(`Expected ${testId} to be an HTMLInputElement`);
};

/** Custom test layer with specified initial path */
const testLayerAt = (
  path: string,
): LayerType<Renderer | Router.Router, NavigationError | Signal.SignalScopeError> =>
  Layer.merge(browserLayer, Router.testLayer(path));

// =============================================================================
// AsyncLoader: stale read window proof
// =============================================================================

describe("AsyncLoader - view signal during track", () => {
  scoped("view signal shows loading fallback while refreshing a new route", () =>
    Effect.gen(function* () {
      const loadingElement = text("Loading...");
      const scope = yield* Effect.scope;
      const loader = yield* AsyncLoader.make(loadingElement, scope);

      // Initial: track dashboard → Ready(Dashboard)
      yield* loader.track("dashboard", Effect.succeed(text("Dashboard")));
      yield* TestClock.adjust(10);

      // Track users — sets Refreshing synchronously before Users is ready.
      yield* loader.track("users", Effect.never);

      const refreshingRead = yield* Signal.peek(loader.view);

      assert.isTrue(Element.$is("Text")(refreshingRead));
      if (Element.$is("Text")(refreshingRead)) {
        assert.strictEqual(
          refreshingRead.content,
          "Loading...",
          "View should show the loading fallback, not the previous route, while refreshing",
        );
      }
    }),
  );

  scoped("SignalElement from refreshing view signal eventually shows correct value", () =>
    Effect.gen(function* () {
      // The refreshing view may show a loading fallback before the route content
      // is ready, but the final ready update should still swap to Users.
      const loadingElement = text("Loading...");
      const scope = yield* Effect.scope;
      const loader = yield* AsyncLoader.make(loadingElement, scope);

      yield* loader.track("dashboard", Effect.succeed(text("Dashboard")));
      yield* TestClock.adjust(10);

      // Set Refreshing, then allow the next ready update to arrive.
      yield* loader.track("users", Effect.succeed(text("Users")));

      // Render SignalElement from the refreshing view.
      const element = signalElement(loader.view);
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

  scoped("drops stale uninterruptible loader results without blocking the latest route", () =>
    Effect.gen(function* () {
      // Test: should let a newer match proceed even when the previous load ignores interruption.
      // Scope: AsyncLoader publication boundary for shared loading components.
      // Assertion: the stale result never becomes the visible Ready element.
      const firstReady = yield* Deferred.make<ElementType>();
      const secondReady = yield* Deferred.make<ElementType>();
      const loadingElement = text("Loading...");
      const scope = yield* Effect.scope;
      const loader = yield* AsyncLoader.make(loadingElement, scope);

      yield* loader.track("first", Effect.uninterruptible(Deferred.await(firstReady)));
      yield* loader.track("second", Deferred.await(secondReady));

      yield* Deferred.succeed(firstReady, text("First"));
      yield* TestClock.adjust(20);
      const afterStale = yield* Signal.peek(loader.view);
      assert.isFalse(
        Element.$is("Text")(afterStale) && afterStale.content === "First",
        "Stale first loader result must not publish after a newer match starts",
      );

      yield* Deferred.succeed(secondReady, text("Second"));
      yield* TestClock.adjust(20);
      const finalView = yield* Signal.peek(loader.view);
      assert.isTrue(Element.$is("Text")(finalView));
      if (Element.$is("Text")(finalView)) {
        assert.strictEqual(finalView.content, "Second");
      }
    }),
  );
});

// =============================================================================
// Root cause: Outlet component re-renders on route change
// =============================================================================

describe("Outlet - provided route components", () => {
  scoped("preserves Component.provide layers while wrapping route fiber refs", () =>
    Effect.gen(function* () {
      class RouteTheme extends Context.Service<RouteTheme, { readonly label: string }>()(
        "test/RouteTheme",
      ) {}

      const ThemedPage = Components.gen(function* () {
        const theme = yield* RouteTheme;
        return <article data-testid="provided-route">{theme.label}</article>;
      }).pipe(Components.provide(Layer.succeed(RouteTheme, { label: "provided route" })));

      const manifest = Routes.make().add(Route.make("/provided").component(ThemedPage)).manifest;
      const outlet = Outlet({ routes: manifest });
      const { container } = yield* renderElement(outlet);

      yield* TestClock.adjust(100);

      assert.isNotNull(
        container.querySelector("[data-testid='provided-route']"),
        `Provided route should render with its layer. DOM: ${container.innerHTML}`,
      );
      assert.include(container.textContent, "provided route");
    }).pipe(Effect.provide(testLayerAt("/provided"))),
  );

  scoped("keeps provider-owned route signals out of route component hook slots", () =>
    Effect.gen(function* () {
      class RouteStore extends Context.Service<
        RouteStore,
        { readonly selected: Signal.Signal<string> }
      >()("test/RouteStore") {}

      const RouteStoreLive = Layer.effect(
        RouteStore,
        Effect.gen(function* () {
          const selected = yield* Signal.make("en");
          return { selected };
        }).pipe(Effect.annotateLogs({ service: "RouteStore" })),
      );

      const Page = Components.gen(function* () {
        const name = yield* Signal.make("World");
        const store = yield* RouteStore;
        const nameValue = yield* Signal.get(name);
        const selected = yield* Signal.get(store.selected);

        return (
          <div>
            <input
              data-testid="route-name"
              value={nameValue}
              onInput={(event) => {
                const target = event.target;
                return target instanceof HTMLInputElement
                  ? Signal.set(name, target.value)
                  : Effect.void;
              }}
            />
            <button data-testid="route-locale" onClick={() => Signal.set(store.selected, "es")}>
              Spanish
            </button>
            <span data-testid="route-greeting">
              {nameValue}:{selected}
            </span>
          </div>
        );
      }).pipe(Components.provide(RouteStoreLive));

      const manifest = Routes.make().add(Route.make("/provided-state").component(Page)).manifest;
      const { getByTestId } = yield* renderElement(<Outlet routes={manifest} />);
      yield* TestClock.adjust(100);
      assert.strictEqual((yield* getByTestId("route-greeting")).textContent, "World:en");

      const routeNameInput = requireInputElement(yield* getByTestId("route-name"), "route-name");
      yield* typeInput(routeNameInput, "Trygg");
      yield* TestClock.adjust(100);
      assert.strictEqual((yield* getByTestId("route-greeting")).textContent, "Trygg:en");

      (yield* getByTestId("route-locale")).click();
      yield* TestClock.adjust(100);
      assert.strictEqual((yield* getByTestId("route-greeting")).textContent, "Trygg:es");
    }).pipe(Effect.provide(testLayerAt("/provided-state"))),
  );
});

// =============================================================================
// Root cause: Outlet component re-renders on route change
// =============================================================================

describe("Outlet - Component re-render on navigation (root cause)", () => {
  scoped("should apply scroll once after fast ready navigation behind a loading boundary", () =>
    Effect.gen(function* () {
      // Test: should apply scroll once after fast ready navigation behind a loading boundary.
      // Scope: regression for the deferred-scroll window where AsyncLoader can reach Ready before Outlet finishes post-track handling.
      // Assertion: navigating to a loading-boundary route with synchronous content still increments outlet scroll exactly once.
      const DashComp = identifiableComp("dashboard", "Dashboard Page");
      const UsersComp = identifiableComp("users", "Users Page");
      const LoadingComp = loadingComp();

      const manifest = Routes.make()
        .add(Route.make("/dashboard").component(DashComp).loading(LoadingComp))
        .add(Route.make("/users").component(UsersComp).loading(LoadingComp)).manifest;

      const baseRouter = yield* Router.Router;
      const scrollCalls = yield* Ref.make(0);
      const wrappedRouter = Router.Router.of({
        ...baseRouter,
        outletCoordination: {
          ...baseRouter.outletCoordination,
          applyScroll: (options) =>
            Ref.update(scrollCalls, (count) => count + 1).pipe(
              Effect.flatMap(() => baseRouter.outletCoordination.applyScroll(options)),
            ),
        },
      });

      const outlet = Outlet({ routes: manifest });
      yield* renderElement(outlet).pipe(Effect.provideService(Router.Router, wrappedRouter));
      yield* TestClock.adjust(100);

      const beforeNavigate = yield* Ref.get(scrollCalls);

      yield* wrappedRouter.navigate("/users");
      yield* TestClock.adjust(100);

      const afterNavigate = yield* Ref.get(scrollCalls);
      assert.strictEqual(
        afterNavigate,
        beforeNavigate + 1,
        `Expected one scroll application after navigation but saw ${afterNavigate - beforeNavigate}`,
      );
    }).pipe(Effect.provide(testLayerAt("/dashboard"))),
  );

  scoped("Outlet component body should run only ONCE (not re-render on route change)", () =>
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

  scoped("view signal subscription should not be torn down on navigation", () =>
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

describe("Outlet - stable identity", () => {
  it.effect("returns a stable runtime wrapper with identity metadata", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const manifest = Routes.make().add(
          Route.make("/").component(Effect.succeed(text("Home"))),
        ).manifest;
        const outlet = Outlet({ routes: manifest });

        assert.isTrue(Element.$is("Component")(outlet));

        const runtime = yield* outlet.run();

        if (!Element.$is("Component")(runtime)) {
          assert.fail("Expected Outlet runtime to return a component wrapper");
        }

        assert.isDefined(runtime.identity);
        assert.deepStrictEqual(runtime.inputs, { routes: manifest });
      }),
    ),
  );

  scoped("preserves route child DOM and local state on child-local signal updates", () =>
    Effect.gen(function* () {
      let cleanupCount = 0;
      let noteSignal: Signal.Signal<string> | null = null;

      const IdentityLayout = Components.gen(function* () {
        return <Outlet />;
      });

      const IdentityChild = Components.gen(function* () {
        const note = yield* Signal.make("hello");
        noteSignal = note;

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            cleanupCount++;
          }),
        );

        const value = yield* Signal.get(note);
        return <input data-testid="route-note" value={value} />;
      });

      const manifest = Routes.make().add(
        Route.make("/").layout(IdentityLayout).children(Route.index(IdentityChild)),
      ).manifest;

      const { getByTestId } = yield* render(<Outlet routes={manifest} />).pipe(
        Effect.provide(testLayerAt("/")),
      );

      const signalBefore = noteSignal;
      if (signalBefore === null) {
        return assert.fail("Expected route note signal to be initialized");
      }

      const inputBefore = requireInputElement(yield* getByTestId("route-note"), "route-note");
      assert.strictEqual(inputBefore.value, "hello");

      yield* Signal.set(signalBefore, "hello world");
      yield* TestClock.adjust(20);

      const inputAfter = requireInputElement(yield* getByTestId("route-note"), "route-note");

      assert.strictEqual(cleanupCount, 0);
      assert.strictEqual(inputAfter, inputBefore);
      assert.strictEqual(inputAfter.value, "hello world");
    }).pipe(Effect.provide(testLayerAt("/"))),
  );
});

// =============================================================================
// Full navigation (integration)
// =============================================================================

describe("Outlet - Navigation integration", () => {
  scoped("should render lazy nested layout child once", () =>
    Effect.gen(function* () {
      const Layout = Components.gen(function* () {
        return (
          <div>
            <h2>Settings</h2>
            <Outlet />
          </div>
        );
      });

      const Overview = Components.gen(function* () {
        return <h1>Overview</h1>;
      });

      const routes = Routes.make().add(
        Route.make("/settings")
          .layout(() => Promise.resolve({ default: Layout }))
          .children(Route.index(() => Promise.resolve({ default: Overview }))),
      );

      const { container } = yield* render(<Outlet routes={routes.manifest} />).pipe(
        Effect.provide(Router.testLayer("/settings")),
      );

      yield* TestClock.adjust(10);

      assert.include(container.textContent ?? "", "Overview");
      assert.strictEqual(container.querySelectorAll("h2").length, 1);
      assert.strictEqual(container.querySelectorAll("h1").length, 1);
    }),
  );

  scoped("should show loading fallback, not previous route, while next route is pending", () =>
    Effect.gen(function* () {
      const usersReady = yield* Deferred.make<void>();
      const DashComp = identifiableComp("dashboard", "Dashboard Page");
      const UsersComp: RouteComponent = Deferred.await(usersReady).pipe(
        Effect.as(
          Element.Intrinsic({
            tag: "div",
            props: { "data-testid": "users" },
            children: [text("Users Page")],
            key: null,
          }),
        ),
      );
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
      yield* TestClock.adjust(20);

      assert.isNotNull(
        container.querySelector("[data-testid='loading']"),
        `Loading fallback should be visible while /users is pending. DOM: ${container.innerHTML}`,
      );
      assert.isNull(
        container.querySelector("[data-testid='dashboard']"),
        `Dashboard should not remain visible while /users is pending. DOM: ${container.innerHTML}`,
      );
      assert.isNull(
        container.querySelector("[data-testid='users']"),
        `Users should not be visible until its route effect completes. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/dashboard"))),
  );

  scoped("uses the nearest loading boundary for each route", () =>
    Effect.gen(function* () {
      const firstReady = yield* Deferred.make<void>();
      const secondReady = yield* Deferred.make<void>();
      const context = yield* Effect.context<never>();

      const FirstPage = identifiableComp("first-page", "First Page");
      const SecondPage = identifiableComp("second-page", "Second Page");
      const LoadingA = identifiableComp("loading-a", "Loading A");
      const LoadingB = identifiableComp("loading-b", "Loading B");

      const LazyFirst = () =>
        Effect.runPromiseWith(context)(
          Deferred.await(firstReady).pipe(Effect.as({ default: FirstPage })),
        );
      const LazySecond = () =>
        Effect.runPromiseWith(context)(
          Deferred.await(secondReady).pipe(Effect.as({ default: SecondPage })),
        );

      const manifest = Routes.make()
        .add(Route.make("/first").component(LazyFirst).loading(LoadingA))
        .add(Route.make("/second").component(LazySecond).loading(LoadingB)).manifest;

      const { container } = yield* render(<Outlet routes={manifest} />);
      yield* TestClock.adjust(20);

      assert.isNotNull(
        container.querySelector("[data-testid='loading-a']"),
        `First route should use Loading A. DOM: ${container.innerHTML}`,
      );

      const router = yield* Router.Router;
      yield* router.navigate("/second");
      yield* TestClock.adjust(20);

      assert.isNotNull(
        container.querySelector("[data-testid='loading-b']"),
        `Second route should use Loading B, not the previous loader. DOM: ${container.innerHTML}`,
      );
      assert.isNull(
        container.querySelector("[data-testid='loading-a']"),
        `Previous loading boundary should not remain active. DOM: ${container.innerHTML}`,
      );

      yield* Deferred.succeed(firstReady, undefined);
      yield* TestClock.adjust(50);
      assert.isNull(
        container.querySelector("[data-testid='first-page']"),
        `Resolving the stale first loader must not overwrite the active route. DOM: ${container.innerHTML}`,
      );

      yield* Deferred.succeed(secondReady, undefined);
      yield* TestClock.adjust(100);
      assert.isNotNull(
        container.querySelector("[data-testid='second-page']"),
        `Second page should render after its loader resolves. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/first"))),
  );

  scoped(
    "should not let a stale route rerender overwrite shared route chrome while the next route is pending",
    () =>
      Effect.gen(function* () {
        const headings = yield* Signal.make<ReadonlyArray<string>>([]);
        const oldRouteTick = yield* Signal.make(0);
        const newRouteReady = yield* Deferred.make<void>();
        const flushDom = TestClock.adjust(10);
        const staleRouteRenders: Array<string> = [];

        const currentPathSnapshot = Effect.gen(function* () {
          const router = yield* Router.Router;
          const route = yield* SubscriptionRef.get(router.current._ref);
          return route.path;
        });

        const DocsLikeLayout = Components.gen(function* () {
          const route = yield* Router.currentRoute;

          return (
            <section data-testid="docs-layout" data-path={route.path}>
              <main>
                <Outlet />
              </main>
              <aside data-testid="docs-rail">
                {Signal.each(headings, (heading) => Effect.succeed(<span>{heading}</span>), {
                  key: (heading) => heading,
                })}
              </aside>
            </section>
          );
        });

        const GettingStarted = Components.gen(function* () {
          yield* Signal.get(oldRouteTick);
          const path = yield* currentPathSnapshot;
          if (path !== "/docs/getting-started") {
            staleRouteRenders.push(`getting-started rendered while current=${path}`);
          }
          yield* Signal.set(headings, ["getting-started"]);
          return <article data-testid="getting-started">Getting started</article>;
        });

        const ComponentsPage = Components.gen(function* () {
          yield* Signal.set(headings, ["components"]);
          yield* Deferred.await(newRouteReady);
          return <article data-testid="components">Components</article>;
        });

        const manifest = Routes.make().add(
          Route.make("/docs")
            .layout(DocsLikeLayout)
            .children(
              Route.make("/getting-started").component(GettingStarted),
              Route.make("/components").component(ComponentsPage),
            ),
        ).manifest;

        const { container } = yield* render(<Outlet routes={manifest} />);
        yield* TestClock.adjust(100);

        assert.isNotNull(
          container.querySelector("[data-testid='getting-started']"),
          `Getting started should render initially. DOM: ${container.innerHTML}`,
        );

        const router = yield* Router.Router;
        yield* router.navigate("/docs/components");
        yield* flushDom;

        yield* Signal.update(oldRouteTick, (n) => n + 1);
        yield* TestClock.adjust(20);

        yield* Deferred.succeed(newRouteReady, undefined);
        yield* TestClock.adjust(100);

        assert.isNotNull(
          container.querySelector("[data-testid='components']"),
          `Components should be visible after resolving. DOM: ${container.innerHTML}`,
        );
        assert.isNull(
          container.querySelector("[data-testid='getting-started']"),
          `Getting started should be gone after resolving. DOM: ${container.innerHTML}`,
        );
        assert.deepStrictEqual(
          yield* Signal.peek(headings),
          ["components"],
          "Stale route work must not overwrite route-owned docs chrome after newer navigation wins",
        );
        assert.deepStrictEqual(staleRouteRenders, []);
      }).pipe(Effect.provide(testLayerAt("/docs/getting-started"))),
  );

  scoped("gates components emitted later by a route-owned SignalElement", () =>
    Effect.gen(function* () {
      const headings = yield* Signal.make<ReadonlyArray<string>>([]);
      const oldView = yield* Signal.make<ElementType>(
        <article data-testid="getting-started">Getting started</article>,
      );
      const newRouteReady = yield* Deferred.make<void>();
      const staleSignalRenders: Array<string> = [];

      const currentPathSnapshot = Effect.gen(function* () {
        const router = yield* Router.Router;
        const route = yield* SubscriptionRef.get(router.current._ref);
        return route.path;
      });

      const DocsLikeLayout = Components.gen(function* () {
        return (
          <section data-testid="docs-layout">
            <main>
              <Outlet />
            </main>
            <aside data-testid="docs-rail">
              {Signal.each(headings, (heading) => Effect.succeed(<span>{heading}</span>), {
                key: (heading) => heading,
              })}
            </aside>
          </section>
        );
      });

      const StaleSignalChild = Components.gen(function* () {
        const path = yield* currentPathSnapshot;
        staleSignalRenders.push(`signal child rendered while current=${path}`);
        yield* Signal.set(headings, ["stale"]);
        return <article data-testid="stale-signal-child">Stale signal child</article>;
      });

      const GettingStarted = Components.gen(function* () {
        yield* Signal.set(headings, ["getting-started"]);
        return <>{signalElement(oldView)}</>;
      });

      const ComponentsPage = Components.gen(function* () {
        yield* Signal.set(headings, ["components"]);
        yield* Deferred.await(newRouteReady);
        return <article data-testid="components">Components</article>;
      });

      const manifest = Routes.make().add(
        Route.make("/docs")
          .layout(DocsLikeLayout)
          .children(
            Route.make("/getting-started").component(GettingStarted),
            Route.make("/components").component(ComponentsPage),
          ),
      ).manifest;

      const { container } = yield* render(<Outlet routes={manifest} />);
      yield* TestClock.adjust(100);
      assert.isNotNull(
        container.querySelector("[data-testid='getting-started']"),
        `Getting started should render initially. DOM: ${container.innerHTML}`,
      );

      const router = yield* Router.Router;
      yield* router.navigate("/docs/components");
      yield* TestClock.adjust(10);

      yield* Signal.set(oldView, <StaleSignalChild />);
      yield* TestClock.adjust(50);

      yield* Deferred.succeed(newRouteReady, undefined);
      yield* TestClock.adjust(100);

      assert.isNotNull(
        container.querySelector("[data-testid='components']"),
        `Latest route should render after resolving. DOM: ${container.innerHTML}`,
      );
      assert.isNull(
        container.querySelector("[data-testid='stale-signal-child']"),
        `Stale SignalElement child must not commit. DOM: ${container.innerHTML}`,
      );
      assert.deepStrictEqual(staleSignalRenders, []);
      assert.deepStrictEqual(yield* Signal.peek(headings), ["components"]);
    }).pipe(Effect.provide(testLayerAt("/docs/getting-started"))),
  );

  scoped("gates pure elements emitted later by a stale same-path SignalElement", () =>
    Effect.gen(function* () {
      // Test: should not let same-path query changes commit stale pure JSX from the old route.
      // Scope: route-owned SignalElement values that do not contain a Component body.
      // Assertion: the intrinsic stale value never appears while the newer query route is pending.
      const oldView = yield* Signal.make<ElementType>(
        <article data-testid="search-one">Search one</article>,
      );
      const nextReady = yield* Deferred.make<void>();

      const SearchPage = Components.gen(function* () {
        const route = yield* Router.currentRoute;
        const q = route.query.get("q") ?? "";
        if (q === "two") {
          yield* Deferred.await(nextReady);
          return <article data-testid="search-two">Search two</article>;
        }
        return <>{signalElement(oldView)}</>;
      });

      const manifest = Routes.make().add(Route.make("/search").component(SearchPage)).manifest;
      const { container } = yield* render(<Outlet routes={manifest} />);
      yield* TestClock.adjust(100);
      assert.isNotNull(container.querySelector("[data-testid='search-one']"));

      const router = yield* Router.Router;
      yield* router.navigate("/search", { query: { q: "two" } });
      assert.strictEqual((yield* Router.currentRoute).query.get("q"), "two");
      yield* TestClock.adjust(10);

      yield* Signal.set(oldView, <article data-testid="stale-intrinsic">stale</article>);
      yield* TestClock.adjust(50);

      assert.isNull(
        container.querySelector("[data-testid='stale-intrinsic']"),
        `Stale same-path SignalElement intrinsic must not commit. DOM: ${container.innerHTML}`,
      );

      yield* Deferred.succeed(nextReady, undefined);
      yield* TestClock.adjust(100);
      assert.isNotNull(container.querySelector("[data-testid='search-two']"));
    }).pipe(Effect.provide(testLayerAt("/search?q=one"))),
  );

  scoped("commits docs layout chrome before a slow initial route child resolves", () =>
    Effect.gen(function* () {
      const articleStarted = yield* Deferred.make<void>();
      const articleReady = yield* Deferred.make<void>();

      const DocsLayout = Components.gen(function* () {
        return (
          <>
            <header data-testid="docs-header">Docs header</header>
            <section data-testid="docs-shell">
              <aside data-testid="docs-sidebar">Docs sidebar</aside>
              <main id="main-content">
                <Outlet />
              </main>
            </section>
          </>
        );
      });

      const ResourcesPage = Components.gen(function* () {
        yield* Deferred.succeed(articleStarted, undefined);
        yield* Deferred.await(articleReady);
        return <article data-testid="resources-page">Resources</article>;
      });

      const manifest = Routes.make().add(
        Route.make("/docs")
          .layout(DocsLayout)
          .children(Route.make("/resources").component(ResourcesPage)),
      ).manifest;

      const container = document.createElement("div");
      document.body.appendChild(container);
      yield* Effect.addFinalizer(() => Effect.sync(() => container.remove()));

      const renderer = yield* Renderer;
      const mountFiber = yield* Effect.forkScoped(
        renderer.mount(container, <Outlet routes={manifest} />),
      );
      yield* Deferred.await(articleStarted);

      assert.isNotNull(
        container.querySelector("[data-testid='docs-header']"),
        `Docs header should be visible while the initial article is still rendering. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='docs-shell']"),
        `Docs shell should be visible while the initial article is still rendering. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='docs-sidebar']"),
        `Docs sidebar should be visible while the initial article is still rendering. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("#main-content"),
        `Docs main region should be visible while the initial article is still rendering. DOM: ${container.innerHTML}`,
      );
      assert.isNull(
        container.querySelector("[data-testid='resources-page']"),
        `Resources article should not be visible until its component resolves. DOM: ${container.innerHTML}`,
      );

      yield* Deferred.succeed(articleReady, undefined);
      yield* Fiber.join(mountFiber);

      assert.isNotNull(
        container.querySelector("[data-testid='resources-page']"),
        `Resources article should render after it resolves. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/docs/resources"))),
  );

  scoped("renders layout loaders that resolve directly to a named export", () =>
    Effect.gen(function* () {
      // Test: should render a lazy layout whose loader resolves directly to a RouteComponent.
      // Scope: covers named-export Vite transform output for nested layout routes.
      // Assertion: both the layout shell and child route content appear in the DOM.
      const DocsLayout = Components.gen(function* () {
        return (
          <>
            <header data-testid="docs-header">Docs header</header>
            <section data-testid="docs-shell">
              <aside data-testid="docs-sidebar">Docs sidebar</aside>
              <main id="main-content">
                <Outlet />
              </main>
            </section>
          </>
        );
      });

      const ResourcesPage = Components.gen(function* () {
        return <article data-testid="resources-page">Resources</article>;
      });

      const LazyDocsLayout = () => Promise.resolve(DocsLayout);

      const manifest = Routes.make().add(
        Route.make("/docs")
          .layout(LazyDocsLayout)
          .children(Route.make("/resources").component(ResourcesPage)),
      ).manifest;

      const { container } = yield* render(<Outlet routes={manifest} />);
      yield* TestClock.adjust(100);

      assert.isNotNull(
        container.querySelector("[data-testid='docs-shell']"),
        `Docs shell should render from a named-export layout loader. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='resources-page']"),
        `Resources page should render inside the named-export layout. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/docs/resources"))),
  );

  scoped("commits docs layout chrome before a lazy initial route module resolves", () =>
    Effect.gen(function* () {
      const moduleRequested = yield* Deferred.make<void>();
      const moduleReady = yield* Deferred.make<void>();

      const DocsLayout = Components.gen(function* () {
        return (
          <>
            <header data-testid="docs-header">Docs header</header>
            <section data-testid="docs-shell">
              <aside data-testid="docs-sidebar">Docs sidebar</aside>
              <main id="main-content">
                <Outlet />
              </main>
            </section>
          </>
        );
      });

      const ResourcesPage = Components.gen(function* () {
        return <article data-testid="resources-page">Resources</article>;
      });

      const context = yield* Effect.context<never>();
      const LazyResourcesPage = () =>
        Effect.runPromiseWith(context)(
          Effect.gen(function* () {
            yield* Deferred.succeed(moduleRequested, undefined);
            yield* Deferred.await(moduleReady);
            return { default: ResourcesPage };
          }),
        );

      const manifest = Routes.make().add(
        Route.make("/docs")
          .layout(DocsLayout)
          .children(Route.make("/resources").component(LazyResourcesPage)),
      ).manifest;

      const container = document.createElement("div");
      document.body.appendChild(container);
      yield* Effect.addFinalizer(() => Effect.sync(() => container.remove()));

      const renderer = yield* Renderer;
      const mountFiber = yield* Effect.forkScoped(
        renderer.mount(container, <Outlet routes={manifest} />),
      );
      yield* Deferred.await(moduleRequested);

      assert.isNotNull(
        container.querySelector("[data-testid='docs-header']"),
        `Docs header should be visible while the lazy route module is still loading. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='docs-shell']"),
        `Docs shell should be visible while the lazy route module is still loading. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='docs-sidebar']"),
        `Docs sidebar should be visible while the lazy route module is still loading. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("#main-content"),
        `Docs main region should be visible while the lazy route module is still loading. DOM: ${container.innerHTML}`,
      );
      assert.isNull(
        container.querySelector("[data-testid='resources-page']"),
        `Resources article should not be visible until its lazy module resolves. DOM: ${container.innerHTML}`,
      );

      yield* Deferred.succeed(moduleReady, undefined);
      yield* Fiber.join(mountFiber);
      yield* TestClock.adjust(10);

      assert.isNotNull(
        container.querySelector("[data-testid='resources-page']"),
        `Resources article should render after the lazy module resolves. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/docs/resources"))),
  );

  scoped("preserves docs layout chrome DOM when navigating between sibling route children", () =>
    Effect.gen(function* () {
      let nextLayoutInstance = 0;
      let layoutCleanupCount = 0;

      const DocsLayout = Components.gen(function* () {
        const instance = `layout-${++nextLayoutInstance}`;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            layoutCleanupCount++;
          }),
        );

        return (
          <>
            <header data-testid="docs-header" data-instance={instance}>
              Docs header
            </header>
            <section data-testid="docs-shell" data-instance={instance}>
              <aside data-testid="docs-sidebar" data-instance={instance}>
                Docs sidebar
              </aside>
              <main>
                <Outlet />
              </main>
            </section>
            <footer data-testid="docs-footer" data-instance={instance}>
              Docs footer
            </footer>
          </>
        );
      });

      const SignalsPage = Components.gen(function* () {
        return <article data-testid="signals-page">Signals</article>;
      });

      const ResourcesPage = Components.gen(function* () {
        return <article data-testid="resources-page">Resources</article>;
      });

      const manifest = Routes.make().add(
        Route.make("/docs")
          .layout(DocsLayout)
          .children(
            Route.make("/signals").component(SignalsPage),
            Route.make("/resources").component(ResourcesPage),
          ),
      ).manifest;

      const { container } = yield* render(<Outlet routes={manifest} />);
      yield* TestClock.adjust(100);

      const initialShell = container.querySelector("[data-testid='docs-shell']");
      const initialHeader = container.querySelector("[data-testid='docs-header']");
      const initialSidebar = container.querySelector("[data-testid='docs-sidebar']");
      assert.isNotNull(
        initialShell,
        `Docs shell should render initially. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        initialHeader,
        `Docs header should render initially. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        initialSidebar,
        `Docs sidebar should render initially. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='signals-page']"),
        `Signals page should render initially. DOM: ${container.innerHTML}`,
      );

      const router = yield* Router.Router;
      yield* router.navigate("/docs/resources");
      yield* TestClock.adjust(100);

      assert.isNotNull(
        container.querySelector("[data-testid='resources-page']"),
        `Resources page should render after navigation. DOM: ${container.innerHTML}`,
      );
      assert.strictEqual(
        container.querySelector("[data-testid='docs-shell']"),
        initialShell,
        "Sibling docs topic navigation must preserve the mounted docs shell node",
      );
      assert.strictEqual(
        container.querySelector("[data-testid='docs-header']"),
        initialHeader,
        "Sibling docs topic navigation must preserve the mounted docs header node",
      );
      assert.strictEqual(
        container.querySelector("[data-testid='docs-sidebar']"),
        initialSidebar,
        "Sibling docs topic navigation must preserve the mounted docs sidebar node",
      );
      assert.strictEqual(
        layoutCleanupCount,
        0,
        "Sibling docs topic navigation must not unmount the docs layout component",
      );
    }).pipe(Effect.provide(testLayerAt("/docs/signals"))),
  );

  scoped("refreshes preserved layout route params when the matched params change", () =>
    Effect.gen(function* () {
      const UserLayout = Components.gen(function* () {
        const params = yield* Router.params("/users/:id");
        return (
          <section data-testid="user-layout" data-user-id={params.id}>
            <Outlet />
          </section>
        );
      });

      const UserPage = Components.gen(function* () {
        const params = yield* Router.params("/users/:id");
        return <article data-testid="user-page">User {params.id}</article>;
      });

      const manifest = Routes.make().add(
        Route.make("/users/:id")
          .params(Schema.Struct({ id: Schema.NumberFromString }))
          .layout(UserLayout)
          .component(UserPage),
      ).manifest;

      const { container } = yield* render(<Outlet routes={manifest} />);
      yield* TestClock.adjust(100);

      const initialLayout = container.querySelector("[data-testid='user-layout']");
      assert.strictEqual(initialLayout?.getAttribute("data-user-id"), "1");
      assert.include(container.textContent ?? "", "User 1");

      const router = yield* Router.Router;
      yield* router.navigate("/users/2");
      yield* TestClock.adjust(100);

      assert.strictEqual(
        container.querySelector("[data-testid='user-layout']")?.getAttribute("data-user-id"),
        "2",
        `Preserved-layout params should not remain frozen. DOM: ${container.innerHTML}`,
      );
      assert.include(container.textContent ?? "", "User 2");
    }).pipe(Effect.provide(testLayerAt("/users/1"))),
  );

  scoped("preserves docs layout chrome under a burst of overlapping sibling navigations", () =>
    // Invariant guard for the fast-docs-nav teardown class of bug: a burst of
    // overlapping sibling navigations must never tear the shared layout down
    // to nothing, and the latest navigation must win. NOTE: the precise
    // swap-fiber interleaving that triggered the production teardown is
    // timing-dependent (it needs real async + CPU throttle); under happy-dom +
    // TestClock it does not reproduce, so this asserts the observable
    // invariants rather than the race itself. The race fix is verified
    // authoritatively in a real throttled browser. See render-signal-element's
    // per-instance swap lock.
    Effect.gen(function* () {
      let nextLayoutInstance = 0;
      let layoutCleanupCount = 0;
      const headings = yield* Signal.make<ReadonlyArray<string>>(["signals"]);

      const DocsLayout = Components.gen(function* () {
        const instance = `layout-${++nextLayoutInstance}`;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            layoutCleanupCount++;
          }),
        );

        return (
          <section data-testid="docs-shell" data-instance={instance}>
            <aside data-testid="docs-sidebar" data-instance={instance}>
              Docs sidebar
            </aside>
            <main>
              <Outlet />
            </main>
            <nav data-testid="docs-rail">
              {Signal.each(headings, (heading) => Effect.succeed(<span>{heading}</span>), {
                key: (heading) => heading,
              })}
            </nav>
          </section>
        );
      });

      const SignalsPage = Components.gen(function* () {
        yield* Signal.set(headings, ["signals", "signals-detail"]);
        return <article data-testid="signals-page">Signals</article>;
      });

      const ResourcesPage = Components.gen(function* () {
        yield* Signal.set(headings, ["resources", "resources-detail"]);
        return <article data-testid="resources-page">Resources</article>;
      });

      const manifest = Routes.make().add(
        Route.make("/docs")
          .layout(DocsLayout)
          .children(
            Route.make("/signals").component(SignalsPage),
            Route.make("/resources").component(ResourcesPage),
          ),
      ).manifest;

      const { container } = yield* render(<Outlet routes={manifest} />);
      yield* TestClock.adjust(100);

      const initialShell = container.querySelector("[data-testid='docs-shell']");
      assert.isNotNull(
        initialShell,
        `Docs shell should render initially. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='signals-page']"),
        `Signals page should render initially. DOM: ${container.innerHTML}`,
      );

      // Fire a burst of overlapping navigations without awaiting each one, so
      // their swap fibers race on the single root-outlet signalElement just
      // like rapid sidebar clicks under throttle.
      const router = yield* Router.Router;
      const burst = [
        "/docs/resources",
        "/docs/signals",
        "/docs/resources",
        "/docs/signals",
        "/docs/resources",
        "/docs/signals",
      ];
      yield* Effect.forEach(
        burst,
        // Fork each navigation as its own fiber; capture the outcome as an Exit
        // so a superseded navigation that errors does not fail the test fiber.
        (path) => Effect.forkScoped(Effect.exit(router.navigate(path))),
        { discard: true },
      );
      yield* TestClock.adjust(300);
      yield* Effect.yieldNow;
      yield* TestClock.adjust(300);

      // Reliability: the layout shell must never be torn down to nothing.
      // The production bug collapsed the entire subtree to just the outlet
      // anchor comment (shell + sidebar + rail all gone). The shell may be
      // re-rendered, but it must always be present.
      assert.isNotNull(
        container.querySelector("[data-testid='docs-shell']"),
        `Overlapping docs navigation must not tear down the docs shell. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='docs-sidebar']"),
        `Overlapping docs navigation must not tear down the docs sidebar. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='docs-rail']"),
        `Overlapping docs navigation must not tear down the docs rail. DOM: ${container.innerHTML}`,
      );

      // Correctness: latest navigation wins — exactly one topic article is
      // visible and it is the last one navigated to.
      const articles = container.querySelectorAll(
        "[data-testid='signals-page'], [data-testid='resources-page']",
      );
      assert.strictEqual(
        articles.length,
        1,
        `Exactly one topic article must be visible after the burst. DOM: ${container.innerHTML}`,
      );
      assert.isNotNull(
        container.querySelector("[data-testid='signals-page']"),
        `Latest navigation (/docs/signals) must win. DOM: ${container.innerHTML}`,
      );
    }).pipe(Effect.provide(testLayerAt("/docs/signals"))),
  );

  scoped("should show new route content after navigation", () =>
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

  scoped("should show new route after navigating back and forth", () =>
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
    if (node instanceof Comment && node.textContent === "signal-element") anchors.push(node);
  }
  return anchors;
}
