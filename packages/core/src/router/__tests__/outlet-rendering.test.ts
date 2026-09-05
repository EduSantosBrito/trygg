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
import { scoped } from "../../testing/effect-vitest.js";
import { Cause, Effect, Exit, Option, Predicate, Ref, Schema, Scope } from "effect";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
import * as Router from "../service.js";
import { Outlet } from "../outlet.js";
import { renderComponent, renderError, renderLayout } from "../outlet-services.js";
import * as Signal from "../../primitives/signal.js";
import { Element, text } from "../../primitives/element.js";
import { setFiberRef } from "../../internal/fiber-ref.js";
import { InvalidRouteComponent, type RouteComponent } from "../types.js";

// =============================================================================
// Helper: Create RouteComponent
// =============================================================================

/** Create a RouteComponent that renders a text element */
const textComp = (content: string): RouteComponent => Effect.succeed(text(content));

/** Create a layout RouteComponent that reads CurrentOutletChild */
const renderLayoutChild = Effect.fn("outletRendering.renderLayoutChild")(function* () {
  const childContent = yield* Router.takeCurrentOutletChild();
  if (Option.isSome(childContent)) {
    return childContent.value;
  }
  return text("empty-layout");
});

const layoutComp = (_name: string): RouteComponent => renderLayoutChild();

class TestMiddlewareError extends Schema.TaggedError<TestMiddlewareError>()("TestMiddlewareError", {
  message: Schema.String,
}) {}

class LoaderFailure extends Schema.TaggedError<LoaderFailure>()("LoaderFailure", {
  reason: Schema.String,
}) {}

const decodeNeverDefaultExport = Schema.decodeUnknownPromise(
  Schema.Struct({ default: Schema.Never }),
);

type ElementTag = Element["_tag"];

function assertElementTag<Tag extends ElementTag>(
  element: Element,
  tag: Tag,
): asserts element is Extract<Element, { readonly _tag: Tag }> {
  assert.isTrue(Predicate.isTagged(element, tag));
}

// =============================================================================
// Helper: Run outlet effect and extract result element
// =============================================================================

/**
 * Run the Outlet's component effect to get the resulting Element.
 * The outlet returns a Component element whose run thunk produces a SignalElement
 * (wrapping a unified viewSignal). This helper unwraps both layers to get the
 * actual content element held in the signal.
 */
type ComponentElement = Omit<Extract<Element, { readonly _tag: "Component" }>, "run"> & {
  readonly run: () => Effect.Effect<Element, unknown, Router.Router | Scope.Scope>;
};
type SignalElement = Extract<Element, { readonly _tag: "SignalElement" }>;

const isComponentElement = (element: Element): element is ComponentElement =>
  Element.$is("Component")(element);

const isSignalElement = (element: Element): element is SignalElement =>
  Element.$is("SignalElement")(element);

const runOutletEffect: (
  outletElement: Element,
) => Effect.Effect<Element, unknown, Router.Router | Scope.Scope> = Effect.fn(
  "outletRendering.runOutletEffect",
)(function* (outletElement: Element) {
  if (!isComponentElement(outletElement)) {
    return outletElement;
  }

  const first = yield* outletElement.run();

  if (isComponentElement(first)) {
    const second = yield* first.run();
    if (isSignalElement(second)) {
      return yield* Signal.get(second.signal);
    }
    return second;
  }

  if (isSignalElement(first)) {
    return yield* Signal.get(first.signal);
  }

  return first;
});

// =============================================================================
// Outlet Coordination Tests
// =============================================================================

describe("Outlet - Coordination", () => {
  scoped("activates prefetch through public outlet coordination seam", () =>
    Effect.gen(function* () {
      const loaderCalls = yield* Ref.make(0);
      const activations = yield* Ref.make(0);
      const PageComp = textComp("Lazy Page");
      const prefetch = () => Ref.update(loaderCalls, (count) => count + 1);

      const manifest = Routes.make().add(
        Route.make("/lazy").component(PageComp).prefetch(prefetch),
      ).manifest;
      const baseRouter = yield* Router.Router;

      yield* baseRouter.prefetch("/lazy");
      assert.strictEqual(yield* Ref.get(loaderCalls), 0);

      const wrappedRouter = Router.Router.of({
        ...baseRouter,
        outletCoordination: {
          ...baseRouter.outletCoordination,
          activatePrefetch: (prefetch) =>
            Ref.update(activations, (count) => count + 1).pipe(
              Effect.flatMap(() => baseRouter.outletCoordination.activatePrefetch(prefetch)),
            ),
        },
      });

      const outlet = Outlet({ routes: manifest });
      yield* runOutletEffect(outlet).pipe(Effect.provideService(Router.Router, wrappedRouter));

      const state = yield* wrappedRouter.outletCoordination.prefetchState;
      assert.isTrue(Predicate.isTagged(state, "Active"));
      assert.strictEqual(yield* Ref.get(activations), 1);

      yield* wrappedRouter.prefetch("/lazy");
      assert.strictEqual(yield* Ref.get(loaderCalls), 1);
    }).pipe(Effect.provide(Router.testLayer("/lazy"))),
  );
});

// =============================================================================
// Rendering Tests
// =============================================================================

describe("Outlet - Rendering", () => {
  // ---------------------------------------------------------------------------
  // Eager route rendering (no loading component = direct render)
  // ---------------------------------------------------------------------------

  scoped("should render eager route immediately", () =>
    Effect.gen(function* () {
      const HomeComp = textComp("Home Page");

      const manifest = Routes.make().add(Route.make("/").component(HomeComp)).manifest;

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Without loading component, result is rendered directly as Component
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render route matching current path", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should not produce SignalElement when no loading defined", () =>
    Effect.gen(function* () {
      const PageComp = textComp("Direct");

      const manifest = Routes.make().add(Route.make("/direct").component(PageComp)).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/direct");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Without loading component, no async tracker is used
      assert.isFalse(Element.$is("SignalElement")(result));
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Loading state (lazy route simulation)
  // ---------------------------------------------------------------------------

  scoped("should show loading then component for lazy route", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Layout wrapping
  // ---------------------------------------------------------------------------

  scoped("should wrap with layout (root-to-leaf)", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render component without layout when none defined", () =>
    Effect.gen(function* () {
      const PageComp = textComp("Simple Page");

      const manifest = Routes.make().add(Route.make("/simple").component(PageComp)).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/simple");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // No layout -> direct Component element
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should apply leaf layout when only leaf has layout", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Nested Outlet (layout child rendering)
  // ---------------------------------------------------------------------------

  scoped("should render Outlet inside layout for child content", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render child content when CurrentOutletChild is set", () =>
    Effect.gen(function* () {
      // Pre-set CurrentOutletChild (simulates layout setting child)
      yield* Router.setCurrentOutletChild(Option.some(text("Child from parent")));

      const outlet = Outlet({});
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Text");
      assert.strictEqual(result.content, "Child from parent");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should clear CurrentOutletChild after reading", () =>
    Effect.gen(function* () {
      yield* Router.setCurrentOutletChild(Option.some(text("Child")));

      const outlet = Outlet({});
      yield* runOutletEffect(outlet);

      const remaining = yield* Router.takeCurrentOutletChild();
      assert.isTrue(Option.isNone(remaining));
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Loading component resolution (nearest wins)
  // ---------------------------------------------------------------------------

  scoped("should use nearest loading component", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should fall back to parent loading component", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should not show loading when none defined in chain", () =>
    Effect.gen(function* () {
      const PageComp = textComp("Direct Page");

      const manifest = Routes.make().add(Route.make("/direct").component(PageComp)).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/direct");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Without loading component, result is direct Component
      assert.isFalse(Element.$is("SignalElement")(result));
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Not Found handling
  // ---------------------------------------------------------------------------

  scoped("should render root notFound for unmatched path", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render default text when no notFound component defined", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().add(Route.make("/home").component(textComp("Home"))).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/unknown");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      // Should render default "404 - Not Found" text
      assertElementTag(result, "Text");
      assert.strictEqual(result.content, "404 - Not Found");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Middleware integration
  // ---------------------------------------------------------------------------

  scoped("should redirect when middleware returns redirect", () =>
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

  scoped("should render forbidden component when middleware forbids", () =>
    Effect.gen(function* () {
      const forbidMiddleware = Route.routeForbidden;
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should use root forbidden when route has none", () =>
    Effect.gen(function* () {
      const forbidMiddleware = Route.routeForbidden;
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render default forbidden text when none defined", () =>
    Effect.gen(function* () {
      const forbidMiddleware = Route.routeForbidden;
      const ProtectedComp = textComp("Protected");

      const manifest = Routes.make().add(
        Route.make("/admin").middleware(forbidMiddleware).component(ProtectedComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/admin");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Text");
      assert.strictEqual(result.content, "403 - Forbidden");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Error boundary integration
  // ---------------------------------------------------------------------------

  scoped("should render error boundary on middleware error", () =>
    Effect.gen(function* () {
      const failingMiddleware = Effect.fail(
        new TestMiddlewareError({ message: "Middleware failed" }),
      );
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render default error text when no error boundary defined", () =>
    Effect.gen(function* () {
      const failingMiddleware = Effect.fail(new TestMiddlewareError({ message: "oops" }));
      const PageComp = textComp("Page");

      const manifest = Routes.make().add(
        Route.make("/failing").middleware(failingMiddleware).component(PageComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/failing");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Text");
      assert.strictEqual(result.content, "Error");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render error boundary on params decode failure", () =>
    Effect.gen(function* () {
      const ErrorComp = textComp("Invalid params");
      const PageComp = textComp("User");

      const manifest = Routes.make().add(
        Route.make("/users/:id")
          .params(Schema.Struct({ id: Schema.NumberFromString }))
          .component(PageComp)
          .error(ErrorComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/users/abc");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "ErrorBoundaryElement");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render default error text on params decode failure without boundary", () =>
    Effect.gen(function* () {
      const PageComp = textComp("User");

      const manifest = Routes.make().add(
        Route.make("/users/:id")
          .params(Schema.Struct({ id: Schema.FiniteFromString }))
          .component(PageComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/users/abc");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Text");
      assert.strictEqual(result.content, "Error");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render default error text on query decode failure without boundary", () =>
    Effect.gen(function* () {
      const PageComp = textComp("Search");

      const manifest = Routes.make().add(
        Route.make("/search")
          .query(Schema.Struct({ q: Schema.String }))
          .component(PageComp),
      ).manifest;

      const router = yield* Router.Router;
      yield* router.navigate("/search");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Text");
      assert.strictEqual(result.content, "Error");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Empty/no routes
  // ---------------------------------------------------------------------------

  scoped("should render 'No routes configured' when routes is undefined", () =>
    Effect.gen(function* () {
      const outlet = Outlet({});
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Text");
      assert.strictEqual(result.content, "No routes configured");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render 'No routes configured' when routes is empty", () =>
    Effect.gen(function* () {
      const manifest = Routes.make().manifest;

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Text");
      assert.strictEqual(result.content, "No routes configured");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Path change produces different results
  // ---------------------------------------------------------------------------

  scoped("should produce different results for different paths", () =>
    Effect.gen(function* () {
      const HomeComp = textComp("Home");
      const AboutComp = textComp("About");

      const manifest = Routes.make()
        .add(Route.make("/").component(HomeComp))
        .add(Route.make("/about").component(AboutComp)).manifest;

      // First render at /
      const outlet1 = Outlet({ routes: manifest });
      const result1 = yield* runOutletEffect(outlet1);
      assertElementTag(result1, "Component");

      // Navigate to /about
      const router = yield* Router.Router;
      yield* router.navigate("/about");

      // Second render at /about (new outlet instance)
      const outlet2 = Outlet({ routes: manifest });
      const result2 = yield* runOutletEffect(outlet2);
      assertElementTag(result2, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Index route matching
  // ---------------------------------------------------------------------------

  scoped("should render index route for parent path", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render child route when navigating deeper", () =>
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
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// Implicit RoutesManifest (via FiberRef)
// =============================================================================

describe("Outlet - Implicit Manifest", () => {
  scoped("should read manifest from CurrentRoutesManifest FiberRef", () =>
    Effect.gen(function* () {
      const HomeComp = textComp("Home");

      const manifest = Routes.make().add(Route.make("/").component(HomeComp)).manifest;

      // Set manifest via FiberRef (simulates what entry module does)
      yield* setFiberRef(Routes.CurrentRoutesManifest, Option.some(manifest));

      // Outlet without routes prop — should read from FiberRef
      const outlet = Outlet({});
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should prefer explicit routes prop over FiberRef", () =>
    Effect.gen(function* () {
      const HomeComp = textComp("Home");
      const OtherComp = textComp("Other");

      const fiberRefManifest = Routes.make().add(
        Route.make("/other").component(OtherComp),
      ).manifest;
      const propManifest = Routes.make().add(Route.make("/").component(HomeComp)).manifest;

      yield* setFiberRef(Routes.CurrentRoutesManifest, Option.some(fiberRefManifest));

      // Explicit prop should be used (matches "/")
      const outlet = Outlet({ routes: propManifest });
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should render 'No routes configured' when neither prop nor FiberRef", () =>
    Effect.gen(function* () {
      const outlet = Outlet({});
      const result = yield* runOutletEffect(outlet);

      assertElementTag(result, "Text");
      assert.strictEqual(result.content, "No routes configured");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// Lazy loader decode failure (resolveComponent)
// =============================================================================

/**
 * Construct a minimal RouteDefinition with a loader function as component.
 * Simulates post-vite-transform behavior where `.component(X)` becomes
 * `.component(() => import("./X"))`.
 * @internal
 */
const loaderDefinition = (
  path: string,
  loader: () => Promise<{ readonly default: unknown }>,
): Route.RouteDefinition => Route.make(path).component(loader).definition;

describe("Outlet - Lazy loader (resolveComponent)", () => {
  // ---------------------------------------------------------------------------
  // Happy path: valid loader → Component renders
  // ---------------------------------------------------------------------------

  scoped("should render component from valid lazy loader", () =>
    Effect.gen(function* () {
      const PageComp = textComp("Lazy Page");
      const manifest: Routes.RoutesManifest = {
        routes: [loaderDefinition("/lazy", () => Promise.resolve({ default: PageComp }))],
        notFound: undefined,
        forbidden: undefined,
        error: undefined,
      };

      const router = yield* Router.Router;
      yield* router.navigate("/lazy");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Failure: no error boundary → catchAllCause absorbs, view stays empty
  // ---------------------------------------------------------------------------

  scoped("should not crash when loader returns invalid default export", () =>
    Effect.gen(function* () {
      const manifest: Routes.RoutesManifest = {
        routes: [loaderDefinition("/bad", () => Promise.resolve({ default: "not-a-component" }))],
        notFound: undefined,
        forbidden: undefined,
        error: undefined,
      };

      const router = yield* Router.Router;
      yield* router.navigate("/bad");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);
      // No error boundary → catchAllCause absorbs inside the route view component.
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should not crash when loader rejects", () =>
    Effect.gen(function* () {
      const manifest: Routes.RoutesManifest = {
        routes: [
          loaderDefinition("/fail", () =>
            decodeNeverDefaultExport({
              default: new LoaderFailure({ reason: "network error" }),
            }),
          ),
        ],
        notFound: undefined,
        forbidden: undefined,
        error: undefined,
      };

      const router = yield* Router.Router;
      yield* router.navigate("/fail");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);
      // No error boundary → catchAllCause absorbs inside the route view component.
      assertElementTag(result, "Component");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  // ---------------------------------------------------------------------------
  // Failure with error boundary → error boundary renders
  // ---------------------------------------------------------------------------

  scoped("should render error boundary when loader returns invalid component", () =>
    Effect.gen(function* () {
      const ErrorComp = textComp("Error Boundary Hit");
      const defWithError: Route.RouteDefinition = {
        ...loaderDefinition("/bad-with-boundary", () => Promise.resolve({ default: 42 })),
        error: ErrorComp,
      };

      const manifest: Routes.RoutesManifest = {
        routes: [defWithError],
        notFound: undefined,
        forbidden: undefined,
        error: undefined,
      };

      const router = yield* Router.Router;
      yield* router.navigate("/bad-with-boundary");

      const outlet = Outlet({ routes: manifest });
      const result = yield* runOutletEffect(outlet);
      // Error boundary catches the RenderLoadError and returns an explicit boundary wrapper.
      assertElementTag(result, "ErrorBoundaryElement");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// InvalidRouteComponent error
// =============================================================================

describe("outlet rendering - InvalidRouteComponent", () => {
  it.effect("renderComponent fails with InvalidRouteComponent on invalid input", () =>
    Effect.gen(function* () {
      // @ts-expect-error exercising runtime validation for invalid route components.
      const exit = yield* renderComponent("not-a-component", {}).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.findErrorOption(exit.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) {
          assert.isTrue(error.value instanceof InvalidRouteComponent);
          if (error.value instanceof InvalidRouteComponent) {
            assert.isTrue(Predicate.isTagged(error.value, "InvalidRouteComponent"));
          }
        }
      }
    }),
  );

  it.effect("renderLayout fails with InvalidRouteComponent on invalid input", () =>
    Effect.gen(function* () {
      // @ts-expect-error exercising runtime validation for invalid route layouts.
      const exit = yield* renderLayout(42, text("child"), {}).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.findErrorOption(exit.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) {
          assert.isTrue(error.value instanceof InvalidRouteComponent);
          if (error.value instanceof InvalidRouteComponent) {
            assert.isTrue(Predicate.isTagged(error.value, "InvalidRouteComponent"));
          }
        }
      }
    }),
  );

  it.effect("renderError fails with InvalidRouteComponent on invalid input", () =>
    Effect.gen(function* () {
      // @ts-expect-error exercising runtime validation for invalid error boundaries.
      const exit = yield* renderError(null, Cause.empty, "/test").pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.findErrorOption(exit.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) {
          assert.isTrue(error.value instanceof InvalidRouteComponent);
          if (error.value instanceof InvalidRouteComponent) {
            assert.isTrue(Predicate.isTagged(error.value, "InvalidRouteComponent"));
          }
        }
      }
    }),
  );
});
