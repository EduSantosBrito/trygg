/**
 * Provide Context Merging Tests
 *
 * Verifies that nested Provide elements merge contexts rather than replacing them.
 * Bug: renderer.ts Provide handler passed providedContext directly to renderElement,
 * discarding parent context. This broke nested service provision when Provide
 * elements carry only their own services (not the full ambient context).
 *
 * The bug is masked in Component.gen().provide() because buildContextFromLayers
 * captures the full ambient context. But it manifests when Provide elements
 * carry partial contexts (e.g. manual provideElement or future refactors).
 *
 * The outlet.ts code has explicit workarounds (lines 704, 727) confirming this bug.
 */
import { describe, effect } from "@effect/vitest";
import { Deferred, Effect, Layer, Context } from "effect";
import * as Component from "../component.js";
import { Element } from "../element.js";
import { click, render } from "../../testing/index.js";
import { unsafeWidenContext } from "../../internal/unsafe.js";

// Two distinct services
class ThemeService extends Context.Service<ThemeService, { readonly color: string }>()(
  "test/ThemeService",
) {}
class AuthService extends Context.Service<AuthService, { readonly user: string }>()(
  "test/AuthService",
) {}

// Create a Provide element wrapping a child with a partial context.
const wrapProvide = <I, S>(key: Context.Key<I, S>, value: S, child: Element): Element =>
  Element.Provide({ context: unsafeWidenContext(Context.make(key, value)), child });

describe("Provide context merging", () => {
  effect("nested Provide elements merge contexts for event handlers", () =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<string>();

      // Button whose handler accesses AuthService at click time via Runtime.runFork
      const button = (
        <button
          data-testid="btn"
          onClick={() =>
            Effect.gen(function* () {
              const auth = yield* AuthService;
              yield* Deferred.succeed(result, auth.user);
            })
          }
        >
          click
        </button>
      );

      // Manually nest two Provide elements with PARTIAL contexts.
      // Inner provides Theme only, outer provides Auth only.
      // The renderer must merge them so the button handler sees both.
      const tree = wrapProvide(
        AuthService,
        { user: "alice" },
        wrapProvide(ThemeService, { color: "blue" }, button),
      );

      const { getByTestId } = yield* render(tree);
      const btn = yield* getByTestId("btn");
      yield* click(btn);
      yield* Effect.yieldNow;

      const value = yield* Deferred.await(result);
      yield* Effect.sync(() => {
        if (value !== "alice") {
          throw new Error(`Expected "alice" but got "${value}"`);
        }
      });
    }),
  );

  effect("inner Provide overrides same service from outer (last-write-wins)", () =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<string>();

      const button = (
        <button
          data-testid="btn"
          onClick={() =>
            Effect.gen(function* () {
              const theme = yield* ThemeService;
              yield* Deferred.succeed(result, theme.color);
            })
          }
        >
          click
        </button>
      );

      // Outer provides Theme=blue, inner provides Theme=red
      // Inner should win (last-write-wins / closer scope)
      const tree = wrapProvide(
        ThemeService,
        { color: "blue" },
        wrapProvide(ThemeService, { color: "red" }, button),
      );

      const { getByTestId } = yield* render(tree);
      const btn = yield* getByTestId("btn");
      yield* click(btn);
      yield* Effect.yieldNow;

      const value = yield* Deferred.await(result);
      yield* Effect.sync(() => {
        if (value !== "red") {
          throw new Error(`Expected "red" but got "${value}"`);
        }
      });
    }),
  );

  effect("Component.provide() nesting preserves all ancestor services in event handlers", () =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<string>();

      // Inner renders button whose handler accesses Auth at click time
      const Inner = Component.gen(function* () {
        return (
          <button
            data-testid="btn"
            onClick={() =>
              Effect.gen(function* () {
                const auth = yield* AuthService;
                yield* Deferred.succeed(result, auth.user);
              })
            }
          >
            click
          </button>
        );
      });

      const Outer = Component.gen(function* () {
        return <Inner />;
      }).provide(Layer.succeed(ThemeService, { color: "blue" }));

      const App = Component.gen(function* () {
        return <Outer />;
      }).provide(Layer.succeed(AuthService, { user: "alice" }));

      const { getByTestId } = yield* render(<App />);
      const btn = yield* getByTestId("btn");
      yield* click(btn);
      yield* Effect.yieldNow;

      const value = yield* Deferred.await(result);
      yield* Effect.sync(() => {
        if (value !== "alice") {
          throw new Error(`Expected "alice" but got "${value}"`);
        }
      });
    }),
  );
});
