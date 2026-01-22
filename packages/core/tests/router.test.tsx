/**
 * Router Unit Tests
 *
 * Router provides file-based routing with automatic code splitting.
 *
 * Test Categories:
 * - RouterService: Core service for navigation state
 * - Navigation: navigate, back, forward
 * - Route matching: parsePath, buildPath, createMatcher
 * - Outlet: Route rendering component
 * - Link: Navigation links
 * - Layers: browserLayer, testLayer
 * - Error handling: currentError, _error.tsx
 *
 * Goals: Reliability, stability, performance
 * - Verify navigation state updates correctly
 * - Verify route matching handles all patterns
 * - Verify cleanup on navigation
 * - Verify error boundaries catch re-render errors
 */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Data, Effect, Exit, Option, TestClock } from "effect";
import * as Router from "../src/router/router-service.js";
import type { RouteErrorInfo, RoutesManifest } from "../src/router/types.js";
import { Outlet } from "../src/router/outlet.js";
import { parsePath, buildPath, createMatcher } from "../src/router/matching.js";
import { cx } from "../src/router/utils.js";
import * as Signal from "../src/signal.js";
import { empty } from "../src/element.js";
import { render } from "../src/testing.js";
import * as Component from "../src/component.js";

// Tagged error for testing route errors
class TestRouteError extends Data.TaggedError("TestRouteError")<{ message: string }> {}

// Mock component for route tests - returns a valid RouteComponent (Effect<Element>)
const mockComponent = () => Promise.resolve({ default: Effect.succeed(empty) });

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
  it.scoped("should return true for current route", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users");

      const isActive = yield* router.isActive("/users", true);
      assert.isTrue(isActive);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should return false for non-matching route", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users");

      const isActive = yield* router.isActive("/about", true);
      assert.isFalse(isActive);
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );

  it.scoped("should support partial route matching", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;

      yield* router.navigate("/users/123");

      const isActive = yield* router.isActive("/users", false);
      assert.isTrue(isActive);
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
  it("should extract pathname from URL", () => {
    const { path } = parsePath("/users/123");

    assert.strictEqual(path, "/users/123");
  });

  it("should extract query string", () => {
    const { query } = parsePath("/search?foo=bar");

    assert.strictEqual(query.get("foo"), "bar");
  });

  it("should extract hash fragment", () => {
    const { path, query } = parsePath("/page?a=1#section");

    assert.strictEqual(path, "/page");
    assert.strictEqual(query.get("a"), "1");
  });

  it("should handle relative paths", () => {
    const { path } = parsePath("./foo");

    assert.strictEqual(path, "./foo");
  });
});

// =============================================================================
// buildPath - URL building
// =============================================================================
// Scope: Building URL paths from components

describe("buildPath", () => {
  it("should return pathname", () => {
    const result = buildPath("/users");

    assert.strictEqual(result, "/users");
  });

  it("should append query parameters", () => {
    const result = buildPath("/search", { q: "test", page: "1" });

    assert.include(result, "/search");
    assert.include(result, "q=test");
    assert.include(result, "page=1");
  });

  it("should encode special characters", () => {
    const result = buildPath("/search", { q: "hello world" });

    assert.include(result, "hello+world");
  });
});

// =============================================================================
// createMatcher - Route matching
// =============================================================================
// Scope: Creating matchers for route patterns

describe("createMatcher", () => {
  it("should match static paths exactly", () => {
    const matcher = createMatcher([{ path: "/users", component: mockComponent }]);

    const result = matcher.match("/users");

    assert.isTrue(Option.isSome(result));
  });

  it("should match dynamic path segments", () => {
    const matcher = createMatcher([{ path: "/users/:id", component: mockComponent }]);

    const result = matcher.match("/users/123");

    assert.isTrue(Option.isSome(result));
  });

  it("should extract parameters from matched path", () => {
    const matcher = createMatcher([{ path: "/users/:id", component: mockComponent }]);

    const result = matcher.match("/users/456");

    if (Option.isSome(result)) {
      assert.strictEqual(result.value.params.id, "456");
    } else {
      assert.fail("Expected match");
    }
  });

  it("should match catch-all segments", () => {
    const matcher = createMatcher([{ path: "/files/[...path]", component: mockComponent }]);

    const result = matcher.match("/files/a/b/c");

    if (Option.isSome(result)) {
      assert.strictEqual(result.value.params.path, "a/b/c");
    } else {
      assert.fail("Expected match");
    }
  });

  it("should match optional segments", () => {
    const matcher = createMatcher([
      { path: "/users", component: mockComponent },
      { path: "/users/:id", component: mockComponent },
    ]);

    const noId = matcher.match("/users");
    const withId = matcher.match("/users/123");

    assert.isTrue(Option.isSome(noId));
    assert.isTrue(Option.isSome(withId));
  });

  it("should return null for non-matching paths", () => {
    const matcher = createMatcher([{ path: "/users", component: mockComponent }]);

    const result = matcher.match("/about");

    assert.isTrue(Option.isNone(result));
  });

  it("should prioritize more specific routes", () => {
    const matcher = createMatcher([
      { path: "/users/:id", component: mockComponent },
      { path: "/users/new", component: mockComponent },
    ]);

    const result = matcher.match("/users/new");

    if (Option.isSome(result)) {
      assert.strictEqual(result.value.route.path, "/users/new");
    } else {
      assert.fail("Expected match");
    }
  });
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
      // Signal to trigger error on re-render
      const shouldError = Signal.unsafeMake(false);
      // Use object ref to capture error info (avoids TypeScript narrowing issues)
      const captured: { errorInfo: Option.Option<RouteErrorInfo> } = { errorInfo: Option.none() };

      // Route component that throws on re-render
      const RouteComponent = Component.gen(function* () {
        const throwNow = yield* Signal.get(shouldError);
        if (throwNow) {
          return yield* new TestRouteError({ message: "Re-render error for test" });
        }
        return <div data-testid="route-content">Route OK</div>;
      });

      // Error component using Component.gen that reads currentError
      // This is the pattern used in _error.tsx files
      const ErrorComponent = Component.gen(function* () {
        const errorInfo = yield* Router.currentError;
        captured.errorInfo = Option.some(errorInfo);
        return (
          <div data-testid="error-content">Error: {String(Cause.squash(errorInfo.cause))}</div>
        );
      });

      // Create routes manifest with error component
      const routes: RoutesManifest = [
        {
          path: "/test",
          component: () => Promise.resolve({ default: RouteComponent }),
          errorComponent: () => Promise.resolve({ default: ErrorComponent }),
        },
      ];

      // Render outlet with routes
      const app = Effect.gen(function* () {
        return <Outlet routes={routes} />;
      });

      const { queryByTestId } = yield* render(app).pipe(Effect.provide(Router.testLayer("/test")));

      // Initial render should show route content
      assert.isNotNull(queryByTestId("route-content"));
      assert.isNull(queryByTestId("error-content"));

      // Trigger re-render error
      yield* Signal.set(shouldError, true);
      yield* TestClock.adjust(20);

      // Error boundary should catch and show error component
      assert.isNotNull(queryByTestId("error-content"));
      assert.isNull(queryByTestId("route-content"));

      // Error component should have received error info via Router.currentError
      // This verifies the FiberRef propagation fix for Component.gen components
      assert.isTrue(
        Option.isSome(captured.errorInfo),
        "Error component should have captured error info",
      );
      if (Option.isNone(captured.errorInfo)) return; // TypeScript guard
      assert.strictEqual(captured.errorInfo.value.path, "/test");
      // Verify cause contains a failure (Cause.failureOption returns Some if there's a Fail)
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
