import { assert, describe } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import { scoped } from "../../testing/effect-vitest.js";
import * as Component from "../component.js";
import * as Head from "../head.js";
import { browserLayer, Renderer } from "../renderer.js";

class DocumentChildError extends Schema.TaggedError<DocumentChildError>()("DocumentChildError", {
  message: Schema.String,
}) {}

describe("document render rollback", () => {
  scoped("should restore document mutations when a later child fails", () =>
    Effect.gen(function* () {
      // Scope: covers attributes, child mounts, subscriptions, and the root anchor as one acquisition.
      // Assertion: failure restores the exact prior document and finalizes already-rendered children.
      const previousHtmlAttribute = document.documentElement.getAttribute("data-rollback");
      const previousBodyClass = document.body.getAttribute("class");
      const previousBody = document.body.innerHTML;
      document.body.innerHTML = '<main data-testid="document-existing">existing</main>';
      const baselineBody = document.body.innerHTML;
      let finalized = 0;

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          document.body.innerHTML = previousBody;
          if (previousHtmlAttribute === null) {
            document.documentElement.removeAttribute("data-rollback");
          } else {
            document.documentElement.setAttribute("data-rollback", previousHtmlAttribute);
          }
          if (previousBodyClass === null) {
            document.body.removeAttribute("class");
          } else {
            document.body.setAttribute("class", previousBodyClass);
          }
        }),
      );

      const Acquired = Component.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            finalized++;
          }),
        );
        return <section data-testid="document-acquired">new</section>;
      });
      const Failing = Component.gen(function* () {
        return yield* new DocumentChildError({ message: "document child failed" });
      });

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const renderer = yield* Renderer;
          yield* Head.enableDocumentMount;
          yield* renderer.mount(
            document.body,
            <html data-rollback="changed">
              <body className="changed">
                <Acquired />
                <Failing />
              </body>
            </html>,
          );
        }).pipe(Effect.provide(browserLayer)),
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(
        document.documentElement.getAttribute("data-rollback"),
        previousHtmlAttribute,
      );
      assert.strictEqual(document.body.getAttribute("class"), previousBodyClass);
      assert.strictEqual(document.body.innerHTML, baselineBody);
      assert.strictEqual(finalized, 1);
      assert.isNull(document.querySelector('[data-testid="document-acquired"]'));
    }),
  );
});
