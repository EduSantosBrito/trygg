import { assert, describe, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Component from "../../primitives/component.js";
import { text } from "../../primitives/element.js";
import * as Signal from "../../primitives/signal.js";
import { render } from "../../testing/index.js";
import { Link } from "../link.js";
import { Outlet } from "../outlet.js";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
import * as Router from "../service.js";
import type { ComponentLoader, RouteComponent } from "../types.js";

describe("Link prefetch", () => {
  it.effect("route prefetch should not run on outlet render without a prefetch trigger", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0);

      const routes = Routes.make().add(
        Route.make("/")
          .prefetch(() => Ref.update(count, (n) => n + 1))
          .component(Effect.succeed(text("Home"))),
      );

      yield* render(<Outlet routes={routes.manifest} />).pipe(
        Effect.provide(Router.testLayer("/")),
      );
      yield* Effect.yieldNow;

      assert.strictEqual(yield* Ref.get(count), 0);
    }),
  );

  it.effect("render strategy should prefetch modules after outlet registers resolver", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([]);

      const About: RouteComponent = Effect.succeed(text("About"));
      const context = yield* Effect.context<never>();
      const aboutLoader: ComponentLoader = () => {
        Effect.runSyncWith(context)(Ref.update(log, (entries) => [...entries, "about"]));
        return Promise.resolve({ default: About });
      };

      const routes = Routes.make()
        .add(Route.make("/").component(Effect.succeed(text("Home"))))
        .add(Route.make("/about").component(aboutLoader));

      const App = (
        <>
          <Link to="/about" prefetch="render">
            About
          </Link>
          <Outlet routes={routes.manifest} />
        </>
      );

      yield* render(App).pipe(Effect.provide(Router.testLayer("/")));
      yield* Effect.yieldNow;

      assert.deepStrictEqual(yield* Ref.get(log), ["about"]);
    }),
  );

  it.effect("focus prefetch should run route prefetch with decoded params and query", () =>
    Effect.gen(function* () {
      const received = yield* Ref.make<unknown>(null);

      const routes = Routes.make()
        .add(Route.make("/").component(Effect.succeed(text("Home"))))
        .add(
          Route.make("/users/:id")
            .query(Schema.Struct({ tab: Schema.String }))
            .prefetch((ctx) => Ref.set(received, ctx))
            .component(Effect.succeed(text("User"))),
        );

      const App = (
        <>
          <Link to="/users/:id" params={{ id: "123" }} query={{ tab: "posts" }} prefetch="intent">
            User
          </Link>
          <Outlet routes={routes.manifest} />
        </>
      );

      const { getByRole } = yield* render(App).pipe(Effect.provide(Router.testLayer("/")));
      const link = yield* getByRole("link");

      link.dispatchEvent(new Event("focus"));
      yield* Effect.yieldNow;

      assert.deepStrictEqual(yield* Ref.get(received), {
        params: { id: "123" },
        query: { tab: "posts" },
      });
    }),
  );

  it.effect("intent prefetch should only trigger from hover movement", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0);

      const routes = Routes.make()
        .add(Route.make("/").component(Effect.succeed(text("Home"))))
        .add(
          Route.make("/about")
            .prefetch(() => Ref.update(count, (n) => n + 1))
            .component(Effect.succeed(text("About"))),
        );

      const App = (
        <>
          <Link to="/about" prefetch="intent">
            About
          </Link>
          <Outlet routes={routes.manifest} />
        </>
      );

      const { getByRole } = yield* render(App).pipe(Effect.provide(Router.testLayer("/")));
      const link = yield* getByRole("link");

      link.dispatchEvent(new MouseEvent("mouseenter"));
      yield* TestClock.adjust(60);

      assert.strictEqual(yield* Ref.get(count), 0);

      link.dispatchEvent(new Event("pointermove"));
      yield* TestClock.adjust(60);

      assert.strictEqual(yield* Ref.get(count), 1);
    }),
  );

  it.effect("preserves Link DOM node on parent rerender", () =>
    Effect.gen(function* () {
      const parentTrigger = yield* Signal.make(0);

      const App = Component.gen(function* () {
        yield* Signal.get(parentTrigger);
        return <Link to="/about">About</Link>;
      });

      const { getByRole } = yield* render(<App />).pipe(Effect.provide(Router.testLayer("/")));
      const linkBefore = yield* getByRole("link");

      yield* Signal.set(parentTrigger, 1);
      yield* TestClock.adjust(20);

      const linkAfter = yield* getByRole("link");

      assert.strictEqual(linkAfter, linkBefore);
    }),
  );

  it.effect("preserves Link DOM node on local parent signal rerender", () =>
    Effect.gen(function* () {
      let localTrigger: Signal.Signal<number> | null = null;

      const App = Component.gen(function* () {
        const trigger = yield* Signal.make(0);
        localTrigger = trigger;
        yield* Signal.get(trigger);
        return <Link to="/about">About</Link>;
      });

      const { getByRole } = yield* render(<App />).pipe(Effect.provide(Router.testLayer("/")));
      const linkBefore = yield* getByRole("link");

      assert.isNotNull(localTrigger);

      yield* Signal.set(localTrigger, 1);
      yield* TestClock.adjust(20);

      const linkAfter = yield* getByRole("link");

      assert.strictEqual(linkAfter, linkBefore);
    }),
  );
});
