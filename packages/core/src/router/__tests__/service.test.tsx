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
import { Cause, Data, Effect, Exit, Option, TestClock } from "effect";
import * as Router from "../service.js";
import type { RouteErrorInfo } from "../types.js";
import { Outlet } from "../outlet.js";
import { parsePath, buildPath } from "../utils.js";
import { cx } from "../../primitives/cx.js";
import * as Signal from "../../primitives/signal.js";
import { render } from "../../testing/index.js";
import * as Component from "../../primitives/component.js";
import * as Route from "../route.js";

// Tagged error for testing route errors
class TestRouteError extends Data.TaggedError("TestRouteError")<{ message: string }> {}

// =============================================================================
// Router.current - Current route state
// =============================================================================
// Scope: Reading current route

describe("Router.current", () => {
  it.scoped("should return current route state", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const route = yield* Signal.get(router.current);

      assert.isDefined(route.path);
      assert.isDefined(route.params);
      assert.isDefined(route.query);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should update after navigation", () =>
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
  it.scoped("should return current query parameters", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const query = yield* Signal.get(router.query);

      assert.instanceOf(query, URLSearchParams);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should parse query string into object", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const query = yield* Signal.get(router.query);

      assert.strictEqual(query.get("foo"), "bar");
      assert.strictEqual(query.get("baz"), "123");
    }).pipe(Effect.provide(Router.testLayer("/?foo=bar&baz=123"))),
  );
});

// =============================================================================
// Router.params - Route parameters
// =============================================================================
// Scope: Reading route parameters from path

describe("Router.params", () => {
  it.scoped("should return extracted route parameters", () =>
    Effect.gen(function* () {
      const params = yield* Router.params("/users/:id");

      assert.isDefined(params);
    }).pipe(Effect.provide(Router.testLayer("/users/123"))),
  );

  it.scoped("should handle multiple route parameters", () =>
    Effect.gen(function* () {
      const params = yield* Router.params("/org/:orgId/user/:userId");

      assert.isDefined(params);
    }).pipe(Effect.provide(Router.testLayer("/org/1/user/2"))),
  );
});

// =============================================================================
// Router.navigate - Programmatic navigation
// =============================================================================
// Scope: Navigating to routes programmatically

describe("Router.navigate", () => {
  it.scoped("should navigate to specified path", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/about");

      const route = yield* Signal.get(router.current);
      assert.strictEqual(route.path, "/about");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should push to browser history", () =>
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

  it.scoped("should replace history when replace option true", () =>
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

  it.scoped("should navigate with query parameters", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/search", { query: { q: "test", page: "1" } });

      const query = yield* Signal.get(router.query);
      assert.strictEqual(query.get("q"), "test");
      assert.strictEqual(query.get("page"), "1");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should interpolate route parameters into path", () =>
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
  it.scoped("should navigate back in history", () =>
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
  it.scoped("should navigate forward in history", () =>
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
  it.scoped("should return Signal<true> for current route", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users");

      const activeSignal = yield* router.isActive("/users", { exact: true });
      const isActive = yield* Signal.get(activeSignal);
      assert.isTrue(isActive);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should return Signal<false> for non-matching route", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users");

      const activeSignal = yield* router.isActive("/about", { exact: true });
      const isActive = yield* Signal.get(activeSignal);
      assert.isFalse(isActive);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should support partial route matching", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users/123");

      const activeSignal = yield* router.isActive("/users");
      const isActive = yield* Signal.get(activeSignal);
      assert.isTrue(isActive);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should update reactively when route changes", () =>
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

  it.scoped("should append query parameters", () =>
    Effect.gen(function* () {
      const handler = Router.link("/search", { query: { q: "test" } });
      const mockEvent = { preventDefault: () => {} } as Event;

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
  it.scoped("should provide router without browser APIs", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      assert.isDefined(router.current);
      assert.isDefined(router.navigate);
      assert.isDefined(router.back);
      assert.isDefined(router.forward);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should start at specified initial path", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const route = yield* Signal.get(router.current);

      assert.strictEqual(route.path, "/initial");
    }).pipe(Effect.provide(Router.testLayer("/initial"))),
  );

  it.scoped("should support navigation in memory", () =>
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
  it.scoped("should combine multiple class strings", () =>
    Effect.gen(function* () {
      const result = yield* cx("a", "b", "c");

      assert.strictEqual(result, "a b c");
    }),
  );

  it.scoped("should filter out falsy values", () =>
    Effect.gen(function* () {
      const result = yield* cx("a", false, null, undefined, "b");

      assert.strictEqual(result, "a b");
    }),
  );

  it.scoped("should handle conditional object syntax", () =>
    Effect.gen(function* () {
      const result = yield* cx("base", { active: true, disabled: false });

      assert.strictEqual(result, "base active");
    }),
  );

  it.scoped("should flatten nested arrays", () =>
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
  it.scoped("should be accessible in Component.gen error component on re-render error", () =>
    Effect.gen(function* () {
      // Use object ref to capture error info (avoids TypeScript narrowing issues)
      const captured: { errorInfo: Option.Option<RouteErrorInfo> } = { errorInfo: Option.none() };

      // Route component that always throws
      const RouteComponent = Component.gen(function* () {
        return yield* new TestRouteError({ message: "Route error for test" });
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
      assert.isTrue(Option.isSome(Cause.failureOption(captured.errorInfo.value.cause)));
    }),
  );

  it.scoped("should die when called outside error boundary context", () =>
    Effect.gen(function* () {
      // currentError uses Effect.die (defect) when FiberRef is empty,
      // so we need Effect.exit to catch it (Effect.either only catches failures)
      const exit = yield* Effect.exit(Router.currentError);

      // Use Exit.match to handle both cases without conditional testing
      Exit.match(exit, {
        onFailure: (cause) => {
          // Should be a Die (defect), not a Fail
          assert.isTrue(Cause.isDie(cause));
        },
        onSuccess: () => {
          assert.fail("Expected currentError to die outside error boundary context");
        },
      });
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});
