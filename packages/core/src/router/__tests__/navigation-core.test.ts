import { assert, describe, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import * as Signal from "../../primitives/signal.js";
import {
  makeInMemoryNavigationAdapter,
  makeNavigationCore,
  navigationTarget,
  sameQuery,
  type NavigationCoreShape,
} from "../navigation-core.js";
import * as Router from "../service.js";

const makeCore = (initialPath: string): Effect.Effect<NavigationCoreShape> =>
  Effect.gen(function* () {
    const adapter = yield* makeInMemoryNavigationAdapter(initialPath).pipe(Effect.orDie);
    return yield* makeNavigationCore({ notifyUnchangedQuery: false }, adapter).pipe(Effect.orDie);
  });

const runNavigationLaws = (name: string, make: () => Effect.Effect<NavigationCoreShape>): void => {
  describe(name, () => {
    it.effect("push updates path and query", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/users", { query: { tab: "main" } }));
        const snapshot = yield* core.current;

        assert.strictEqual(snapshot.path, "/users");
        assert.strictEqual(snapshot.query.get("tab"), "main");
      }),
    );

    it.effect("replace updates current entry without adding history", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/first"));
        yield* core.navigate(navigationTarget("/second", { replace: true }));
        yield* core.back;
        const snapshot = yield* core.current;

        assert.strictEqual(snapshot.path, "/dashboard");
      }),
    );

    it.effect("back and forward move through adapter history", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/first"));
        yield* core.navigate(navigationTarget("/second"));
        yield* core.back;
        assert.strictEqual((yield* core.current).path, "/first");
        yield* core.forward;
        assert.strictEqual((yield* core.current).path, "/second");
      }),
    );

    it.effect("interpolates params before committing navigation", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/users/:id", { params: { id: 42 } }));

        assert.strictEqual((yield* core.current).path, "/users/42");
      }),
    );

    it.effect("checks exact and prefix active targets", () =>
      Effect.gen(function* () {
        const core = yield* make();
        yield* core.navigate(navigationTarget("/users/:id", { params: { id: 42 } }));

        assert.isTrue(yield* core.isActive(navigationTarget("/users"), false));
        assert.isFalse(yield* core.isActive(navigationTarget("/users"), true));
        assert.isTrue(yield* core.isActive(navigationTarget("/users/:id", { params: { id: 42 } }), true));
      }),
    );

    it.effect("detects unchanged and changed semantic query values", () =>
      Effect.gen(function* () {
        const core = yield* make();
        const initial = yield* core.current;
        yield* core.navigate(navigationTarget("/dashboard", { query: { tab: "main" } }));
        const same = yield* core.current;
        yield* core.navigate(navigationTarget("/dashboard", { query: { tab: "details" } }));
        const changed = yield* core.current;

        assert.isTrue(sameQuery(initial.query, same.query));
        assert.isFalse(sameQuery(same.query, changed.query));
      }),
    );
  });
};

runNavigationLaws("NavigationCore in-memory laws", () => makeCore("/dashboard?tab=main"));

describe("Router.testLayer NavigationCore delegation", () => {
  it.effect("does not notify query subscribers when the semantic query is unchanged", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      const notifications = yield* Ref.make(0);
      const unsubscribe = yield* Signal.subscribe(router.query, () =>
        Ref.update(notifications, (count) => count + 1),
      );

      yield* router.navigate("/users", { query: { tab: "main" } });

      assert.strictEqual(yield* Ref.get(notifications), 0);
      yield* unsubscribe;
    }).pipe(Effect.provide(Router.testLayer("/dashboard?tab=main"))),
  );

  it.effect("delegates push, replace, back, forward, params, and active checks through the facade", () =>
    Effect.gen(function* () {
      const router = yield* Router.Router;
      yield* router.navigate("/users/:id", { params: { id: 1 }, query: { tab: "main" } });
      yield* router.navigate("/users/:id/details", { params: { id: 1 } });
      yield* router.back();
      assert.strictEqual((yield* Signal.get(router.current)).path, "/users/1");
      yield* router.forward();
      assert.strictEqual((yield* Signal.get(router.current)).path, "/users/1/details");

      const active = yield* router.isActive("/users/:id", { params: { id: 1 } });
      assert.isTrue(yield* Signal.get(active));

      yield* router.navigate("/replace-me");
      yield* router.navigate("/replacement", { replace: true });
      yield* router.back();
      assert.strictEqual((yield* Signal.get(router.current)).path, "/users/1/details");
    }).pipe(Effect.provide(Router.testLayer("/"))),
  );
});
