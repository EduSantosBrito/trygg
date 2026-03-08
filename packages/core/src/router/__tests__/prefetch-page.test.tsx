import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { text } from "../../primitives/element.js";
import { render } from "../../testing/index.js";
import { browser as domBrowser } from "../../platform/dom.js";
import { test as eventTargetTest } from "../../platform/event-target.js";
import { test as historyTest } from "../../platform/history.js";
import { test as idleTest } from "../../platform/idle.js";
import { test as locationTest } from "../../platform/location.js";
import { Observer } from "../../platform/observer.js";
import { test as scrollTest } from "../../platform/scroll.js";
import { localStorageTest, sessionStorageTest } from "../../platform/storage.js";
import { Outlet } from "../outlet.js";
import * as Route from "../route.js";
import * as Routes from "../routes.js";
import * as Router from "../service.js";
import PrefetchPage from "../../../../../apps/examples/app/pages/prefetch.tsx";

const makeDomRect = () =>
  Object.setPrototypeOf(
    { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 },
    DOMRectReadOnly.prototype,
  );

const makeNodeList = (nodes: ReadonlyArray<Node>) =>
  Effect.sync(() => {
    const fragment = document.createDocumentFragment();
    for (const node of nodes) {
      fragment.appendChild(node.cloneNode(true));
    }
    return fragment.childNodes;
  });

describe("Prefetch page", () => {
  it.effect("should simulate the examples prefetch page trigger conditions", () =>
    Effect.gen(function* () {
      const intersectionHandlerRef = yield* Ref.make<(target: Element) => Effect.Effect<void>>(
        () => Effect.void,
      );
      const mutationHandlerRef = yield* Ref.make<
        (target: Node, added: ReadonlyArray<Node>) => Effect.Effect<void>
      >(() => Effect.void);

      const log = yield* Ref.make<ReadonlyArray<string>>([]);
      const track = (path: string) => Ref.update(log, (paths) => [...paths, path]);

      const routes = Routes.make()
        .add(Route.make("/").component(Effect.succeed(text("Home"))))
        .add(
          Route.make("/counter")
            .prefetch(() => track("/counter"))
            .component(Effect.succeed(text("Counter"))),
        )
        .add(
          Route.make("/todo")
            .prefetch(() => track("/todo"))
            .component(Effect.succeed(text("Todo"))),
        )
        .add(
          Route.make("/form")
            .prefetch(() => track("/form"))
            .component(Effect.succeed(text("Form"))),
        )
        .add(
          Route.make("/theme")
            .prefetch(() => track("/theme"))
            .component(Effect.succeed(text("Theme"))),
        )
        .add(
          Route.make("/dashboard")
            .prefetch(() => track("/dashboard"))
            .component(Effect.succeed(text("Dashboard"))),
        );

      const platformLayer = Layer.mergeAll(
        domBrowser,
        locationTest("/"),
        historyTest,
        sessionStorageTest,
        localStorageTest,
        scrollTest,
        eventTargetTest,
        Layer.succeed(
          Observer,
          Observer.of({
            intersection: (options) =>
              Effect.gen(function* () {
                yield* Ref.set(intersectionHandlerRef, (target) =>
                  options.onIntersect({
                    target,
                    isIntersecting: true,
                    intersectionRatio: 1,
                    boundingClientRect: makeDomRect(),
                    intersectionRect: makeDomRect(),
                    rootBounds: makeDomRect(),
                    time: 0,
                  }),
                );

                return {
                  observe: (_target) => Effect.void,
                  unobserve: (_target) => Effect.void,
                };
              }),
            mutation: (target, _options, handler) =>
              Ref.set(mutationHandlerRef, (_mutationTarget, added) =>
                Effect.gen(function* () {
                  if (_mutationTarget !== target) return;

                  const addedNodes = yield* makeNodeList(added);
                  const removedNodes = yield* makeNodeList([]);

                  yield* handler([
                    {
                      addedNodes,
                      attributeName: null,
                      attributeNamespace: null,
                      nextSibling: null,
                      oldValue: null,
                      previousSibling: null,
                      removedNodes,
                      target,
                      type: "childList",
                    },
                  ]);
                }),
              ),
          }),
        ),
        idleTest,
      );
      const routerLayer = Layer.provide(Router.browserLayer, platformLayer);

      const app = (
        <>
          <PrefetchPage />
          <Outlet routes={routes.manifest} />
        </>
      );

      const { container, getByText } = yield* render(app).pipe(Effect.provide(routerLayer));

      const viewportSnapshot = container.cloneNode(true);
      if (!(viewportSnapshot instanceof HTMLDivElement)) {
        assert.fail("Expected cloned prefetch page snapshot to be an HTMLDivElement");
        return;
      }

      yield* Ref.get(mutationHandlerRef).pipe(
        Effect.flatMap((trigger) => trigger(document.body, [viewportSnapshot])),
      );

      yield* Effect.yieldNow;

      assert.deepStrictEqual(yield* Ref.get(log), ["/form"]);

      const intentLink = yield* getByText("Counter →");
      const topViewportLink = viewportSnapshot.querySelector('[data-trygg-prefetch-path="/todo"]');
      if (!(topViewportLink instanceof HTMLAnchorElement)) {
        assert.fail("Expected top viewport link in prefetch page snapshot");
        return;
      }
      const belowFoldViewportLink = viewportSnapshot.querySelector(
        '[data-trygg-prefetch-path="/dashboard"]',
      );
      if (!(belowFoldViewportLink instanceof HTMLAnchorElement)) {
        assert.fail("Expected below-fold viewport link in prefetch page snapshot");
        return;
      }

      intentLink.dispatchEvent(new Event("pointermove"));
      yield* TestClock.adjust(60);
      assert.deepStrictEqual(yield* Ref.get(log), ["/form", "/counter"]);

      const triggerIntersection = (target: Element) =>
        Ref.get(intersectionHandlerRef).pipe(Effect.flatMap((f) => f(target)));

      yield* triggerIntersection(topViewportLink);
      yield* Effect.yieldNow;
      assert.deepStrictEqual(yield* Ref.get(log), ["/form", "/counter", "/todo"]);

      yield* triggerIntersection(belowFoldViewportLink);
      yield* Effect.yieldNow;
      assert.deepStrictEqual(yield* Ref.get(log), ["/form", "/counter", "/todo", "/dashboard"]);

      assert.isFalse((yield* Ref.get(log)).includes("/theme"));
    }),
  );
});
