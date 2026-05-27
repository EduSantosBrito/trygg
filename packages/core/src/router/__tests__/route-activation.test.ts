import { describe, expect, it } from "vitest";
import { Effect, Option } from "effect";
import { unsafeEraseR } from "../../internal/unsafe.js";
import type { RouteMatch, RouteMatcherShape } from "../matching.js";
import { makeRouteActivation } from "../route-activation.js";

const request = (activationId: string, path: string) => ({
  activationId,
  path,
  query: new URLSearchParams(),
  scrollIntent: Option.none(),
});

const makeMatcher = (matchPath: string): RouteMatcherShape => ({
  routes: Effect.succeed([]),
  match: (path) =>
    Effect.succeed(
      path === matchPath
        ? Option.some({ route: { path: matchPath, ancestors: [], definition: {} }, params: {} } as unknown as RouteMatch)
        : Option.none(),
    ),
});

describe("RouteActivation", () => {
  it("commits the latest activation", async () => {
    const outcome = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const activation = yield* makeRouteActivation({ emitTraceEvents: true });
          yield* activation.activate(request("nav-1", "/docs"));
          return yield* activation.commit({ activationId: "nav-1", path: "/docs" });
        }),
      ),
    );

    expect(outcome).toEqual({ _tag: "Committed", activationId: "nav-1", path: "/docs" });
  });

  it("drops stale activations when a newer activation wins", async () => {
    const outcome = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const activation = yield* makeRouteActivation({ emitTraceEvents: true });
          yield* activation.activate(request("nav-1", "/slow"));
          yield* activation.activate(request("nav-2", "/fast"));
          return yield* activation.commit({ activationId: "nav-1", path: "/slow" });
        }),
      ),
    );

    expect(outcome).toEqual({
      _tag: "DroppedStale",
      activationId: "nav-1",
      supersededBy: "nav-2",
    });
  });

  it("returns NotFound when the canonical matcher has no match", async () => {
    const outcome = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const activation = yield* makeRouteActivation(
            { emitTraceEvents: true },
            makeMatcher("/known"),
          );
          return yield* activation.activate(request("nav-1", "/missing"));
        }),
      ),
    );

    expect(outcome).toEqual({ _tag: "NotFound", activationId: "nav-1", path: "/missing" });
  });

  it("integrates with the canonical matcher for matched routes", async () => {
    const outcome = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const activation = yield* makeRouteActivation(
            { emitTraceEvents: true },
            makeMatcher("/known"),
          );
          return yield* activation.activate(request("nav-1", "/known"));
        }),
      ),
    );

    expect(outcome).toEqual({ _tag: "Committed", activationId: "nav-1", path: "/known" });
  });
});
