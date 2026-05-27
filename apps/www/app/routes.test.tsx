/* @vitest-environment happy-dom */

import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { render, waitFor } from "trygg/testing";
import * as Router from "trygg/router";

import { DocsHeadingsLive } from "./content/headings";
import { sidebarGroups } from "./content/sidebar";
import { routes } from "./routes";

const sidebarLinks = sidebarGroups.flatMap((group) => group.links);

const failWait = (message: string): never => assert.fail(message);

const renderRoute = (path: string) =>
  Effect.gen(function* () {
    const result = yield* render(Router.Outlet({ routes: routes.manifest }));
    const current = yield* Router.currentRoute;

    return { current, result };
  }).pipe(Effect.provide(Layer.merge(Router.testLayer(path), DocsHeadingsLive)), Effect.scoped);

describe("docs routes", () => {
  it.effect("renders the docs landing at /docs", () =>
    Effect.gen(function* () {
      const { current, result } = yield* renderRoute("/docs");

      assert.strictEqual(current.path, "/docs");
      yield* waitFor(() => result.container.textContent?.includes("Build UI"));
    }),
  );

  it.effect("renders getting started", () =>
    Effect.gen(function* () {
      const { result } = yield* renderRoute("/docs/getting-started");

      yield* waitFor(() => result.container.textContent?.includes("Getting started"));
    }),
  );

  it.effect.each(sidebarLinks)("matches docs sidebar link $href", (link) =>
    Effect.gen(function* () {
      const { current, result } = yield* renderRoute(link.href);

      assert.strictEqual(current.path, link.href);
      yield* waitFor(() => result.container.textContent?.includes(link.label));
      assert.notInclude(result.container.textContent, "Page not found");
    }),
  );

  it.effect("updates the on-this-page rail across docs routes", () =>
    Effect.gen(function* () {
      const result = yield* render(Router.Outlet({ routes: routes.manifest }));

      yield* waitFor(() => {
        const rail = result.container.querySelector(".docs-rail__links");
        if (!rail?.textContent?.includes("When to use")) {
          return failWait("initial topic rail not ready");
        }
        return true;
      });

      yield* Router.navigate("/docs/api-types");

      yield* waitFor(() => {
        const rail = result.container.querySelector(".docs-rail__links");
        if (!rail?.textContent?.includes("Generated API client")) {
          return failWait("topic rail did not update");
        }
        return true;
      });

      yield* Router.navigate("/docs");

      yield* waitFor(() => {
        if (!result.container.textContent?.includes("Build UI the Effect way")) {
          return failWait("docs landing not ready");
        }
        if (result.container.querySelector(".docs-layout--with-rail") !== null) {
          return failWait("landing should not reserve the on-this-page rail");
        }
        return true;
      });
    }).pipe(Effect.provide(Layer.merge(Router.testLayer("/docs/components"), DocsHeadingsLive))),
  );

  it.effect("does not duplicate docs chrome after sidebar navigation", () =>
    Effect.gen(function* () {
      const result = yield* render(Router.Outlet({ routes: routes.manifest }));

      yield* waitFor(() => {
        if (!result.container.textContent?.includes("Elements")) {
          return failWait("initial docs route not ready");
        }
        return true;
      });

      yield* Router.navigate("/docs/signals");

      yield* waitFor(() => {
        if (!result.container.textContent?.includes("Signals")) {
          return failWait("navigated docs route not ready");
        }
        return true;
      });
      yield* Effect.sleep("100 millis");

      assert.strictEqual(result.container.querySelectorAll(".docs-layout").length, 1);
      assert.strictEqual(result.container.querySelectorAll(".docs-layout__sidebar").length, 1);
      assert.strictEqual(result.container.querySelectorAll("footer").length, 1);
      assert.notInclude(result.container.textContent, "Page not found");
    }).pipe(Effect.provide(Layer.merge(Router.testLayer("/docs/elements"), DocsHeadingsLive))),
  );
});
