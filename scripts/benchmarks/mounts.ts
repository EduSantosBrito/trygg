import { Deferred, Effect, Layer, Scope } from "effect";
import * as References from "effect/References";
import {
  browserLayer,
  Component,
  Element,
  intrinsic,
  Portal,
  Renderer,
  Signal,
} from "../../packages/core/dist/index.js";

/** Independent renderer acquisitions, including dynamic portals and reactive listeners. */
export const runCycle = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let acquired = 0;
      let released = 0;
      let events = 0;
      for (let index = 0; index < 10; index++) {
        const root = document.createElement("div");
        const changed = yield* Deferred.make<void>();
        const beforePortals = document.querySelectorAll("[data-portal-container]").length;
        const Probe = Component.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              acquired++;
            }),
            () =>
              Effect.sync(() => {
                released++;
              }),
          );
          const count = yield* Signal.make(0);
          const rows = yield* Effect.forEach(Array.from({ length: 100 }), () =>
            Signal.derive(count, String).pipe(
              Effect.map((value) =>
                intrinsic("span", { "data-probe-row": "", "data-count": value }, []),
              ),
            ),
          );
          const Overlay = yield* Portal.make(
            intrinsic("span", { "data-probe-portal": "", "data-count": count }, []),
          );
          return Element.Fragment({
            children: [
              intrinsic(
                "button",
                {
                  onClick: () =>
                    Signal.update(count, (value) => value + 1).pipe(
                      Effect.andThen(
                        Effect.sync(() => {
                          events++;
                        }),
                      ),
                      Effect.andThen(Deferred.succeed(changed, undefined)),
                    ),
                },
                [Element.Text({ content: "update" })],
              ),
              ...rows,
              Overlay({}),
            ],
          });
        }).pipe(Component.provide(Layer.effect(Scope.Scope, Effect.scope)));

        const button = yield* Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => document.body.appendChild(root)),
            () => Effect.sync(() => root.remove()),
          );
          const renderer = yield* Renderer;
          yield* renderer.mount(root, Probe({}));
          const button = root.querySelector("button");
          if (button === null) throw new Error("Independent mount did not render its button");
          button.click();
          yield* Deferred.await(changed);
          const rows = root.querySelectorAll("[data-probe-row]");
          if (
            rows.length !== 100 ||
            Array.from(rows).some((row) => row.getAttribute("data-count") !== "1")
          )
            throw new Error("Independent mount did not update every reactive row");
          if (document.querySelector("[data-probe-portal]")?.getAttribute("data-count") !== "1")
            throw new Error("Independent mount did not update its dynamic portal");
          return button;
        }).pipe(Effect.provide(browserLayer), Effect.scoped);

        if (
          root.childNodes.length !== 0 ||
          document.querySelectorAll("[data-portal-container]").length !== beforePortals
        )
          throw new Error("Independent mount retained DOM or a portal after Scope close");
        const priorEvents = events;
        // Retaining and clicking a detached node must not retain an active callback.
        button.click();
        if (events !== priorEvents) throw new Error("A disposed mount still accepts events");
        if (released !== acquired)
          throw new Error("A disposed mount retained a component resource");
      }
      return {
        mounts: acquired,
        releases: released,
        events,
        rowsPerMount: 100,
        portalsPerMount: 1,
      };
    }).pipe(
      Effect.provideService(References.MinimumLogLevel, "None"),
      Effect.timeout("30 seconds"),
    ),
  );
