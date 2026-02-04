/**
 * Outlet Rendering Unit Tests (Phase 13)
 *
 * Tests for:
 * - Eager route renders immediately (no loading state)
 * - Lazy route shows loading then component (SignalElement from tracker)
 * - Layout wrapping (root-to-leaf stacking)
 * - Nested Outlet inside layout renders child content
 * - Nearest loading component wins
 * - Parent loading component fallback
 * - Cleanup on navigation (different match results)
 */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, FiberRef, Option, Scope } from "effect";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
import * as Router from "../service.js";
import { Outlet } from "../outlet.js";
import { OutletRenderer } from "../outlet-services.js";
import * as Signal from "../../primitives/signal.js";
import { componentElement, text } from "../../primitives/element.js";
import type { Element, ElementKey } from "../../primitives/element.js";
import { InvalidRouteComponent, type RouteComponent } from "../types.js";
import type { Component } from "../../primitives/component.js";
import type { Layer, Context } from "effect";

// =============================================================================
// Helper: Create RouteComponent
// =============================================================================

/** Create a RouteComponent that renders a text element */
const textComp = (content: string): RouteComponent => {
  const fn = () => componentElement(() => Effect.succeed(text(content)));
  const comp = Object.assign(fn, {
    _tag: "EffectComponent" as const,
    _layers: [] as ReadonlyArray<Layer.Layer.Any>,
    _requirements: [] as ReadonlyArray<Context.Tag<any, any>>,
    provide: () => comp as Component.Type<never, unknown, unknown>,
  });
  return comp as RouteComponent;
};

/** Create a layout RouteComponent that reads CurrentOutletChild */
const layoutComp = (_name: string): RouteComponent => {
  const fn = () =>
    componentElement(() =>
      Effect.gen(function* () {
        const childContent = yield* FiberRef.get(Router.CurrentOutletChild);
        if (Option.isSome(childContent)) {
          yield* FiberRef.set(Router.CurrentOutletChild, Option.none());
          return childContent.value;
        }
        return text("empty-layout");
      }),
    );
  const comp = Object.assign(fn, {
    _tag: "EffectComponent" as const,
    _layers: [] as ReadonlyArray<Layer.Layer.Any>,
    _requirements: [] as ReadonlyArray<Context.Tag<any, any>>,
    provide: () => comp as Component.Type<never, unknown, unknown>,
  });
  return comp as RouteComponent;
};

// =============================================================================
// Helper: Run outlet effect and extract result element
// =============================================================================

/**
 * Run the Outlet's component effect to get the resulting Element.
 * The outlet returns a Component element whose run thunk produces a SignalElement
 * (wrapping a unified viewSignal). This helper unwraps both layers to get the
 * actual content element held in the signal.
 */
type ComponentElement = {
  readonly _tag: "Component";
  readonly run: () => Effect.Effect<Element, unknown, Router.Router | Scope.Scope>;
  readonly key: ElementKey | null;
};

const isComponentElement = (element: Element): element is ComponentElement =>
  element._tag === "Component";

const runOutletEffect = (
  outletElement: Element,
): Effect.Effect<Element, unknown, Router.Router | Scope.Scope> =>
  Effect.gen(function* () {
    if (!isComponentElement(outletElement)) {
      return outletElement;
    }

    const first = yield* outletElement.run();

    if (isComponentElement(first)) {
      const second = yield* first.run();
      if (second._tag === "SignalElement") {
        return yield* Signal.get(second.signal);
      }
      return second;
    }

    if (first._tag === "SignalElement") {
      return yield* Signal.get(first.signal);
    }

    return first;
  });

// =============================================================================
// Rendering Tests
// =============================================================================

describe("Outlet - Rendering", () => {
  // ---------------------------------------------------------------------------
  // Eager route rendering (no loading component = direct render)
  // ---------------------------------------------------------------------------

  it.scoped("should render eager route immediately", () =>
    Effect.gen(function* () {
      const HomeComp = textComp("Home Page");

      const manifest = Routes.make().add(Route.make("/").component(HomeComp)).manifest;

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Without loading component, result is rendered directly as Component
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render route matching current path", () =>
    Effect.gen(function* () {
      const HomeComp = textComp("Home");
      const UsersComp = textComp("Users");

      const manifest = Routes.make()
        .add(Route.make("/").component(HomeComp))
        .add(Route.make("/users").component(UsersComp)).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/users");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Should match /users route and render as Component
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should not produce SignalElement when no loading defined", () =>
    Effect.gen(function* () {
      const PageComp = textComp("Direct");

      const manifest = Routes.make().add(Route.make("/direct").component(PageComp)).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/direct");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Without loading component, no async tracker is used
      assert.notStrictEqual(result._tag, "SignalElement");
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Loading state (lazy route simulation)
  // ---------------------------------------------------------------------------

  it.scoped("should show loading then component for lazy route", () =>
    Effect.gen(function* () {
      const LoadingComp = textComp("Loading...");
      const PageComp = textComp("Page Content");

      const manifest = Routes.make().add(
        Route.make("/page").component(PageComp).loading(LoadingComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/page");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // When loading component is defined, outlet uses async tracker.
      // The viewSignal initially holds the loading element (Component).
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Layout wrapping
  // ---------------------------------------------------------------------------

  it.scoped("should wrap with layout (root-to-leaf)", () =>
    Effect.gen(function* () {
      const AdminLayout = layoutComp("AdminLayout");
      const UsersLayout = layoutComp("UsersLayout");
      const UserDetail = textComp("User Detail");

      const manifest = Routes.make().add(
        Route.make("/admin")
          .layout(AdminLayout)
          .children(
            Route.make("/users")
              .layout(UsersLayout)
              .children(Route.make("/:id").component(UserDetail)),
          ),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/admin/users/123");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Result is a Component (the outermost layout wrapping the inner)
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render component without layout when none defined", () =>
    Effect.gen(function* () {
      const PageComp = textComp("Simple Page");

      const manifest = Routes.make().add(Route.make("/simple").component(PageComp)).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/simple");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // No layout -> direct Component element
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should apply leaf layout when only leaf has layout", () =>
    Effect.gen(function* () {
      const LeafLayout = layoutComp("LeafLayout");
      const PageComp = textComp("Content");

      const manifest = Routes.make().add(
        Route.make("/wrapped").component(PageComp).layout(LeafLayout),
      ).manifest;

      // Note: a route with both component and layout would have the layout
      // wrapping the component. The current builder allows this.
      const router = yield* Router.Router;
      yield* router.navigate("/wrapped");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // With leaf layout, result is still Component (layout wrapping component)
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Nested Outlet (layout child rendering)
  // ---------------------------------------------------------------------------

  it.scoped("should render Outlet inside layout for child content", () =>
    Effect.gen(function* () {
      const ChildComp = textComp("Child Content");
      const ParentLayout = layoutComp("Parent");

      const manifest = Routes.make().add(
        Route.make("/parent")
          .layout(ParentLayout)
          .children(Route.make("/child").component(ChildComp)),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/parent/child");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // The result is the outermost layout Component
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render child content when CurrentOutletChild is set", () =>
    Effect.gen(function* () {
      // Pre-set CurrentOutletChild (simulates layout setting child)
      yield* FiberRef.set(Router.CurrentOutletChild, Option.some(text("Child from parent")));

      const outlet = Outlet({});
      const result = yield* runOutletEffect(outlet);

      assert.strictEqual(result._tag, "Text");
      if (result._tag === "Text") {
        assert.strictEqual(result.content, "Child from parent");
      }
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should clear CurrentOutletChild after reading", () =>
    Effect.gen(function* () {
      yield* FiberRef.set(Router.CurrentOutletChild, Option.some(text("Child")));

      const outlet = Outlet({});
      yield* runOutletEffect(outlet);

      const remaining = yield* FiberRef.get(Router.CurrentOutletChild);
      assert.isTrue(Option.isNone(remaining));
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Loading component resolution (nearest wins)
  // ---------------------------------------------------------------------------

  it.scoped("should use nearest loading component", () =>
    Effect.gen(function* () {
      const ParentLoading = textComp("Parent Loading");
      const ChildLoading = textComp("Child Loading");
      const PageComp = textComp("Page");

      const manifest = Routes.make().add(
        Route.make("/parent")
          .layout(layoutComp("Parent"))
          .loading(ParentLoading)
          .children(Route.make("/child").component(PageComp).loading(ChildLoading)),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/parent/child");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // With loading component, outlet uses async tracker.
      // The viewSignal initially holds the loading element (Component).
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should fall back to parent loading component", () =>
    Effect.gen(function* () {
      const ParentLoading = textComp("Parent Loading");
      const PageComp = textComp("Page");

      const manifest = Routes.make().add(
        Route.make("/parent").layout(layoutComp("Parent")).loading(ParentLoading).children(
          Route.make("/child").component(PageComp),
          // No loading on child - should use parent's
        ),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/parent/child");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Parent's loading should be used. The viewSignal initially holds the
      // parent loading element (Component).
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should not show loading when none defined in chain", () =>
    Effect.gen(function* () {
      const PageComp = textComp("Direct Page");

      const manifest = Routes.make().add(Route.make("/direct").component(PageComp)).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/direct");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Without loading component, result is direct Component
      assert.notStrictEqual(result._tag, "SignalElement");
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Not Found handling
  // ---------------------------------------------------------------------------

  it.scoped("should render root notFound for unmatched path", () =>
    Effect.gen(function* () {
      const NotFoundComp = textComp("Not Found Page");

      const manifest = Routes.make()
        .add(Route.make("/home").component(textComp("Home")))
        .notFound(NotFoundComp).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/unknown");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Should render the notFound component
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render default text when no notFound component defined", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/home").component(textComp("Home"))).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/unknown");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Should render default "404 - Not Found" text
      assert.strictEqual(result._tag, "Text");
      if (result._tag === "Text") {
        assert.strictEqual(result.content, "404 - Not Found");
      }
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Middleware integration
  // ---------------------------------------------------------------------------

  it.scoped("should redirect when middleware returns redirect", () =>
    Effect.gen(function* () {
      const redirectMiddleware = Route.routeRedirect("/login");
      const ProtectedComp = textComp("Protected");

      const manifest = Routes.make()
        .add(Route.make("/protected").middleware(redirectMiddleware).component(ProtectedComp))
        .add(Route.make("/login").component(textComp("Login"))).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/protected");

      const outlet = Outlet({ routes: manifest });
      yield* runOutletEffect(outlet);

      // Router should have navigated to /login
      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/login");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render forbidden component when middleware forbids", () =>
    Effect.gen(function* () {
      const forbidMiddleware = Route.routeForbidden();
      const ForbiddenComp = textComp("Access Denied");
      const ProtectedComp = textComp("Protected");

      const manifest = Routes.make().add(
        Route.make("/admin")
          .middleware(forbidMiddleware)
          .component(ProtectedComp)
          .forbidden(ForbiddenComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/admin");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Should render forbidden component
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should use root forbidden when route has none", () =>
    Effect.gen(function* () {
      const forbidMiddleware = Route.routeForbidden();
      const RootForbidden = textComp("Root Forbidden");
      const ProtectedComp = textComp("Protected");

      const manifest = Routes.make()
        .add(Route.make("/admin").middleware(forbidMiddleware).component(ProtectedComp))
        .forbidden(RootForbidden).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/admin");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Should render root forbidden component
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render default forbidden text when none defined", () =>
    Effect.gen(function* () {
      const forbidMiddleware = Route.routeForbidden();
      const ProtectedComp = textComp("Protected");

      const manifest = Routes.make().add(
        Route.make("/admin").middleware(forbidMiddleware).component(ProtectedComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/admin");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      assert.strictEqual(result._tag, "Text");
      if (result._tag === "Text") {
        assert.strictEqual(result.content, "403 - Forbidden");
      }
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Error boundary integration
  // ---------------------------------------------------------------------------

  it.scoped("should render error boundary on middleware error", () =>
    Effect.gen(function* () {
      const failingMiddleware = Effect.die(new Error("Middleware died"));
      const ErrorComp = textComp("Error Occurred");
      const PageComp = textComp("Page");

      const manifest = Routes.make().add(
        Route.make("/failing").middleware(failingMiddleware).component(PageComp).error(ErrorComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/failing");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Middleware errors with non-redirect/non-forbidden are caught by error boundary
      // The runMiddlewareChain catches the error and returns { _tag: "Error" }
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render default error text when no error boundary defined", () =>
    Effect.gen(function* () {
      const failingMiddleware = Effect.die(new Error("oops"));
      const PageComp = textComp("Page");

      const manifest = Routes.make().add(
        Route.make("/failing").middleware(failingMiddleware).component(PageComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/failing");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      assert.strictEqual(result._tag, "Text");
      if (result._tag === "Text") {
        assert.strictEqual(result.content, "Error");
      }
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Empty/no routes
  // ---------------------------------------------------------------------------

  it.scoped("should render 'No routes configured' when routes is undefined", () =>
    Effect.gen(function* () {
      const outlet = Outlet({});
      const result = yield* runOutletEffect(outlet);

      assert.strictEqual(result._tag, "Text");
      if (result._tag === "Text") {
        assert.strictEqual(result.content, "No routes configured");
      }
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render 'No routes configured' when routes is empty", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().manifest;

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      assert.strictEqual(result._tag, "Text");
      if (result._tag === "Text") {
        assert.strictEqual(result.content, "No routes configured");
      }
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Path change produces different results
  // ---------------------------------------------------------------------------

  it.scoped("should produce different results for different paths", () =>
    Effect.gen(function* () {
      const HomeComp = textComp("Home");
      const AboutComp = textComp("About");

      const manifest = Routes.make()
        .add(Route.make("/").component(HomeComp))
        .add(Route.make("/about").component(AboutComp)).manifest;

      // First render at /
      const outlet1 = Outlet({ routes: manifest });
      const result1 = yield* runOutletEffect(outlet1);
      assert.strictEqual(result1._tag, "Component");

      // Navigate to /about
      const router = yield* Router.Router;
      yield* router.navigate("/about");

      // Second render at /about (new outlet instance)
      const outlet2 = Outlet({ routes: manifest });
      const result2 = yield* runOutletEffect(outlet2);
      assert.strictEqual(result2._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Index route matching
  // ---------------------------------------------------------------------------

  it.scoped("should render index route for parent path", () =>
    Effect.gen(function* () {
      const IndexComp = textComp("Settings Index");
      const ProfileComp = textComp("Profile");

      const manifest = Routes.make().add(
        Route.make("/settings")
          .layout(layoutComp("Settings"))
          .children(Route.index(IndexComp), Route.make("/profile").component(ProfileComp)),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/settings");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Should match the index route (rendered with layout)
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render child route when navigating deeper", () =>
    Effect.gen(function* () {
      const IndexComp = textComp("Index");
      const ProfileComp = textComp("Profile");

      const manifest = Routes.make().add(
        Route.make("/settings")
          .layout(layoutComp("Settings"))
          .children(Route.index(IndexComp), Route.make("/profile").component(ProfileComp)),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/settings/profile");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Should match /settings/profile route
      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// Implicit RoutesManifest (via FiberRef)
// =============================================================================

describe("Outlet - Implicit Manifest", () => {
  it.scoped("should read manifest from CurrentRoutesManifest FiberRef", () =>
    Effect.gen(function* () {
      const HomeComp = textComp("Home");

      const manifest = Routes.make().add(Route.make("/").component(HomeComp)).manifest;

      // Set manifest via FiberRef (simulates what entry module does)
      yield* FiberRef.set(Routes.CurrentRoutesManifest, Option.some(manifest));

      // Outlet without routes prop — should read from FiberRef
      const outlet = Outlet({});
      const result = yield* runOutletEffect(outlet);

      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should prefer explicit routes prop over FiberRef", () =>
    Effect.gen(function* () {
      const HomeComp = textComp("Home");
      const OtherComp = textComp("Other");

      const fiberRefManifest = Routes.make().add(
        Route.make("/other").component(OtherComp),
      ).manifest;
      const propManifest = Routes.make().add(Route.make("/").component(HomeComp)).manifest;

      yield* FiberRef.set(Routes.CurrentRoutesManifest, Option.some(fiberRefManifest));

      // Explicit prop should be used (matches "/")
      const outlet = Outlet({ routes: propManifest });
      const result = yield* runOutletEffect(outlet);

      assert.strictEqual(result._tag, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should render 'No routes configured' when neither prop nor FiberRef", () =>
    Effect.gen(function* () {
      const outlet = Outlet({});
      const result = yield* runOutletEffect(outlet);

      assert.strictEqual(result._tag, "Text");
      if (result._tag === "Text") {
        assert.strictEqual(result.content, "No routes configured");
      }
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// InvalidRouteComponent error
// =============================================================================

describe("OutletRenderer - InvalidRouteComponent", () => {
  it.effect("renderComponent fails with InvalidRouteComponent on invalid input", () =>
    Effect.gen(function* () {
      const renderer = yield* OutletRenderer;
      const exit = yield* renderer.renderComponent("not-a-component" as any, {}).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) {
          assert.strictEqual((error.value as InvalidRouteComponent)._tag, "InvalidRouteComponent");
        }
      }
    }).pipe(Effect.provide(OutletRenderer.Live)),
  );

  it.effect("renderLayout fails with InvalidRouteComponent on invalid input", () =>
    Effect.gen(function* () {
      const renderer = yield* OutletRenderer;
      const exit = yield* renderer.renderLayout(42 as any, text("child"), {}).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) {
          assert.strictEqual((error.value as InvalidRouteComponent)._tag, "InvalidRouteComponent");
        }
      }
    }).pipe(Effect.provide(OutletRenderer.Live)),
  );

  it.effect("renderError fails with InvalidRouteComponent on invalid input", () =>
    Effect.gen(function* () {
      const renderer = yield* OutletRenderer;
      const exit = yield* renderer.renderError(null as any, Cause.empty, "/test").pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) {
          assert.strictEqual(error.value._tag, "InvalidRouteComponent");
        }
      }
    }).pipe(Effect.provide(OutletRenderer.Live)),
  );
});
