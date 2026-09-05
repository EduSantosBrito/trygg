import { assert, describe, it } from "@effect/vitest";
import { Cause, Data, Deferred, Effect, Exit, Fiber, Option, Predicate, Ref } from "effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Trace from "../../trace/index.js";
import { unsafeEraseR } from "../../internal/unsafe.js";
import { Element } from "../../primitives/element.js";
import type { RouteMatch, RouteMatcherShape } from "../matching.js";
import { MiddlewareResult, type RouteDefinition } from "../route.js";
import {
  DuplicateRouteActivationId,
  makeNavigationActivation,
  RouteActivation,
  RouteActivationBoundary,
  RouteActivationError,
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
  const recorder = Trace.makeRecorder();
  yield* Trace.record(effect, recorder);
  return recorder.records();
});

const eventNames = (
  records: ReadonlyArray<Trace.TraceRecord>,
): ReadonlyArray<Trace.TraceEventName> => records.map((record) => record.name);

const makeBoundary = (
  overrides: Partial<Parameters<typeof RouteActivationBoundary.make>[1]> = {},
) =>
  RouteActivationBoundary.make(
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
      runWhileCurrent: (_, effect) => effect,
      ...overrides,
    },
  );

describe("RouteActivation", () => {
  it.effect("should reject malformed navigation identities before changing the current owner", () =>
    Effect.gen(function* () {
      // Scope: the internal Outlet protocol binds a safe version to its correlation label.
      // Assertion: invalid versions/aliases fail in the typed channel without consuming the next version.
      const activation = yield* makeNavigationActivation();
      yield* activation.activate(request("navigation-0", "/initial"));
      for (const [navigationId, activationId] of [
        [-1, "navigation--1"],
        [1.5, "navigation-1.5"],
        [Number.NaN, "navigation-NaN"],
        [1, "navigation-0"],
      ] satisfies ReadonlyArray<readonly [number, string]>) {
        const invalid = yield* Effect.exit(
          activation.activate({
            ...request(activationId, "/invalid"),
            scrollIntent: Option.some({
              navigationId,
              isPopstate: false,
              hash: "",
              scrollKey: "key",
            }),
          }),
        );
        assert.isTrue(Exit.hasFails(invalid));
        assert.isFalse(Exit.hasDies(invalid));
        if (Exit.isFailure(invalid)) {
          const error = Cause.findErrorOption(invalid.cause);
          assert.isTrue(Option.isSome(error));
          if (Option.isSome(error)) assert.instanceOf(error.value, RouteActivationError);
        }
        assert.deepStrictEqual(yield* activation.currentActivationId, Option.some("navigation-0"));
      }
      yield* activation.activate({
        ...request("navigation-1", "/valid"),
        scrollIntent: Option.some({
          navigationId: 1,
          isPopstate: false,
          hash: "",
          scrollKey: "key",
        }),
      });
      assert.deepStrictEqual(yield* activation.currentActivationId, Option.some("navigation-1"));
    }),
  );

  it.effect("should reject a skipped older navigation version without claiming it", () =>
    Effect.gen(function* () {
      // Scope: generated navigation IDs can skip versions when Outlet work coalesces.
      // Assertion: a previously unseen older version cannot replace the current activation.
      const activation = yield* makeNavigationActivation();
      const navigationRequest = (version: number) => ({
        ...request(`navigation-${version}`, `/page-${version}`),
        scrollIntent: Option.some({
          navigationId: version,
          isPopstate: false,
          hash: "",
          scrollKey: `key-${version}`,
        }),
      });
      yield* activation.activate(navigationRequest(10));
      yield* activation.activate(navigationRequest(20));
      const stale = yield* Effect.exit(activation.activate(navigationRequest(15)));
      assert.isTrue(Exit.hasInterrupts(stale));
      assert.deepStrictEqual(yield* activation.currentActivationId, Option.some("navigation-20"));
      const duplicate = yield* Effect.exit(activation.activate(navigationRequest(20)));
      assert.isTrue(Exit.isFailure(duplicate));
      if (Exit.isFailure(duplicate)) {
        const error = Cause.findErrorOption(duplicate.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) assert.instanceOf(error.value, DuplicateRouteActivationId);
      }
      let staleWork = 0;
      const rejected = yield* Effect.exit(
        activation.runWhileCurrent(
          "navigation-15",
          Effect.sync(() => {
            staleWork++;
          }),
        ),
      );
      assert.isTrue(Exit.hasInterrupts(rejected));
      assert.strictEqual(staleWork, 0);
    }),
  );

  it.effect("commits the latest activation", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* RouteActivation.make();
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
        const activation = yield* RouteActivation.make();
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

  it.effect(
    "rejects a duplicate activation ID while the original operation remains sole owner",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const activation = yield* RouteActivation.make();
          const swapStarted = yield* Deferred.make<void>();
          const releaseSwap = yield* Deferred.make<void>();
          const events: Array<string> = [];
          yield* activation.activate(request("nav-1", "/docs"));

          const owner = yield* Effect.forkScoped(
            activation.commitAfterDomSwap(
              { activationId: "nav-1", path: "/docs" },
              Effect.gen(function* () {
                events.push("swap");
                yield* Deferred.succeed(swapStarted, undefined).pipe(Effect.asVoid);
                yield* Deferred.await(releaseSwap);
              }),
              Effect.sync(() => events.push("scroll")),
            ),
          );
          yield* Deferred.await(swapStarted);

          const duplicate = yield* Effect.exit(activation.activate(request("nav-1", "/docs")));
          assert.isTrue(Exit.isFailure(duplicate));
          if (Exit.isFailure(duplicate)) {
            const error = Cause.findErrorOption(duplicate.cause);
            assert.isTrue(Option.isSome(error));
            if (Option.isSome(error)) assert.instanceOf(error.value, DuplicateRouteActivationId);
          }

          yield* Deferred.succeed(releaseSwap, undefined).pipe(Effect.asVoid);
          yield* Fiber.join(owner);
          assert.deepStrictEqual(events, ["swap", "scroll"]);
        }),
      ),
  );

  it.effect("keeps activation IDs single-use after their original activation completes", () =>
    Effect.gen(function* () {
      const activation = yield* RouteActivation.make();
      yield* activation.activate(request("nav-1", "/docs"));
      yield* activation.commit({ activationId: "nav-1", path: "/docs" });

      const duplicate = yield* Effect.exit(activation.activate(request("nav-1", "/other")));
      assert.isTrue(Exit.isFailure(duplicate));
      if (Exit.isFailure(duplicate)) {
        const error = Cause.findErrorOption(duplicate.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) assert.instanceOf(error.value, DuplicateRouteActivationId);
      }
    }),
  );

  it.effect("returns NotFound when the canonical matcher has no match", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* RouteActivation.make(makeMatcher("/known"));
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
        const activation = yield* RouteActivation.make();
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
        const activation = yield* RouteActivation.make();
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

  it.effect("interrupts and finalizes a superseded loading fallback", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const activation = yield* RouteActivation.make();
        const started = yield* Deferred.make<void>();
        const blocked = yield* Deferred.make<void>();
        const finalized = yield* Deferred.make<void>();
        yield* activation.activate(request("nav-1", "/slow"));
        const fiber = yield* Effect.forkScoped(
          Effect.exit(
            activation.showLoadingFallback(
              { activationId: "nav-1", path: "/slow" },
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(blocked);
              }).pipe(Effect.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid))),
            ),
          ),
        );

        yield* Deferred.await(started);
        yield* activation.activate(request("nav-2", "/fast"));
        const exit = yield* Fiber.join(fiber);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
        assert.isTrue(yield* Deferred.isDone(finalized));
      }),
    ),
  );

  it.effect("runs scroll work only after the activation DOM swap", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* RouteActivation.make();
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
        const activation = yield* RouteActivation.make();
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

  it.effect("waits for a superseded swap to finalize before the winner swaps", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const activation = yield* RouteActivation.make();
        const swapStarted = yield* Deferred.make<void>();
        const blocked = yield* Deferred.make<void>();
        const events: Array<string> = [];
        yield* activation.activate(request("nav-1", "/slow"));
        const staleFiber = yield* Effect.forkScoped(
          Effect.exit(
            activation.commitAfterDomSwap(
              { activationId: "nav-1", path: "/slow" },
              Effect.gen(function* () {
                yield* Deferred.succeed(swapStarted, undefined);
                yield* Deferred.await(blocked);
                events.push("stale-swap");
              }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    events.push("stale-finalized");
                  }),
                ),
              ),
              Effect.sync(() => events.push("stale-scroll")),
            ),
          ),
        );

        yield* Deferred.await(swapStarted);
        yield* activation.activate(request("nav-2", "/fast"));
        const winnerFiber = yield* Effect.forkScoped(
          activation.commitAfterDomSwap(
            { activationId: "nav-2", path: "/fast" },
            Effect.sync(() => events.push("winner-swap")),
            Effect.sync(() => events.push("winner-scroll")),
          ),
        );
        const staleExit = yield* Fiber.join(staleFiber);
        yield* Fiber.join(winnerFiber);

        assert.isTrue(Exit.isFailure(staleExit));
        if (Exit.isFailure(staleExit)) assert.isTrue(Cause.hasInterrupts(staleExit.cause));
        assert.deepStrictEqual(events, ["stale-finalized", "winner-swap", "winner-scroll"]);
      }),
    ),
  );

  it.effect("interrupts and finalizes superseded scroll work", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const activation = yield* RouteActivation.make();
        const scrollStarted = yield* Deferred.make<void>();
        const blocked = yield* Deferred.make<void>();
        const finalized = yield* Deferred.make<void>();
        const events: Array<string> = [];
        yield* activation.activate(request("nav-1", "/slow"));
        const fiber = yield* Effect.forkScoped(
          Effect.exit(
            activation.commitAfterDomSwap(
              { activationId: "nav-1", path: "/slow" },
              Effect.sync(() => events.push("swap")),
              Effect.gen(function* () {
                yield* Deferred.succeed(scrollStarted, undefined);
                yield* Deferred.await(blocked);
                events.push("stale-scroll");
              }).pipe(Effect.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid))),
            ),
          ),
        );

        yield* Deferred.await(scrollStarted);
        yield* activation.activate(request("nav-2", "/fast"));
        const exit = yield* Fiber.join(fiber);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
        assert.isTrue(yield* Deferred.isDone(finalized));
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
        const boundary = yield* RouteActivationBoundary.make(
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
            runWhileCurrent: (_, effect) => effect,
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
        const boundary = yield* RouteActivationBoundary.make(
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
            runWhileCurrent: (_, effect) => effect,
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
        const boundary = yield* RouteActivationBoundary.make(
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
            runWhileCurrent: (_, effect) => effect,
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
        const boundary = yield* RouteActivationBoundary.make(
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
            runWhileCurrent: (_, effect) => effect,
          },
        );
        yield* boundary.prefetch("/lazy");
        const calls = yield* Ref.get(callsRef);

        assert.deepStrictEqual(calls, ["module", "route"]);
      }),
    ),
  );

  it.effect("interrupts stale lazy load results", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const match = makeMatch("/lazy");
        const boundary = yield* RouteActivationBoundary.make(
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
            runWhileCurrent: (_, effect) => effect,
          },
        );
        const exit = yield* Effect.exit(
          boundary.loadComponent(request("nav-1", "/lazy"), loaderReturning(null)),
        );

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.isTrue(Cause.hasInterrupts(exit.cause));
        }
      }),
    ),
  );

  it.effect("interrupts and finalizes a lazy load when its activation is superseded", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const activation = yield* RouteActivation.make();
        const loadStarted = yield* Deferred.make<void>();
        const blocked = yield* Deferred.make<void>();
        const finalized = yield* Deferred.make<void>();
        yield* activation.activate(request("nav-1", "/lazy"));
        const boundary = yield* makeBoundary({
          loadComponent: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(loadStarted, undefined);
              yield* Deferred.await(blocked);
              return textRouteComponent("stale");
            }).pipe(Effect.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid))),
          isStale: (activationId) =>
            Effect.map(
              activation.currentActivationId,
              Option.match({
                onNone: () => true,
                onSome: (currentId) => currentId !== activationId,
              }),
            ),
          runWhileCurrent: activation.runWhileCurrent,
        });
        const fiber = yield* Effect.forkScoped(
          Effect.exit(boundary.loadComponent(request("nav-1", "/lazy"), loaderReturning(null))),
        );

        yield* Deferred.await(loadStarted);
        yield* activation.activate(request("nav-2", "/fast"));
        const exit = yield* Fiber.join(fiber);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
        assert.isTrue(yield* Deferred.isDone(finalized));
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
          Cause.fail("boom"),
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
          Cause.fail("boom"),
        );

        assert.isTrue(Predicate.isTagged(intent, "NoBoundary"));
      }),
    ),
  );

  it.effect("emits latest-route-wins activation traces", () =>
    unsafeEraseR(
      traceEventsFor(
        Effect.gen(function* () {
          const activation = yield* RouteActivation.make(makeMatcher("/fast"));
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
          const payload = records[4]?.payload;
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
            yield* boundary.resolveErrorBoundary(
              request("nav-1", "/lazy"),
              match,
              Cause.fail("boom"),
            );
          }),
        );

        assert.deepStrictEqual(eventNames(records), [
          "outlet.boundary.resolve",
          "outlet.lazyLeaf.load.start",
          "outlet.lazyLeaf.load.ready",
          "outlet.boundary.resolve",
        ]);
        const firstPayload = records[0]?.payload;
        assert.strictEqual(firstPayload?.activationId, "nav-1");
        assert.strictEqual(firstPayload?.path, "/lazy");
        assert.strictEqual(firstPayload?.phase, "render");
        assert.strictEqual(firstPayload?.outcome, "Loading");
        const lastPayload = records[3]?.payload;
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
            const activation = yield* RouteActivation.make();
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
        assert.deepStrictEqual(records[0]?.payload, {
          activationId: "nav-1",
          path: "/docs",
          query_type: "object",
          hasScrollIntent: false,
        });
        assert.deepStrictEqual(records[1]?.payload, {
          activationId: "nav-1",
          path: "/docs",
          result_type: "object",
        });
      }),
    ),
  );

  it.effect("does not inspect query or scroll result Proxies in any Trace mode", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        // Scope: activation telemetry with caller-controlled query and post-swap result Proxies.
        // Assertion: enabled, filtered, and logger-free Trace preserve zero property traps and identical business state.
        type TraceMode = "enabled" | "filtered" | "absent";
        const run = <A, E, R>(
          mode: TraceMode,
          effect: Effect.Effect<A, E, R>,
        ): Effect.Effect<A, E, R> =>
          mode === "enabled"
            ? Trace.record(effect, Trace.makeRecorder())
            : mode === "filtered"
              ? effect.pipe(Effect.provideService(References.MinimumLogLevel, "Fatal"))
              : effect.pipe(
                  Effect.provide(Logger.layer([])),
                  Effect.provideService(References.MinimumLogLevel, "Trace"),
                );

        const runCase = Effect.fnUntraced(function* (mode: TraceMode) {
          let queryTraps = 0;
          let queryState = "stable";
          const query = new Proxy(new URLSearchParams("token=secret"), {
            get: (target, key, receiver) => {
              queryTraps++;
              queryState = "mutated";
              // oxlint-disable-next-line effect/no-unknown-shape-probing -- The hostile Proxy must otherwise preserve target behavior.
              return Reflect.get(target, key, receiver);
            },
            getOwnPropertyDescriptor: (target, key) => {
              queryTraps++;
              queryState = "mutated";
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
            ownKeys: (target) => {
              queryTraps++;
              queryState = "mutated";
              return Reflect.ownKeys(target);
            },
          });
          let resultTraps = 0;
          const resultTarget = { kind: "Auto", state: "stable" };
          const scrollResult = new Proxy(resultTarget, {
            get: (target, key, receiver) => {
              resultTraps++;
              resultTarget.state = "mutated";
              // oxlint-disable-next-line effect/no-unknown-shape-probing -- The hostile Proxy must otherwise preserve target behavior.
              return Reflect.get(target, key, receiver);
            },
            getOwnPropertyDescriptor: (target, key) => {
              resultTraps++;
              resultTarget.state = "mutated";
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
            ownKeys: (target) => {
              resultTraps++;
              resultTarget.state = "mutated";
              return Reflect.ownKeys(target);
            },
          });
          const activation = yield* RouteActivation.make();
          let swapCalls = 0;
          let afterSwapCalls = 0;
          let outcome = "missing";
          const operation = Effect.gen(function* () {
            yield* activation.activate({
              activationId: `nav-${mode}`,
              path: "/docs",
              query,
              scrollIntent: Option.none(),
            });
            const committed = yield* activation.commitAfterDomSwap(
              { activationId: `nav-${mode}`, path: "/docs" },
              Effect.sync(() => {
                swapCalls++;
              }),
              Effect.sync(() => {
                afterSwapCalls++;
                return scrollResult;
              }),
            );
            outcome = committed._tag;
          });
          const exit = yield* run(mode, operation).pipe(Effect.exit);

          return {
            success: Exit.isSuccess(exit),
            outcome,
            swapCalls,
            afterSwapCalls,
            queryTraps,
            queryState,
            resultTraps,
            resultState: resultTarget.state,
          };
        });

        const expected = {
          success: true,
          outcome: "Committed",
          swapCalls: 1,
          afterSwapCalls: 1,
          queryTraps: 0,
          queryState: "stable",
          resultTraps: 0,
          resultState: "stable",
        };
        assert.deepStrictEqual(yield* runCase("enabled"), expected);
        assert.deepStrictEqual(yield* runCase("filtered"), expected);
        assert.deepStrictEqual(yield* runCase("absent"), expected);
      }),
    ),
  );

  it.effect("integrates with the canonical matcher for matched routes", () =>
    unsafeEraseR(
      Effect.gen(function* () {
        const activation = yield* RouteActivation.make(makeMatcher("/known"));
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
