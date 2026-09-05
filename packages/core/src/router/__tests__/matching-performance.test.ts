import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Option, Scheduler } from "effect";
import { empty } from "../../primitives/element.js";
import { resolveRoutes, RouteMatcher } from "../matching.js";
import * as Route from "../route.js";
import * as Routes from "../routes.js";

const page = Effect.succeed(empty);

describe("route resolution and matching cost", () => {
  it.effect("should decode each pathname segment once while scanning many routes", () =>
    Effect.gen(function* () {
      // Scope: the real matcher must not repeat boundary decoding for every candidate.
      // Assertion: a late hit and a miss each decode exactly the two input segments.
      let routes = Routes.make();
      for (let index = 0; index < 100; index++) {
        routes = routes.add(Route.make(`/page-${index}/:id`).component(page));
      }
      const matcher = yield* RouteMatcher.make(routes.manifest);
      const decode = vi.spyOn(globalThis, "decodeURIComponent");
      yield* Effect.gen(function* () {
        const hit = yield* matcher.match("/page-99/a%2Fb");
        assert.isTrue(Option.isSome(hit));
        if (Option.isSome(hit)) assert.deepStrictEqual(hit.value.params, { id: "a/b" });
        assert.strictEqual(decode.mock.calls.length, 2);
        decode.mockClear();
        assert.isTrue(Option.isNone(yield* matcher.match("/missing/value")));
        assert.strictEqual(decode.mock.calls.length, 2);
      }).pipe(Effect.ensuring(Effect.sync(() => decode.mockRestore())));
    }),
  );

  it.effect("should preserve declaration order while the scheduler yields frequently", () =>
    Effect.gen(function* () {
      // Scope: equally specific nested routes use declaration order as the tie breaker.
      // Assertion: descendants precede the next sibling and the first declared match wins.
      const manifest = Routes.make()
        .add(Route.make("/users").children(Route.make("/:first").component(page)))
        .add(Route.make("/users/:second").component(page)).manifest;
      const resolved = yield* resolveRoutes(manifest);
      assert.deepStrictEqual(
        resolved.map((route) => route.path),
        ["/users/:first", "/users/:second"],
      );
      const matcher = yield* RouteMatcher.fromResolved(resolved);
      const matched = yield* matcher.match("/users/42");
      assert.isTrue(Option.isSome(matched));
      if (Option.isSome(matched)) assert.deepStrictEqual(matched.value.params, { first: "42" });
    }).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, 32)),
  );

  it.effect("should isolate results while the same resolution Effect runs repeatedly", () =>
    Effect.gen(function* () {
      // Scope: construction stays lazy and each execution owns its mutable accumulator.
      // Assertion: executions return independent arrays with identical paths and ancestors.
      const manifest = Routes.make().add(
        Route.make("/parent").children(Route.index(page), Route.make("/child").component(page)),
      ).manifest;
      const resolve = resolveRoutes(manifest);
      const [first, second] = yield* Effect.all([resolve, resolve], { concurrency: 2 });
      assert.notStrictEqual(first, second);
      assert.deepStrictEqual(
        first.map((route) => route.path),
        ["/parent", "/parent/child"],
      );
      assert.deepStrictEqual(second, first);
      assert.deepStrictEqual(
        first[1]?.ancestors.map((route) => route.path),
        ["/parent"],
      );
      assert.deepStrictEqual(yield* resolveRoutes(Routes.make().manifest), []);
    }),
  );

  it.effect("should preserve typed malformed input failures while no candidate matches", () =>
    Effect.gen(function* () {
      // Scope: decode-once matching must retain the canonical URI boundary and empty manifests.
      // Assertion: malformed encoding and dot segments fail; an empty matcher remains a miss.
      const matcher = yield* RouteMatcher.make(
        Routes.make().add(Route.make("/known/:id").component(page)).manifest,
      );
      for (const pathname of ["/missing/%E0%A4%A", "/missing/%2e%2e"]) {
        const failure = yield* Effect.flip(matcher.match(pathname));
        assert.strictEqual(failure._tag, "InvalidRoutePathEncoding");
        assert.strictEqual(failure.pathname, pathname);
      }
      const emptyMatcher = yield* RouteMatcher.make(Routes.make().manifest);
      assert.isTrue(Option.isNone(yield* emptyMatcher.match("/%invalid")));
    }),
  );
});
