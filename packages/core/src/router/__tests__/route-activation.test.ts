import { assert, describe, it } from "@effect/vitest";
import { Cause, Data, Effect, Exit, Option, Predicate, Ref } from "effect";
import * as ContractTrace from "../../contract/trace.js";
import { unsafeEraseR } from "../../internal/unsafe.js";
import { Element } from "../../primitives/element.js";
import type { RouteMatch, RouteMatcherShape } from "../matching.js";
import { MiddlewareResult, type RouteDefinition } from "../route.js";
import {
  makeRouteActivation,
  makeRouteActivationBoundary,
  RouteActivationOutcome,
  RouteActivationRenderIntent,
} from "../route-activation.js";
import type { ComponentInput, ComponentLoader, RouteComponent } from "../types.js";

class RouteDefinitionData extends Data.TaggedClass("RouteDefinition")<
  Omit<RouteDefinition, "_tag">
> {}

const request = (activationId: string, path: string) => ({
  activationId,
  path,
  query: new URLSearchParams(),
  scrollIntent: Option.none(),
});

const textRouteComponent = (value: string): RouteComponent<never> =>
  Effect.succeed(Element.Text({ content: value }));

const loaderReturning =
  (value: unknown): ComponentLoader =>
  () =>
    Promise.resolve({ default: value });

const makeDefinition = (path: string, overrides: Partial<RouteDefinition> = {}): RouteDefinition =>
  new RouteDefinitionData({
    path,
    component: undefined,
    layout: undefined,
    loading: undefined,
    error: undefined,
    notFound: undefined,
    forbidden: undefined,
    middleware: [],
    prefetch: [],
    children: [],
    paramsSchema: undefined,
    querySchema: undefined,
    renderStrategy: undefined,
    scrollStrategy: undefined,
    ...overrides,
  });

const makeMatch = (path: string, definition: Partial<RouteDefinition> = {}): RouteMatch => ({
  route: {
    path,
    ancestors: [],
    definition: makeDefinition(path, definition),
  },
  params: {},
});

const makeMatcher = (
  matchPath: string,
  match: RouteMatch = makeMatch(matchPath),
): RouteMatcherShape => ({
  routes: Effect.succeed([]),
  match: (path) => Effect.succeed(path === matchPath ? Option.some(match) : Option.none()),
});

const traceEventsFor = Effect.fn("RouteActivationTest.traceEventsFor")(function* <E, R>(
  effect: Effect.Effect<void, E, R>,
) {
  const collector = yield* ContractTrace.createInMemoryCollector("route-activation");
  yield* ContractTrace.withCollector(effect, collector);
  return yield* collector.snapshot;
});

const eventNames = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
): ReadonlyArray<ContractTrace.ContractTraceEventName> =>
  records.map((record) => record.event.event);

const makeBoundary = (overrides: Partial<Parameters<typeof makeRouteActivationBoundary>[1]> = {}) =>
  makeRouteActivationBoundary(
    { interruptStaleLoads: true },
    {
      matcher: makeMatcher("/docs"),
      collectPrefetchTargets: () => [],
      isComponentLoader: () => false,
      loadComponent: () => Effect.succeed(textRouteComponent("Loaded")),
      runRoutePrefetch: () => Effect.void,
      resolveLoading: () => Option.none(),
      resolveError: () => Option.none(),
      resolveNotFound: () => Option.none(),
      resolveForbidden: () => Option.none(),
      runMiddleware: () => Effect.succeed(MiddlewareResult.Continue()),
      isStale: () => Effect.succeed(false),
      ...overrides,
    },
  );

describe("RouteActivation", () => {
  it.effect("commits the latest activation", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* makeRouteActivation({ emitTraceEvents: true });
        yield* activation.activate(request("nav-1", "/docs"));
        const outcome = yield* activation.commit({ activationId: "nav-1", path: "/docs" });

        assert.isTrue(Predicate.isTagged(outcome, "Committed"));
        if (Predicate.isTagged(outcome, "Committed")) {
          assert.strictEqual(outcome.activationId, "nav-1");
          assert.strictEqual(outcome.path, "/docs");
        }
      }),
    ),
  );

  it.effect("drops stale activations when a newer activation wins", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* makeRouteActivation({ emitTraceEvents: true });
        yield* activation.activate(request("nav-1", "/slow"));
        yield* activation.activate(request("nav-2", "/fast"));
        const outcome = yield* activation.commit({ activationId: "nav-1", path: "/slow" });

        assert.deepStrictEqual(
          outcome,
          RouteActivationOutcome.DroppedStale({ activationId: "nav-1", supersededBy: "nav-2" }),
        );
      }),
    ),
  );

  it.effect("returns NotFound when the canonical matcher has no match", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* makeRouteActivation(
          { emitTraceEvents: true },
          makeMatcher("/known"),
        );
        const outcome = yield* activation.activate(request("nav-1", "/missing"));

        assert.deepStrictEqual(
          outcome,
          RouteActivationOutcome.NotFound({ activationId: "nav-1", path: "/missing" }),
        );
      }),
    ),
  );

  it.effect("controls loading fallback display for the latest activation", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* makeRouteActivation({ emitTraceEvents: true });
        const events: Array<string> = [];
        yield* activation.activate(request("nav-1", "/slow"));
        yield* activation.showLoadingFallback(
          { activationId: "nav-1", path: "/slow" },
          Effect.sync(() => events.push("loading")),
        );

        assert.deepStrictEqual(events, ["loading"]);
      }),
    ),
  );

  it.effect("suppresses stale loading fallback display", () =>
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

        assert.deepStrictEqual(events, []);
      }),
    ),
  );

  it.effect("runs scroll work only after the activation DOM swap", () =>
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

        assert.deepStrictEqual(events, ["swap", "scroll"]);
      }),
    ),
  );

  it.effect("suppresses scroll if the activation becomes stale during DOM swap", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* makeRouteActivation({ emitTraceEvents: true });
        const events: Array<string> = [];
        yield* activation.activate(request("nav-1", "/slow"));
        yield* activation.commitAfterDomSwap(
          { activationId: "nav-1", path: "/slow" },
          Effect.gen(function* () {
            events.push("swap");
            yield* activation
              .activate(request("nav-2", "/fast"))
              .pipe(Effect.catch(() => Effect.void));
          }),
          Effect.sync(() => events.push("stale-scroll")),
        );

        assert.deepStrictEqual(events, ["swap"]);
      }),
    ),
  );

  it.effect("resolves lazy loader routes to the nearest loading intent", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const loader = loaderReturning(textRouteComponent("Lazy"));
        const loading: ComponentInput = textRouteComponent("Loading");
        const match = makeMatch("/lazy", { component: loader, loading });
        const boundary = yield* makeRouteActivationBoundary(
          { interruptStaleLoads: true },
          {
            matcher: makeMatcher("/lazy", match),
            collectPrefetchTargets: () => [loader],
            isComponentLoader: (component) => component === loader,
            loadComponent: () => Effect.succeed(textRouteComponent("Lazy")),
            runRoutePrefetch: () => Effect.void,
            resolveLoading: () => Option.some(loading),
            resolveError: () => Option.none(),
            resolveNotFound: () => Option.none(),
            resolveForbidden: () => Option.none(),
            runMiddleware: () => Effect.succeed(MiddlewareResult.Continue()),
            isStale: () => Effect.succeed(false),
          },
        );
        const intent = yield* boundary.resolve(request("nav-1", "/lazy"), match);

        assert.isTrue(Predicate.isTagged(intent, "Loading"));
        if (Predicate.isTagged(intent, "Loading")) {
          assert.strictEqual(intent.component, loading);
        }
      }),
    ),
  );

  it.effect("loads lazy components through RouteActivationBoundary", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const loaded = textRouteComponent("Lazy");
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
            runMiddleware: () => Effect.succeed(MiddlewareResult.Continue()),
            isStale: () => Effect.succeed(false),
          },
        );
        const component = yield* boundary.loadComponent(
          request("nav-1", "/lazy"),
          loaderReturning(loaded),
        );

        assert.strictEqual(component, loaded);
      }),
    ),
  );

  it.effect("normalizes lazy load failures", () =>
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
            runMiddleware: () => Effect.succeed(MiddlewareResult.Continue()),
            isStale: () => Effect.succeed(false),
          },
        );
        const exit = yield* Effect.exit(
          boundary.loadComponent(request("nav-1", "/lazy"), loaderReturning(null)),
        );

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.include(Cause.pretty(exit.cause), "LazyRouteLoadError");
        }
      }),
    ),
  );

  it.effect("prefetches lazy modules best-effort", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const callsRef = yield* Ref.make<Array<string>>([]);
        const loader = loaderReturning(null);
        const match = makeMatch("/lazy");
        const boundary = yield* makeRouteActivationBoundary(
          { interruptStaleLoads: true },
          {
            matcher: makeMatcher("/lazy", match),
            collectPrefetchTargets: () => [loader],
            isComponentLoader: (component) => component === loader,
            loadComponent: () =>
              Ref.update(callsRef, (calls) => [...calls, "module"]).pipe(
                Effect.as(textRouteComponent("Lazy")),
              ),
            runRoutePrefetch: () => Ref.update(callsRef, (calls) => [...calls, "route"]),
            resolveLoading: () => Option.none(),
            resolveError: () => Option.none(),
            resolveNotFound: () => Option.none(),
            resolveForbidden: () => Option.none(),
            runMiddleware: () => Effect.succeed(MiddlewareResult.Continue()),
            isStale: () => Effect.succeed(false),
          },
        );
        yield* boundary.prefetch("/lazy");
        const calls = yield* Ref.get(callsRef);

        assert.deepStrictEqual(calls, ["module", "route"]);
      }),
    ),
  );

  it.effect("suppresses stale lazy load results", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const match = makeMatch("/lazy");
        const boundary = yield* makeRouteActivationBoundary(
          { interruptStaleLoads: true },
          {
            matcher: makeMatcher("/lazy", match),
            collectPrefetchTargets: () => [],
            isComponentLoader: () => true,
            loadComponent: () => Effect.succeed(textRouteComponent("Lazy")),
            runRoutePrefetch: () => Effect.void,
            resolveLoading: () => Option.none(),
            resolveError: () => Option.none(),
            resolveNotFound: () => Option.none(),
            resolveForbidden: () => Option.none(),
            runMiddleware: () => Effect.succeed(MiddlewareResult.Continue()),
            isStale: () => Effect.succeed(true),
          },
        );
        const exit = yield* Effect.exit(
          boundary.loadComponent(request("nav-1", "/lazy"), loaderReturning(null)),
        );

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.include(Cause.pretty(exit.cause), "LazyRouteLoadError");
        }
      }),
    ),
  );

  it.effect("selects the nearest error boundary through RouteActivationBoundary", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const errorBoundary: ComponentInput = textRouteComponent("Error");
        const match = makeMatch("/docs");
        const boundary = yield* makeBoundary({ resolveError: () => Option.some(errorBoundary) });
        const intent = yield* boundary.resolveErrorBoundary(
          request("nav-1", "/docs"),
          match,
          "boom",
        );

        assert.isTrue(Predicate.isTagged(intent, "ErrorBoundary"));
        if (Predicate.isTagged(intent, "ErrorBoundary")) {
          assert.strictEqual(intent.component, errorBoundary);
        }
      }),
    ),
  );

  it.effect("selects the nearest not-found boundary through RouteActivationBoundary", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const notFoundBoundary: ComponentInput = textRouteComponent("Missing");
        const boundary = yield* makeBoundary({
          resolveNotFound: () => Option.some(notFoundBoundary),
        });
        const intent = yield* boundary.resolveNotFoundBoundary(request("nav-1", "/missing"));

        assert.isTrue(Predicate.isTagged(intent, "NotFoundBoundary"));
        if (Predicate.isTagged(intent, "NotFoundBoundary")) {
          assert.strictEqual(intent.component, notFoundBoundary);
        }
      }),
    ),
  );

  it.effect("selects the nearest forbidden boundary through RouteActivationBoundary", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const forbiddenBoundary: ComponentInput = textRouteComponent("Forbidden");
        const match = makeMatch("/admin");
        const boundary = yield* makeBoundary({
          resolveForbidden: () => Option.some(forbiddenBoundary),
        });
        const intent = yield* boundary.resolveForbiddenBoundary(request("nav-1", "/admin"), match);

        assert.isTrue(Predicate.isTagged(intent, "ForbiddenBoundary"));
        if (Predicate.isTagged(intent, "ForbiddenBoundary")) {
          assert.strictEqual(intent.component, forbiddenBoundary);
        }
      }),
    ),
  );

  it.effect("represents middleware redirect as a render intent", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const match = makeMatch("/private");
        const boundary = yield* makeBoundary({
          runMiddleware: () =>
            Effect.succeed(MiddlewareResult.Redirect({ path: "/login", replace: true })),
        });
        const intent = yield* boundary.resolveMiddleware(request("nav-1", "/private"), match);

        assert.deepStrictEqual(
          intent,
          RouteActivationRenderIntent.Redirect({ location: "/login", replace: true }),
        );
      }),
    ),
  );

  it.effect("represents middleware forbidden as a boundary intent", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const forbiddenBoundary: ComponentInput = textRouteComponent("Forbidden");
        const match = makeMatch("/private");
        const boundary = yield* makeBoundary({
          runMiddleware: () => Effect.succeed(MiddlewareResult.Forbidden()),
          resolveForbidden: () => Option.some(forbiddenBoundary),
        });
        const intent = yield* boundary.resolveMiddleware(request("nav-1", "/private"), match);

        assert.isTrue(Predicate.isTagged(intent, "ForbiddenBoundary"));
        if (Predicate.isTagged(intent, "ForbiddenBoundary")) {
          assert.strictEqual(intent.component, forbiddenBoundary);
        }
      }),
    ),
  );

  it.effect("returns NoBoundary when a boundary is missing", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const match = makeMatch("/docs");
        const boundary = yield* makeBoundary();
        const intent = yield* boundary.resolveErrorBoundary(
          request("nav-1", "/docs"),
          match,
          "boom",
        );

        assert.isTrue(Predicate.isTagged(intent, "NoBoundary"));
      }),
    ),
  );

  it.effect("emits latest-route-wins activation traces", () =>
    unsafeEraseR(
      traceEventsFor(
        Effect.gen(function* () {
          const activation = yield* makeRouteActivation(
            { emitTraceEvents: true },
            makeMatcher("/fast"),
          );
          yield* activation.activate(request("nav-1", "/slow")).pipe(Effect.result);
          yield* activation
            .activate(request("nav-2", "/fast"))
            .pipe(Effect.catch(() => Effect.void));
          yield* activation.commitAfterDomSwap(
            { activationId: "nav-1", path: "/slow" },
            Effect.void,
            Effect.void,
          );
        }),
      ).pipe(
        Effect.map((records) => {
          assert.deepStrictEqual(eventNames(records), [
            "outlet.process.start",
            "outlet.match.notFound",
            "outlet.process.start",
            "outlet.match.found",
            "outlet.process.dropStale",
          ]);
          const payload = records[4]?.event.payload;
          assert.strictEqual(payload?.activationId, "nav-1");
          assert.strictEqual(payload?.path, "/slow");
          assert.strictEqual(payload?.supersededBy, "nav-2");
        }),
      ),
    ),
  );

  it.effect("emits lazy load and boundary outcome traces", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const loaded = textRouteComponent("Lazy");
        const loader = loaderReturning(loaded);
        const loading: ComponentInput = textRouteComponent("Loading");
        const match = makeMatch("/lazy", { component: loader, loading });
        const records = yield* traceEventsFor(
          Effect.gen(function* () {
            const boundary = yield* makeBoundary({
              isComponentLoader: (component) => component === loader,
              loadComponent: () => Effect.succeed(loaded),
              resolveLoading: () => Option.some(loading),
            });
            yield* boundary.resolve(request("nav-1", "/lazy"), match);
            yield* boundary.loadComponent(request("nav-1", "/lazy"), loader);
            yield* boundary.resolveErrorBoundary(request("nav-1", "/lazy"), match, "boom");
          }),
        );

        assert.deepStrictEqual(eventNames(records), [
          "outlet.boundary.resolve",
          "outlet.lazyLeaf.load.start",
          "outlet.lazyLeaf.load.ready",
          "outlet.boundary.resolve",
        ]);
        const firstPayload = records[0]?.event.payload;
        assert.strictEqual(firstPayload?.activationId, "nav-1");
        assert.strictEqual(firstPayload?.path, "/lazy");
        assert.strictEqual(firstPayload?.phase, "render");
        assert.strictEqual(firstPayload?.outcome, "Loading");
        const lastPayload = records[3]?.event.payload;
        assert.strictEqual(lastPayload?.phase, "error");
        assert.strictEqual(lastPayload?.outcome, "NoBoundary");
      }),
    ),
  );

  it.effect("emits commit and scroll traces after DOM swap", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const events: Array<string> = [];
        const records = yield* traceEventsFor(
          Effect.gen(function* () {
            const activation = yield* makeRouteActivation({ emitTraceEvents: true });
            yield* activation.activate(request("nav-1", "/docs"));
            yield* activation.commitAfterDomSwap(
              { activationId: "nav-1", path: "/docs" },
              Effect.sync(() => events.push("swap")),
              Effect.sync(() => {
                events.push("scroll");
                return { kind: "Auto" };
              }),
            );
          }),
        );

        assert.deepStrictEqual(events, ["swap", "scroll"]);
        assert.deepStrictEqual(eventNames(records), [
          "outlet.process.start",
          "scroll.apply",
          "outlet.process.commit",
        ]);
        assert.deepStrictEqual(records[1]?.event.payload, {
          activationId: "nav-1",
          path: "/docs",
          kind: "Auto",
        });
      }),
    ),
  );

  it.effect("integrates with the canonical matcher for matched routes", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* makeRouteActivation(
          { emitTraceEvents: true },
          makeMatcher("/known"),
        );
        const outcome = yield* activation.activate(request("nav-1", "/known"));

        assert.isTrue(Predicate.isTagged(outcome, "Committed"));
        if (Predicate.isTagged(outcome, "Committed")) {
          assert.strictEqual(outcome.activationId, "nav-1");
          assert.strictEqual(outcome.path, "/known");
        }
      }),
    ),
  );
});
