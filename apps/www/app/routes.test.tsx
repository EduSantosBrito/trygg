/* @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { render, waitFor } from "trygg/testing";
import * as Router from "trygg/router";

import { sidebarGroups } from "./content/sidebar";
import { routes } from "./routes";

const sidebarLinks = sidebarGroups.flatMap((group) => group.links);

const renderRoute = (path: string) =>
  Effect.gen(function* () {
    const result = yield* render(Router.Outlet({ routes: routes.manifest }));
    const current = yield* Router.currentRoute;

    return { current, result };
  }).pipe(Effect.provide(Router.testLayer(path)), Effect.scoped);

describe("docs routes", () => {
  it("renders the docs landing at /docs", async () => {
    const { current, result } = await Effect.runPromise(renderRoute("/docs"));

    expect(current.path).toBe("/docs");
    await Effect.runPromise(waitFor(() => result.container.textContent?.includes("Build UI")));
  });

  it("renders getting started", async () => {
    const { result } = await Effect.runPromise(renderRoute("/docs/getting-started"));

    await Effect.runPromise(
      waitFor(() => result.container.textContent?.includes("Getting started")),
    );
  });

  it.each(sidebarLinks)("matches docs sidebar link $href", async (link) => {
    const { current, result } = await Effect.runPromise(renderRoute(link.href));

    expect(current.path).toBe(link.href);
    await Effect.runPromise(waitFor(() => result.container.textContent?.includes(link.label)));
    expect(result.container.textContent).not.toContain("Page not found");
  });

  it("updates the on-this-page rail across docs routes", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* render(Router.Outlet({ routes: routes.manifest }));

          yield* waitFor(() => {
            const rail = result.container.querySelector(".docs-rail__links");
            if (!rail?.textContent?.includes("When to use")) {
              throw new Error("initial topic rail not ready");
            }
            return true;
          });

          yield* Router.navigate("/docs/api-types");

          yield* waitFor(() => {
            const rail = result.container.querySelector(".docs-rail__links");
            if (!rail?.textContent?.includes("Generated API client")) {
              throw new Error("topic rail did not update");
            }
            return true;
          });

          yield* Router.navigate("/docs");

          yield* waitFor(() => {
            if (!result.container.textContent?.includes("Build UI the Effect way")) {
              throw new Error("docs landing not ready");
            }
            if (result.container.querySelector(".docs-layout--with-rail") !== null) {
              throw new Error("landing should not reserve the on-this-page rail");
            }
            return true;
          });
        }).pipe(Effect.provide(Router.testLayer("/docs/components"))),
      ),
    );
  });

  it("does not duplicate docs chrome after sidebar navigation", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* render(Router.Outlet({ routes: routes.manifest }));

          yield* waitFor(() => {
            if (!result.container.textContent?.includes("Elements")) {
              throw new Error("initial docs route not ready");
            }
            return true;
          });

          yield* Router.navigate("/docs/signals");

          yield* waitFor(() => {
            if (!result.container.textContent?.includes("Signals")) {
              throw new Error("navigated docs route not ready");
            }
            return true;
          });
          yield* Effect.sleep("100 millis");

          expect(result.container.querySelectorAll(".docs-layout")).toHaveLength(1);
          expect(result.container.querySelectorAll(".docs-layout__sidebar")).toHaveLength(1);
          expect(result.container.querySelectorAll("footer")).toHaveLength(1);
          expect(result.container.textContent).not.toContain("Page not found");
        }).pipe(Effect.provide(Router.testLayer("/docs/elements"))),
      ),
    );
  });
});
