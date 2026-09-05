import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Equal, Exit, Schema } from "effect";
import * as Signal from "../../primitives/signal.js";
import * as Component from "../../primitives/component.js";
import { TestClock } from "effect/testing";
import { render } from "../../testing/index.js";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
import * as Router from "../service.js";
import { Outlet } from "../outlet.js";

class MiddlewareFailure extends Schema.TaggedError<MiddlewareFailure>()("MiddlewareFailure", {}) {}

describe("middleware Cause at the rendered route boundary", () => {
  const failure = new MiddlewareFailure();
  const boundaryCases: ReadonlyArray<{
    readonly name: string;
    readonly cause: Cause.Cause<MiddlewareFailure | Route.RouterRedirectError>;
  }> = [
    { name: "typed failure", cause: Cause.fail(failure) },
    { name: "defect", cause: Cause.die("middleware defect") },
    {
      name: "mixed failure and defect",
      cause: Cause.combine(Cause.fail(failure), Cause.die("mixed")),
    },
    {
      name: "redirect mixed with defect",
      cause: Cause.combine(
        Cause.fail(new Route.RouterRedirectError({ path: "/login", replace: false })),
        Cause.die("redirect defect"),
      ),
    },
  ];

  it.effect.each(boundaryCases)(
    "should preserve $name through a rendered error Component",
    ({ cause }) =>
      Effect.gen(function* () {
        // Scope: production middleware, route activation, Outlet and error Component execute together.
        // Assertion: the boundary observes the original Cause; the protected page is never built.
        const observed: Array<Cause.Cause<unknown>> = [];
        let emitted: Cause.Cause<unknown> | undefined;
        let pageRenders = 0;
        const Page = Component.gen(function* () {
          pageRenders++;
          return <div>protected</div>;
        });
        const Boundary = Component.gen(function* () {
          const error = yield* Router.currentError;
          observed.push(error.cause);
          return <div data-testid="route-error">{error.path}</div>;
        });
        const manifest = Routes.make().add(
          Route.make("/guarded")
            .middleware(
              Effect.failCause(cause).pipe(
                Effect.tapCause((terminal) =>
                  Effect.sync(() => {
                    emitted = terminal;
                  }),
                ),
              ),
            )
            .component(Page)
            .error(Boundary),
        ).manifest;
        const { getByTestId } = yield* render(<Outlet routes={manifest} />).pipe(
          Effect.provide(Router.testLayer("/guarded")),
        );
        assert.strictEqual((yield* getByTestId("route-error")).textContent, "/guarded");
        assert.strictEqual(observed.length, 1);
        // Compare the emitted Cause, including runtime-added Effect stack annotations.
        assert.isDefined(emitted);
        assert.isTrue(Equal.equals(observed[0], emitted));
        assert.strictEqual(pageRenders, 0);
      }).pipe(Effect.scoped),
  );

  it.effect.each([
    { name: "pure interruption", cause: Cause.interrupt(87) },
    { name: "mixed interruption", cause: Cause.combine(Cause.fail(failure), Cause.interrupt(88)) },
  ])("should preserve $name without rendering an error fallback", ({ cause }) =>
    Effect.gen(function* () {
      // Scope: cancellation traverses the actual initial Outlet render.
      // Assertion: render fails with the same Cause and neither page nor fallback executes.
      let renders = 0;
      let emitted: Cause.Cause<unknown> | undefined;
      const Page = Component.gen(function* () {
        renders++;
        return <div>unexpected</div>;
      });
      const manifest = Routes.make().add(
        Route.make("/guarded")
          .middleware(
            Effect.failCause(cause).pipe(
              Effect.tapCause((terminal) =>
                Effect.sync(() => {
                  emitted = terminal;
                }),
              ),
            ),
          )
          .component(Page)
          .error(Page),
      ).manifest;
      const exit = yield* render(<Outlet routes={manifest} />).pipe(
        Effect.provide(Router.testLayer("/guarded")),
        Effect.exit,
      );
      assert.isTrue(Exit.isFailure(exit));
      assert.isDefined(emitted);
      if (Exit.isFailure(exit)) assert.deepStrictEqual(exit.cause, emitted);
      assert.strictEqual(renders, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("should render the forbidden boundary for a typed middleware denial", () =>
    Effect.gen(function* () {
      // Scope: typed access denial has a dedicated rendered outcome.
      // Assertion: the forbidden Component renders, with no generic error or protected page.
      const Forbidden = Component.gen(function* () {
        return <div data-testid="forbidden">denied</div>;
      });
      const Page = Component.gen(function* () {
        return <div>unexpected</div>;
      });
      const manifest = Routes.make().add(
        Route.make("/guarded")
          .middleware(Route.routeForbidden)
          .component(Page)
          .error(Page)
          .forbidden(Forbidden),
      ).manifest;
      const { container } = yield* render(<Outlet routes={manifest} />).pipe(
        Effect.provide(Router.testLayer("/guarded")),
      );
      assert.strictEqual(container.textContent, "denied");
    }).pipe(Effect.scoped),
  );

  it.effect.each([false, true])(
    "should render the initial redirect destination with chaining=%s",
    (chained) =>
      Effect.gen(function* () {
        // Scope: the initial URL redirects before normal route-change subscriptions are active.
        // Assertion: both the router pathname and visible DOM reach the destination.
        const Login = Component.gen(function* () {
          return <div>login</div>;
        });
        const Protected = Component.gen(function* () {
          return <div>unexpected</div>;
        });
        const manifest = Routes.make()
          .add(
            Route.make("/guarded")
              .middleware(Route.routeRedirect(chained ? "/middle" : "/login"))
              .component(Protected),
          )
          .add(Route.make("/middle").middleware(Route.routeRedirect("/login")).component(Protected))
          .add(Route.make("/login").component(Login)).manifest;
        yield* Effect.gen(function* () {
          const router = yield* Router.get;
          const { container } = yield* render(<Outlet routes={manifest} />);
          yield* TestClock.adjust(0);
          assert.strictEqual(container.textContent, "login");
          assert.strictEqual((yield* Signal.peek(router.current)).path, "/login");
        }).pipe(Effect.provide(Router.testLayer("/guarded")));
      }).pipe(Effect.scoped),
  );
});
