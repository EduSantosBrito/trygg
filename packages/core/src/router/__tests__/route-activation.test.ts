import { describe, expect, it } from "vitest";
import { Effect, Option, Ref } from "effect";
import { unsafeEraseR } from "../../internal/unsafe.js";
import type { RouteMatch, RouteMatcherShape } from "../matching.js";
import { makeRouteActivation, makeRouteActivationBoundary } from "../route-activation.js";
import type { ComponentInput, RouteComponent } from "../types.js";

const request = (activationId: string, path: string) => ({
  activationId,
  path,
  query: new URLSearchParams(),
  scrollIntent: Option.none(),
});

const makeMatch = (
  path: string,
  definition: Record<string, unknown> = {},
): RouteMatch =>
  ({
    route: {
      path,
      ancestors: [],
      definition: { prefetch: [], ...definition },
    },
    params: {},
  }) as unknown as RouteMatch;

const makeMatcher = (matchPath: string, match: RouteMatch = makeMatch(matchPath)): RouteMatcherShape => ({
  routes: Effect.succeed([]),
  match: (path) => Effect.succeed(path === matchPath ? Option.some(match) : Option.none()),
});

const makeBoundary = (overrides: Partial<Parameters<typeof makeRouteActivationBoundary>[1]> = {}) =>
  makeRouteActivationBoundary(
    { interruptStaleLoads: true },
    {
      matcher: makeMatcher("/docs"),
      collectPrefetchTargets: () => [],
      isComponentLoader: () => false,
      loadComponent: () => Effect.succeed(Effect.succeed({ _tag: "Text", value: "Loaded" }) as unknown as RouteComponent),
      runRoutePrefetch: () => Effect.void,
      resolveLoading: () => Option.none(),
      resolveError: () => Option.none(),
      resolveNotFound: () => Option.none(),
      resolveForbidden: () => Option.none(),
      runMiddleware: () => Effect.succeed({ _tag: "Continue" }),
      isStale: () => Effect.succeed(false),
      ...overrides,
    },
  );

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

  it("controls loading fallback display for the latest activation", async () => {
    const events = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const activation = yield* makeRouteActivation({ emitTraceEvents: true });
          const events: Array<string> = [];
          yield* activation.activate(request("nav-1", "/slow"));
          yield* activation.showLoadingFallback(
            { activationId: "nav-1", path: "/slow" },
            Effect.sync(() => events.push("loading")),
          );
          return events;
        }),
      ),
    );

    expect(events).toEqual(["loading"]);
  });

  it("suppresses stale loading fallback display", async () => {
    const events = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const activation = yield* makeRouteActivation({ emitTraceEvents: true });
          const events: Array<string> = [];
          yield* activation.activate(request("nav-1", "/slow"));
          yield* activation.activate(request("nav-2", "/fast"));
          yield* activation.showLoadingFallback(
            { activationId: "nav-1", path: "/slow" },
            Effect.sync(() => events.push("stale-loading")),
          );
          return events;
        }),
      ),
    );

    expect(events).toEqual([]);
  });

  it("runs scroll work only after the activation DOM swap", async () => {
    const events = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const activation = yield* makeRouteActivation({ emitTraceEvents: true });
          const events: Array<string> = [];
          yield* activation.activate(request("nav-1", "/docs"));
          yield* activation.commitAfterDomSwap(
            { activationId: "nav-1", path: "/docs" },
            Effect.sync(() => events.push("swap")),
            Effect.sync(() => events.push("scroll")),
          );
          return events;
        }),
      ),
    );

    expect(events).toEqual(["swap", "scroll"]);
  });

  it("suppresses scroll if the activation becomes stale during DOM swap", async () => {
    const events = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const activation = yield* makeRouteActivation({ emitTraceEvents: true });
          const events: Array<string> = [];
          yield* activation.activate(request("nav-1", "/slow"));
          yield* activation.commitAfterDomSwap(
            { activationId: "nav-1", path: "/slow" },
            Effect.gen(function* () {
              events.push("swap");
              yield* activation.activate(request("nav-2", "/fast")).pipe(Effect.orDie);
            }),
            Effect.sync(() => events.push("stale-scroll")),
          );
          return events;
        }),
      ),
    );

    expect(events).toEqual(["swap"]);
  });

  it("resolves lazy loader routes to the nearest loading intent", async () => {
    const loader = (() => Promise.resolve({ default: Effect.succeed({ _tag: "Text", value: "Lazy" }) })) as ComponentInput;
    const loading = Effect.succeed({ _tag: "Text", value: "Loading" }) as unknown as ComponentInput;
    const match = makeMatch("/lazy", { component: loader, loading });
    const intent = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const boundary = yield* makeRouteActivationBoundary(
            { interruptStaleLoads: true },
            {
              matcher: makeMatcher("/lazy", match),
              collectPrefetchTargets: () => [loader],
              isComponentLoader: (component) => component === loader,
              loadComponent: () => Effect.succeed(Effect.succeed({ _tag: "Text", value: "Lazy" }) as unknown as RouteComponent),
              runRoutePrefetch: () => Effect.void,
              resolveLoading: () => Option.some(loading),
              resolveError: () => Option.none(),
              resolveNotFound: () => Option.none(),
              resolveForbidden: () => Option.none(),
              runMiddleware: () => Effect.succeed({ _tag: "Continue" }),
              isStale: () => Effect.succeed(false),
            },
          );
          return yield* boundary.resolve(request("nav-1", "/lazy"), match);
        }),
      ),
    );

    expect(intent._tag).toBe("Loading");
    if (intent._tag === "Loading") {
      expect(intent.component).toBe(loading);
    }
  });

  it("loads lazy components through RouteActivationBoundary", async () => {
    const loaded = Effect.succeed({ _tag: "Text", value: "Lazy" }) as unknown as RouteComponent;
    const component = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const match = makeMatch("/lazy");
          const boundary = yield* makeRouteActivationBoundary(
            { interruptStaleLoads: true },
            {
              matcher: makeMatcher("/lazy", match),
              collectPrefetchTargets: () => [],
              isComponentLoader: () => true,
              loadComponent: () => Effect.succeed(loaded),
              runRoutePrefetch: () => Effect.void,
              resolveLoading: () => Option.none(),
              resolveError: () => Option.none(),
              resolveNotFound: () => Option.none(),
              resolveForbidden: () => Option.none(),
              runMiddleware: () => Effect.succeed({ _tag: "Continue" }),
              isStale: () => Effect.succeed(false),
            },
          );
          return yield* boundary.loadComponent(request("nav-1", "/lazy"), (() => Promise.resolve({ default: loaded })) as ComponentInput);
        }),
      ),
    );

    expect(component).toBe(loaded);
  });

  it("normalizes lazy load failures", async () => {
    const exit = await Effect.runPromiseExit(
      unsafeEraseR(
        Effect.gen(function* () {
          const match = makeMatch("/lazy");
          const boundary = yield* makeRouteActivationBoundary(
            { interruptStaleLoads: true },
            {
              matcher: makeMatcher("/lazy", match),
              collectPrefetchTargets: () => [],
              isComponentLoader: () => true,
              loadComponent: () => Effect.fail("boom"),
              runRoutePrefetch: () => Effect.void,
              resolveLoading: () => Option.none(),
              resolveError: () => Option.none(),
              resolveNotFound: () => Option.none(),
              resolveForbidden: () => Option.none(),
              runMiddleware: () => Effect.succeed({ _tag: "Continue" }),
              isStale: () => Effect.succeed(false),
            },
          );
          return yield* boundary.loadComponent(request("nav-1", "/lazy"), (() => Promise.resolve({ default: null })) as ComponentInput);
        }),
      ),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("LazyRouteLoadError");
    }
  });

  it("prefetches lazy modules best-effort", async () => {
    const calls = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const callsRef = yield* Ref.make<Array<string>>([]);
          const loader = (() => Promise.resolve({ default: null })) as ComponentInput;
          const match = makeMatch("/lazy");
          const boundary = yield* makeRouteActivationBoundary(
            { interruptStaleLoads: true },
            {
              matcher: makeMatcher("/lazy", match),
              collectPrefetchTargets: () => [loader],
              isComponentLoader: (component) => component === loader,
              loadComponent: () => Ref.update(callsRef, (calls) => [...calls, "module"]).pipe(Effect.as(Effect.succeed({ _tag: "Text", value: "Lazy" }) as unknown as RouteComponent)),
              runRoutePrefetch: () => Ref.update(callsRef, (calls) => [...calls, "route"]),
              resolveLoading: () => Option.none(),
              resolveError: () => Option.none(),
              resolveNotFound: () => Option.none(),
              resolveForbidden: () => Option.none(),
              runMiddleware: () => Effect.succeed({ _tag: "Continue" }),
              isStale: () => Effect.succeed(false),
            },
          );
          yield* boundary.prefetch("/lazy");
          return yield* Ref.get(callsRef);
        }),
      ),
    );

    expect(calls).toEqual(["module", "route"]);
  });

  it("suppresses stale lazy load results", async () => {
    const exit = await Effect.runPromiseExit(
      unsafeEraseR(
        Effect.gen(function* () {
          const match = makeMatch("/lazy");
          const boundary = yield* makeRouteActivationBoundary(
            { interruptStaleLoads: true },
            {
              matcher: makeMatcher("/lazy", match),
              collectPrefetchTargets: () => [],
              isComponentLoader: () => true,
              loadComponent: () => Effect.succeed(Effect.succeed({ _tag: "Text", value: "Lazy" }) as unknown as RouteComponent),
              runRoutePrefetch: () => Effect.void,
              resolveLoading: () => Option.none(),
              resolveError: () => Option.none(),
              resolveNotFound: () => Option.none(),
              resolveForbidden: () => Option.none(),
              runMiddleware: () => Effect.succeed({ _tag: "Continue" }),
              isStale: () => Effect.succeed(true),
            },
          );
          return yield* boundary.loadComponent(request("nav-1", "/lazy"), (() => Promise.resolve({ default: null })) as ComponentInput);
        }),
      ),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("LazyRouteLoadError");
    }
  });

  it("selects the nearest error boundary through RouteActivationBoundary", async () => {
    const errorBoundary = Effect.succeed({ _tag: "Text", value: "Error" }) as unknown as ComponentInput;
    const intent = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const match = makeMatch("/docs");
          const boundary = yield* makeBoundary({ resolveError: () => Option.some(errorBoundary) });
          return yield* boundary.resolveErrorBoundary(request("nav-1", "/docs"), match, "boom");
        }),
      ),
    );

    expect(intent._tag).toBe("ErrorBoundary");
    if (intent._tag === "ErrorBoundary") expect(intent.component).toBe(errorBoundary);
  });

  it("selects the nearest not-found boundary through RouteActivationBoundary", async () => {
    const notFoundBoundary = Effect.succeed({ _tag: "Text", value: "Missing" }) as unknown as ComponentInput;
    const intent = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const boundary = yield* makeBoundary({ resolveNotFound: () => Option.some(notFoundBoundary) });
          return yield* boundary.resolveNotFoundBoundary(request("nav-1", "/missing"));
        }),
      ),
    );

    expect(intent._tag).toBe("NotFoundBoundary");
    if (intent._tag === "NotFoundBoundary") expect(intent.component).toBe(notFoundBoundary);
  });

  it("selects the nearest forbidden boundary through RouteActivationBoundary", async () => {
    const forbiddenBoundary = Effect.succeed({ _tag: "Text", value: "Forbidden" }) as unknown as ComponentInput;
    const intent = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const match = makeMatch("/admin");
          const boundary = yield* makeBoundary({ resolveForbidden: () => Option.some(forbiddenBoundary) });
          return yield* boundary.resolveForbiddenBoundary(request("nav-1", "/admin"), match);
        }),
      ),
    );

    expect(intent._tag).toBe("ForbiddenBoundary");
    if (intent._tag === "ForbiddenBoundary") expect(intent.component).toBe(forbiddenBoundary);
  });

  it("represents middleware redirect as a render intent", async () => {
    const intent = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const match = makeMatch("/private");
          const boundary = yield* makeBoundary({
            runMiddleware: () => Effect.succeed({ _tag: "Redirect", path: "/login", replace: true }),
          });
          return yield* boundary.resolveMiddleware(request("nav-1", "/private"), match);
        }),
      ),
    );

    expect(intent).toEqual({ _tag: "Redirect", location: "/login", replace: true });
  });

  it("represents middleware forbidden as a boundary intent", async () => {
    const forbiddenBoundary = Effect.succeed({ _tag: "Text", value: "Forbidden" }) as unknown as ComponentInput;
    const intent = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const match = makeMatch("/private");
          const boundary = yield* makeBoundary({
            runMiddleware: () => Effect.succeed({ _tag: "Forbidden" }),
            resolveForbidden: () => Option.some(forbiddenBoundary),
          });
          return yield* boundary.resolveMiddleware(request("nav-1", "/private"), match);
        }),
      ),
    );

    expect(intent._tag).toBe("ForbiddenBoundary");
    if (intent._tag === "ForbiddenBoundary") expect(intent.component).toBe(forbiddenBoundary);
  });

  it("returns NoBoundary when a boundary is missing", async () => {
    const intent = await Effect.runPromise(
      unsafeEraseR(
        Effect.gen(function* () {
          const match = makeMatch("/docs");
          const boundary = yield* makeBoundary();
          return yield* boundary.resolveErrorBoundary(request("nav-1", "/docs"), match, "boom");
        }),
      ),
    );

    expect(intent._tag).toBe("NoBoundary");
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
