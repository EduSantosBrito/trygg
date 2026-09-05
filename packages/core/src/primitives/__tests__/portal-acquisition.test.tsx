import { assert, describe, it, vi } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Predicate, Schema, Scope } from "effect";
import * as Portal from "../portal.js";

class HostFailure extends Schema.TaggedError<HostFailure>()("HostFailure", {
  operation: Schema.String,
}) {}

describe("Portal acquisition", () => {
  it.effect.each(["createElement", "setAttribute"])(
    "should return a typed %s failure without publishing a container",
    (operation) =>
      Effect.gen(function* () {
        // Scope: native creation and configuration can fail before DOM publication.
        // Assertion: the precise operation and original exception survive in the typed channel.
        const failure = new HostFailure({ operation });
        const before = document.querySelectorAll("[data-portal-container]").length;
        const spy =
          operation === "createElement"
            ? vi.spyOn(document, "createElement").mockImplementation(() => {
                // oxlint-disable-next-line effect/no-raw-throw -- Native boundary failure injection.
                throw failure;
              })
            : vi.spyOn(HTMLElement.prototype, "setAttribute").mockImplementation(() => {
                // oxlint-disable-next-line effect/no-raw-throw -- Native boundary failure injection.
                throw failure;
              });
        const exit = yield* Portal.make(<span />).pipe(
          Effect.scoped,
          Effect.exit,
          Effect.ensuring(Effect.sync(() => spy.mockRestore())),
        );
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.isFalse(Cause.hasDies(exit.cause));
          const reason = exit.cause.reasons.find(Cause.isFailReason);
          assert.instanceOf(reason?.error, Portal.PortalDomError);
          if (reason?.error instanceof Portal.PortalDomError) {
            assert.strictEqual(reason.error.operation, operation);
            assert.strictEqual(reason.error.cause, failure);
          }
        }
        assert.strictEqual(document.querySelectorAll("[data-portal-container]").length, before);
      }),
  );

  it.effect("should interrupt acquisition into an already closed owner before allocating DOM", () =>
    Effect.gen(function* () {
      // Scope: callers can retain and provide a Scope whose lifetime has already ended.
      // Assertion: an ended owner cannot acquire a detached or published portal container.
      const owner = yield* Scope.make();
      yield* Scope.close(owner, Exit.void);
      let allocations = 0;
      const create = document.createElement.bind(document);
      const spy = vi.spyOn(document, "createElement").mockImplementation((...args) => {
        allocations++;
        return create(...args);
      });
      const exit = yield* Portal.make(<span />).pipe(
        Scope.provide(owner),
        Effect.exit,
        Effect.ensuring(Effect.sync(() => spy.mockRestore())),
      );
      assert.isTrue(Exit.hasInterrupts(exit));
      assert.strictEqual(allocations, 0);
    }),
  );

  it.effect(
    "should preserve acquisition failure and rollback defect without repeating release",
    () =>
      Effect.gen(function* () {
        // Scope: both partially committed append and container removal fail.
        // Assertion: both failures remain in Cause, sibling finalizers run, and release runs once.
        const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        const container = document.createElement("div");
        const append = document.body.appendChild.bind(document.body);
        const appendFailure = new HostFailure({ operation: "appendChild" });
        const removeFailure = new HostFailure({ operation: "remove" });
        let releases = 0;
        let siblings = 0;
        const create = vi.spyOn(document, "createElement").mockReturnValue(container);
        const insert = vi
          .spyOn(document.body, "appendChild")
          .mockImplementation(<T extends Node>(node: T): T => {
            append(node);
            // oxlint-disable-next-line effect/no-raw-throw -- Host fake mutates before reporting failure.
            throw appendFailure;
          });
        const remove = vi.spyOn(container, "remove").mockImplementation(() => {
          releases++;
          // oxlint-disable-next-line effect/no-raw-throw -- Verifies finalizer failure stays observable.
          throw removeFailure;
        });
        yield* Scope.addFinalizer(
          owner,
          Effect.sync(() => {
            siblings++;
          }),
        );
        const exit = yield* Portal.make(<span />).pipe(
          Scope.provide(owner),
          Effect.exit,
          Effect.ensuring(
            Effect.sync(() => {
              create.mockRestore();
              insert.mockRestore();
              remove.mockRestore();
              container.remove();
            }),
          ),
        );
        yield* Scope.close(owner, Exit.void);
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const failures = exit.cause.reasons.filter(Cause.isFailReason);
          const defects = exit.cause.reasons.filter(Cause.isDieReason);
          assert.strictEqual(failures.length, 1);
          assert.strictEqual(defects.length, 1);
          const failure = failures[0]?.error;
          const defect = defects[0]?.defect;
          assert.instanceOf(failure, Portal.PortalDomError);
          assert.instanceOf(defect, Portal.PortalDomError);
          if (failure instanceof Portal.PortalDomError)
            assert.strictEqual(failure.cause, appendFailure);
          if (defect instanceof Portal.PortalDomError)
            assert.strictEqual(defect.cause, removeFailure);
        }
        assert.strictEqual(releases, 1);
        assert.strictEqual(siblings, 1);
      }).pipe(Effect.scoped),
  );

  it.effect("should reject an invalid selector through the typed DOM error channel", () =>
    Effect.gen(function* () {
      // Scope: malformed CSS is external input at the portal target boundary.
      // Assertion: acquisition fails with a project-owned typed error, without a defect.
      const exit = yield* Portal.make(<span />, { target: "[" }).pipe(Effect.scoped, Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isFalse(Cause.hasDies(exit.cause));
        assert.isTrue(
          exit.cause.reasons.some(
            (reason) =>
              Cause.isFailReason(reason) && Predicate.isTagged(reason.error, "PortalDomError"),
          ),
        );
      }
    }),
  );

  it.effect("should remove an inserted container when acquisition is interrupted", () =>
    Effect.gen(function* () {
      // Scope: interruption arrives from the host append call before acquisition returns.
      // Assertion: interruption survives and the inserted container has no retained DOM owner.
      let container: Node | undefined;
      const append = document.body.appendChild.bind(document.body);
      const attempt = yield* Effect.gen(function* () {
        const fiber = yield* Effect.withFiber((current) => Effect.succeed(current));
        const spy = vi
          .spyOn(document.body, "appendChild")
          .mockImplementation(<T extends Node>(node: T): T => {
            container = node;
            const result = append(node);
            fiber.interruptUnsafe(fiber.id);
            return result;
          });
        yield* Portal.make(<span />).pipe(Effect.ensuring(Effect.sync(() => spy.mockRestore())));
      }).pipe(Effect.scoped, Effect.forkChild);
      const exit = yield* Fiber.await(attempt);
      const retained = container?.parentNode;
      // Clean up the reproduced leak even when the assertion fails.
      container?.parentNode?.removeChild(container);
      assert.isTrue(Exit.hasInterrupts(exit));
      assert.isDefined(container);
      assert.isNull(retained);
    }),
  );

  it.effect("should roll back a partially inserted container immediately after host failure", () =>
    Effect.gen(function* () {
      // Scope: a host append mutates the DOM and then reports failure during acquisition.
      // Assertion: typed failure rolls back before the caller's still-open Scope closes.
      const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      let container: Node | undefined;
      const append = document.body.appendChild.bind(document.body);
      const failure = new HostFailure({ operation: "appendChild" });
      const spy = vi
        .spyOn(document.body, "appendChild")
        .mockImplementation(<T extends Node>(node: T): T => {
          container = node;
          append(node);
          // oxlint-disable-next-line effect/no-raw-throw -- Host fake verifies partial DOM mutation rollback.
          throw failure;
        });
      const exit = yield* Portal.make(<span />).pipe(
        Scope.provide(owner),
        Effect.exit,
        Effect.ensuring(Effect.sync(() => spy.mockRestore())),
      );
      const retained = container?.parentNode;
      container?.parentNode?.removeChild(container);
      assert.isNull(retained);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isFalse(Cause.hasDies(exit.cause));
        assert.isTrue(
          exit.cause.reasons.some(
            (reason) =>
              Cause.isFailReason(reason) && Predicate.isTagged(reason.error, "PortalDomError"),
          ),
        );
      }
    }).pipe(Effect.scoped),
  );
});
