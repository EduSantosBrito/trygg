/**
 * Module prefetch tests
 *
 * Tests that the prefetch resolver correctly warms lazy route modules
 * by calling ComponentLoader functions for matched routes.
 * Uses production code paths (buildPrefetchResolver, collectPrefetchTargets).
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import type { Layer } from "effect";
import * as Component from "../../primitives/component.js";
import { empty } from "../../primitives/element.js";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
import { createMatcher, type RouteMatcherShape } from "../matching.js";
import { buildPrefetchResolver } from "../outlet.js";
import type { ComponentLoader, RouteComponent } from "../types.js";

// =============================================================================
// Helpers
// =============================================================================

/** Create a dummy RouteComponent (matches Component.Type structural shape) */
const makeComp = (): RouteComponent => {
  const fn = () => empty;
  const comp = Object.assign(fn, {
    _tag: "EffectComponent" as const,
    _layers: [] as ReadonlyArray<Layer.Layer.Any>,

    provide: () => comp as Component.Component.Type<never, unknown, unknown>,
  });
  return comp as RouteComponent;
};

const TestComp = makeComp();

/** Create a tracked loader that records when it's called */
const trackedLoader =
  (callLog: Ref.Ref<ReadonlyArray<string>>, name: string): ComponentLoader =>
  () => {
    Ref.update(callLog, (arr) => [...arr, name]).pipe(Effect.runSync);
    return Promise.resolve({ default: TestComp });
  };

/** Build a RouteMatcherShape from a Routes manifest */
const buildMatcher = (manifest: Routes.RoutesManifest) =>
  Effect.map(
    createMatcher(manifest),
    (m): RouteMatcherShape => ({
      match: (p) => Effect.succeed(m.match(p)),
      routes: Effect.succeed(m.routes),
    }),
  );

/** Build prefetch function from manifest using production code */
const buildPrefetch = (manifest: Routes.RoutesManifest) =>
  Effect.map(buildMatcher(manifest), (shape) => buildPrefetchResolver(shape));

// =============================================================================
// Tests
// =============================================================================

describe("Module Prefetch", () => {
  it.effect("should call loaders for matched route", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([]);
      const loader = trackedLoader(log, "counter");

      const prefetch = yield* buildPrefetch(
        Routes.make().add(Route.make("/counter").component(loader)).manifest,
      );
      yield* prefetch("/counter");

      const calls = yield* Ref.get(log);
      assert.deepStrictEqual(calls, ["counter"]);
    }),
  );

  it.effect("should not fail for unmatched paths", () =>
    Effect.gen(function* () {
      const prefetch = yield* buildPrefetch(
        Routes.make().add(Route.make("/counter").component(TestComp)).manifest,
      );
      yield* prefetch("/nonexistent");
    }),
  );

  it.effect("should ignore failing loaders", () =>
    Effect.gen(function* () {
      const failingLoader: ComponentLoader = () => Promise.reject(new Error("network error"));

      const prefetch = yield* buildPrefetch(
        Routes.make().add(Route.make("/broken").component(failingLoader)).manifest,
      );
      yield* prefetch("/broken");
    }),
  );

  it.effect("should be idempotent — browser import() cache handles dedup", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([]);
      const loader = trackedLoader(log, "form");

      const prefetch = yield* buildPrefetch(
        Routes.make().add(Route.make("/form").component(loader)).manifest,
      );
      yield* prefetch("/form");
      yield* prefetch("/form");

      const calls = yield* Ref.get(log);
      assert.strictEqual(calls.length, 2);
    }),
  );

  it.effect("should load ancestor layouts and leaf component", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([]);
      const layoutLoader = trackedLoader(log, "settings-layout");
      const componentLoader = trackedLoader(log, "settings-profile");

      const prefetch = yield* buildPrefetch(
        Routes.make().add(
          Route.make("/settings")
            .layout(layoutLoader)
            .children(Route.make("/profile").component(componentLoader)),
        ).manifest,
      );
      yield* prefetch("/settings/profile");

      const calls = yield* Ref.get(log);
      assert.isTrue(calls.includes("settings-layout"));
      assert.isTrue(calls.includes("settings-profile"));
    }),
  );

  it.effect("should skip non-lazy components", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([]);

      const prefetch = yield* buildPrefetch(
        Routes.make().add(Route.make("/static").component(TestComp)).manifest,
      );
      yield* prefetch("/static");

      const calls = yield* Ref.get(log);
      assert.strictEqual(calls.length, 0);
    }),
  );
});
