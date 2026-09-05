/**
 * Router Unit Tests
 *
 * Test Categories:
 * - RouterService: Core service for navigation state
 * - Navigation: navigate, back, forward
 * - Path utilities: parsePath, buildPath
 * - Link: Navigation links
 * - Layers: browserLayer, testLayer
 * - Error handling: currentError
 *
 * Goals: Reliability, stability, performance
 * - Verify navigation state updates correctly
 * - Verify cleanup on navigation
 * - Verify error boundaries catch re-render errors
 */
import { assert, describe, it } from "@effect/vitest";
import { scoped } from "../../testing/effect-vitest.js";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Router from "../service.js";
import type { RouteErrorInfo } from "../types.js";
import { Outlet } from "../outlet.js";
import { parsePath, buildPath } from "../utils.js";
import { cx } from "../../primitives/cx.js";
import * as Signal from "../../primitives/signal.js";
import { render } from "../../testing/index.js";
import * as Component from "../../primitives/component.js";
import * as Route from "../route.js";
import * as Routes from "../routes.js";

// Tagged error for testing route errors
class TestRouteError extends Schema.TaggedError<TestRouteError>()("TestRouteError", {
  detail: Schema.String,
}) {}

// =============================================================================
// Router.current - Current route state
// =============================================================================
// Scope: Reading current route

describe("Router.current", () => {
  scoped("should return current route state", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const route = yield* Signal.get(router.current);

      assert.isDefined(route.path);
      assert.isDefined(route.params);
      assert.isDefined(route.query);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should update after navigation", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users");

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/users");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// Router.query - Query parameters
// =============================================================================
// Scope: Reading/writing query parameters

describe("Router.query", () => {
  scoped("should return current query parameters", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const query = yield* Signal.get(router.query);

      assert.instanceOf(query, URLSearchParams);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should parse query string into object", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const query = yield* Signal.get(router.query);

      assert.strictEqual(query.get("foo"), "bar");
      assert.strictEqual(query.get("baz"), "123");
    }).pipe(Effect.provide(Router.testLayer("/?foo=bar&baz=123"))),
  );

  scoped("should not notify query subscribers when serialized query is unchanged", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const notifications = yield* Ref.make(0);
      const unsubscribe = yield* Signal.subscribe(router.query, () =>
        Ref.update(notifications, (count) => count + 1),
      );

      yield* router.navigate("/users", { query: { tab: "main" } });

      const count = yield* Ref.get(notifications);
      yield* unsubscribe;

      assert.strictEqual(count, 0);
    }).pipe(Effect.provide(Router.testLayer("/dashboard?tab=main"))),
  );

  scoped("should project the matching query while query notifications are gated", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const gateHeld = yield* Deferred.make<void>();
      const releaseGate = yield* Deferred.make<void>();
      const observed = yield* Deferred.make<{ readonly path: string; readonly query: string }>();
      const unsubscribe = yield* Signal.subscribe(router.current, () =>
        Effect.gen(function* () {
          const current = yield* Signal.peek(router.current);
          const query = yield* Signal.peek(router.query);
          yield* Deferred.succeed(observed, {
            path: current.path,
            query: query.toString(),
          }).pipe(Effect.asVoid);
        }),
      );
      const gateFiber = yield* Effect.forkScoped(
        router.query._gate.withPermits(1)(
          Deferred.succeed(gateHeld, undefined).pipe(
            Effect.flatMap(() => Deferred.await(releaseGate)),
          ),
        ),
      );
      yield* Deferred.await(gateHeld);

      const navigation = yield* Effect.forkScoped(router.navigate("/next?tab=new"));
      assert.deepStrictEqual(yield* Deferred.await(observed), {
        path: "/next",
        query: "tab=new",
      });

      yield* Deferred.succeed(releaseGate, undefined).pipe(Effect.asVoid);
      yield* Fiber.join(navigation);
      yield* Fiber.join(gateFiber);
      yield* unsubscribe;
    }).pipe(Effect.provide(Router.testLayer("/before?tab=old"))),
  );
});

// =============================================================================
// Router.params - Route parameters
// =============================================================================
// Scope: Reading route parameters from path

describe("Router.params", () => {
  scoped("should fail when no active route render owns the requested pattern", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Router.params("/users/:id"));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.include(Cause.pretty(exit.cause), "RouteParamsPatternMismatch");
      }
    }).pipe(Effect.provide(Router.testLayer("/users/123"))),
  );

  scoped("should not infer active params from the router pathname alone", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Router.params("/org/:orgId/user/:userId"));

      assert.isTrue(Exit.isFailure(exit));
    }).pipe(Effect.provide(Router.testLayer("/org/1/user/2"))),
  );

  scoped("should expose schema-decoded values inside routed Component.gen pages", () =>
    Effect.gen(function* () {
      const Page = Component.gen(function* () {
        const params = yield* Router.params("/users/:id");
        return (
          <div data-testid="route-params">
            {params.id === undefined ? "missing" : `${typeof params.id}:${params.id}`}
          </div>
        );
      });

      const manifest = Routes.make().add(
        Route.make("/users/:id")
          .params(Schema.Struct({ id: Schema.NumberFromString }))
          .component(Page),
      ).manifest;
      const { getByTestId } = yield* render(<Outlet routes={manifest} />).pipe(
        Effect.provide(Router.testLayer("/users/123")),
      );

      assert.strictEqual((yield* getByTestId("route-params")).textContent, "number:123");
    }),
  );

  scoped("should reject params requested for a pattern outside the active match chain", () =>
    Effect.gen(function* () {
      const Page = Component.gen(function* () {
        const result = yield* Router.params("/posts/:slug").pipe(Effect.result);
        return (
          <div data-testid="route-params-mismatch">
            {Result.isFailure(result)
              ? `${result.failure._tag}:${result.failure.activePatterns.join(",")}`
              : "unexpected-success"}
          </div>
        );
      });
      const manifest = Routes.make().add(Route.make("/users/:id").component(Page)).manifest;
      const { getByTestId } = yield* render(<Outlet routes={manifest} />).pipe(
        Effect.provide(Router.testLayer("/users/123")),
      );

      assert.strictEqual(
        (yield* getByTestId("route-params-mismatch")).textContent,
        "RouteParamsPatternMismatch:/users/:id",
      );
    }),
  );

  scoped("should preserve separately decoded ancestor and leaf params", () =>
    Effect.gen(function* () {
      const OrgLayout = Component.gen(function* () {
        const org = yield* Router.params("/org/:orgId");
        return (
          <section data-testid="org-layout" data-org={org.orgId}>
            <Outlet />
          </section>
        );
      });
      const UserPage = Component.gen(function* () {
        const org = yield* Router.params("/org/:orgId");
        const user = yield* Router.params("/org/:orgId/user/:userId");
        return (
          <div data-testid="nested-route-params">
            {`${typeof org.orgId}:${org.orgId}|${typeof user.orgId}:${user.orgId}|${typeof user.userId}:${user.userId}`}
          </div>
        );
      });
      const manifest = Routes.make().add(
        Route.make("/org/:orgId")
          .params(Schema.Struct({ orgId: Schema.NumberFromString }))
          .layout(OrgLayout)
          .children(
            Route.make("/user/:userId")
              .params(Schema.Struct({ userId: Schema.NumberFromString }))
              .component(UserPage),
          ),
      ).manifest;
      const { getByTestId } = yield* render(<Outlet routes={manifest} />).pipe(
        Effect.provide(Router.testLayer("/org/12/user/34")),
      );

      assert.strictEqual((yield* getByTestId("org-layout")).getAttribute("data-org"), "12");
      assert.strictEqual(
        (yield* getByTestId("nested-route-params")).textContent,
        "number:12|number:12|number:34",
      );
    }),
  );
});

// =============================================================================
// Router.navigate - Programmatic navigation
// =============================================================================
// Scope: Navigating to routes programmatically

describe("Router.navigate", () => {
  scoped("should navigate to specified path", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/about");

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/about");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should push to browser history", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/first");
      yield* router.navigate("/second");

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/second");

      yield* router.back();
      yield* TestClock.adjust(10);

      const after = yield* Signal.get(router.current);
      assert.strictEqual(after.path, "/first");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should replace history when replace option true", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/first");
      yield* router.navigate("/second", { replace: true });

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/second");

      yield* router.back();
      yield* TestClock.adjust(10);

      const after = yield* Signal.get(router.current);
      assert.strictEqual(after.path, "/");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should navigate with query parameters", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/search", { query: { q: "test", page: "1" } });

      const query = yield* Signal.get(router.query);
      assert.strictEqual(query.get("q"), "test");
      assert.strictEqual(query.get("page"), "1");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should interpolate route parameters into path", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users/42/posts/10");

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/users/42/posts/10");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// Router.back / Router.forward - History navigation
// =============================================================================
// Scope: History navigation

describe("Router.back", () => {
  scoped("should navigate back in history", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/page1");
      yield* router.navigate("/page2");

      yield* router.back();
      yield* TestClock.adjust(10);

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/page1");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

describe("Router.forward", () => {
  scoped("should navigate forward in history", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/page1");
      yield* router.navigate("/page2");
      yield* router.back();
      yield* TestClock.adjust(10);

      yield* router.forward();
      yield* TestClock.adjust(10);

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/page2");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// Router.isActive - Active route checking
// =============================================================================
// Scope: Checking if route is active

describe("Router.isActive", () => {
  scoped("should return Signal<true> for current route", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users");

      const activeSignal = yield* router.isActive("/users", { exact: true });
      const isActive = yield* Signal.get(activeSignal);
      assert.isTrue(isActive);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should return Signal<false> for non-matching route", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users");

      const activeSignal = yield* router.isActive("/about", { exact: true });
      const isActive = yield* Signal.get(activeSignal);
      assert.isFalse(isActive);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should support partial route matching", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users/123");

      const activeSignal = yield* router.isActive("/users");
      const isActive = yield* Signal.get(activeSignal);
      assert.isTrue(isActive);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should update reactively when route changes", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      const activeSignal = yield* router.isActive("/users", { exact: true });

      // Initially at "/", so /users is not active
      assert.isFalse(yield* Signal.get(activeSignal));

      // Navigate to /users
      yield* router.navigate("/users");
      assert.isTrue(yield* Signal.get(activeSignal));

      // Navigate away
      yield* router.navigate("/about");
      assert.isFalse(yield* Signal.get(activeSignal));
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// Router.link - Generate href
// =============================================================================
// Scope: Building href strings for links

describe("Router.link", () => {
  it("should return path string", () => {
    const handler = Router.link("/users");

    assert.isFunction(handler);
  });

  it("should interpolate parameters into path", () => {
    const handler = Router.link("/users/123");

    assert.isFunction(handler);
  });

  scoped("should append query parameters", () =>
    Effect.gen(function* () {
      const handler = Router.link("/search", { query: { q: "test" } });
      const mockEvent = new Event("click", { cancelable: true });

      yield* handler(mockEvent);

      const router = yield* Router.Router;
      const query = yield* Signal.get(router.query);
      assert.strictEqual(query.get("q"), "test");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// parsePath - URL parsing
// =============================================================================
// Scope: Parsing URL paths

describe("parsePath", () => {
  it.effect("should extract pathname from URL", () =>
    Effect.gen(function* () {
      const { path } = yield* parsePath("/users/123");

      assert.strictEqual(path, "/users/123");
    }),
  );

  it.effect("should extract query string", () =>
    Effect.gen(function* () {
      const { query } = yield* parsePath("/search?foo=bar");

      assert.strictEqual(query.get("foo"), "bar");
    }),
  );

  it.effect("should extract hash fragment", () =>
    Effect.gen(function* () {
      const { path, query } = yield* parsePath("/page?a=1#section");

      assert.strictEqual(path, "/page");
      assert.strictEqual(query.get("a"), "1");
    }),
  );

  it.effect("should handle relative paths", () =>
    Effect.gen(function* () {
      const { path } = yield* parsePath("./foo");

      assert.strictEqual(path, "./foo");
    }),
  );
});

// =============================================================================
// buildPath - URL building
// =============================================================================
// Scope: Building URL paths from components

describe("buildPath", () => {
  it.effect("should return pathname", () =>
    Effect.gen(function* () {
      const result = yield* buildPath("/users");

      assert.strictEqual(result, "/users");
    }),
  );

  it.effect("should append query parameters", () =>
    Effect.gen(function* () {
      const result = yield* buildPath("/search", { q: "test", page: "1" });

      assert.include(result, "/search");
      assert.include(result, "q=test");
      assert.include(result, "page=1");
    }),
  );

  it.effect("should encode special characters", () =>
    Effect.gen(function* () {
      const result = yield* buildPath("/search", { q: "hello world" });

      assert.include(result, "hello+world");
    }),
  );
});

// =============================================================================
// testLayer - Test router
// =============================================================================
// Scope: Router layer for testing

describe("testLayer", () => {
  scoped("should provide router without browser APIs", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      assert.isDefined(router.current);
      assert.isDefined(router.navigate);
      assert.isDefined(router.back);
      assert.isDefined(router.forward);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  scoped("should start at specified initial path", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const route = yield* Signal.get(router.current);

      assert.strictEqual(route.path, "/initial");
    }).pipe(Effect.provide(Router.testLayer("/initial"))),
  );

  scoped("should support navigation in memory", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/page1");
      yield* router.navigate("/page2");
      yield* router.back();
      yield* TestClock.adjust(10);

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/page1");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});

// =============================================================================
// cx - Class name utility
// =============================================================================
// Scope: Building class name strings

describe("cx", () => {
  scoped("should combine multiple class strings", () =>
    Effect.gen(function* () {
      const result = yield* cx("a", "b", "c");

      assert.strictEqual(result, "a b c");
    }),
  );

  scoped("should filter out falsy values", () =>
    Effect.gen(function* () {
      const result = yield* cx("a", false, null, undefined, "b");

      assert.strictEqual(result, "a b");
    }),
  );

  scoped("should handle conditional object syntax", () =>
    Effect.gen(function* () {
      const result = yield* cx("base", { active: true, disabled: false });

      assert.strictEqual(result, "base active");
    }),
  );

  scoped("should flatten nested arrays", () =>
    Effect.gen(function* () {
      const result = yield* cx("a", "b");

      assert.strictEqual(result, "a b");
    }),
  );
});

// =============================================================================
// Router.currentError - Error info in error components
// =============================================================================
// Scope: Error boundary FiberRef propagation for Component.gen error components

describe("Router.currentError", () => {
  scoped("should be accessible in Component.gen error component on re-render error", () =>
    Effect.gen(function* () {
      // Use object ref to capture error info (avoids TypeScript narrowing issues)
      const captured: { errorInfo: Option.Option<RouteErrorInfo> } = { errorInfo: Option.none() };

      // Route component that always throws
      const RouteComponent = Component.gen(function* () {
        return yield* new TestRouteError({ detail: "Route error for test" });
      });

      // Error component using Component.gen that reads currentError
      const ErrorComponent = Component.gen(function* () {
        const errorInfo = yield* Router.currentError;
        captured.errorInfo = Option.some(errorInfo);
        return (
          <div data-testid="error-content">Error: {String(Cause.squash(errorInfo.cause))}</div>
        );
      });

      // Create routes with error boundary
      const manifest = {
        routes: [Route.make("/test").component(RouteComponent).error(ErrorComponent).definition],
        notFound: undefined,
        forbidden: undefined,
        error: undefined,
      };

      // Render outlet with routes
      const app = Effect.gen(function* () {
        return Outlet({ routes: manifest });
      });

      const { queryByTestId } = yield* render(app).pipe(Effect.provide(Router.testLayer("/test")));
      yield* TestClock.adjust(20);

      // Error boundary should catch and show error component
      assert.isTrue(Option.isSome(yield* queryByTestId("error-content")));

      // Error component should have received error info via Router.currentError
      assert.isTrue(
        Option.isSome(captured.errorInfo),
        "Error component should have captured error info",
      );
      if (Option.isNone(captured.errorInfo)) return; // TypeScript guard
      assert.strictEqual(captured.errorInfo.value.path, "/test");
      assert.isTrue(Cause.hasFails(captured.errorInfo.value.cause));
    }),
  );

  scoped("should fail when called outside error boundary context", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Router.currentError);

      Exit.match(exit, {
        onFailure: (cause) => {
          const error = Cause.findErrorOption(cause);
          if (Option.isNone(error)) {
            return assert.fail("Expected CurrentErrorOutsideBoundaryError failure");
          }
          assert.instanceOf(error.value, Router.CurrentErrorOutsideBoundaryError);
        },
        onSuccess: () => {
          assert.fail("Expected currentError to fail outside error boundary context");
        },
      });
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});
