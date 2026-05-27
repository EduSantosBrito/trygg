import { assert, describe } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Scope } from "effect";
import * as Context from "effect/Context";
import { TestClock } from "effect/testing";
import { scoped } from "../../testing/effect-vitest.js";
import * as ContractTrace from "../../contract/trace.js";
import { click, render } from "../../testing/index.js";
import * as Component from "../component.js";
import * as ErrorBoundary from "../error-boundary.js";
import * as Signal from "../signal.js";

describe("render-component", () => {
  scoped("mounts with provided services", () => {
    class Label extends Context.Service<Label, { readonly value: string }>()("test/Label") {}

    const labelLayer = Layer.succeed(Label, { value: "provided" });

    const App = Component.gen(function* () {
      const label = yield* Label;
      return <div data-testid="label">{label.value}</div>;
    });

    return Effect.gen(function* () {
      const { getByTestId } = yield* render(<App />).pipe(Effect.provide(labelLayer));

      assert.strictEqual((yield* getByTestId("label")).textContent, "provided");
    });
  });

  scoped("subscribes to signals and re-renders on change", () =>
    Effect.gen(function* () {
      const count = yield* Signal.make(0);

      const Counter = Component.gen(function* () {
        const value = yield* Signal.get(count);
        return <div data-testid="count">{String(value)}</div>;
      });

      const { getByTestId } = yield* render(<Counter />);
      assert.strictEqual((yield* getByTestId("count")).textContent, "0");

      yield* Signal.set(count, 1);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("count")).textContent, "1");
    }),
  );

  scoped("batches multiple signal writes into one microtask render", () =>
    Effect.gen(function* () {
      const count = yield* Signal.make(0);
      const Counter = Component.gen(function* () {
        const value = yield* Signal.get(count);
        return <div data-testid="batched">{String(value)}</div>;
      });

      const { getByTestId } = yield* render(<Counter />);

      yield* Signal.set(count, 1);
      yield* Signal.set(count, 2);
      yield* Signal.set(count, 3);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("batched")).textContent, "3");
    }),
  );

  scoped("preserves current DOM when signal re-render fails without boundary", () =>
    Effect.gen(function* () {
      const shouldFail = yield* Signal.make(false);

      const Risky = Component.gen(function* () {
        if (yield* Signal.get(shouldFail)) {
          yield* Effect.fail("boom");
        }
        return <div data-testid="stable">stable</div>;
      });

      const { getByTestId } = yield* render(<Risky />);
      yield* Signal.set(shouldFail, true);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("stable")).textContent, "stable");
    }),
  );

  scoped("propagates re-render failures to error boundaries", () =>
    Effect.gen(function* () {
      const shouldFail = yield* Signal.make(false);

      const Risky = Component.gen(function* () {
        if (yield* Signal.get(shouldFail)) {
          yield* Effect.fail("boom");
        }
        return <div data-testid="risky">ok</div>;
      });

      const Fallback = Component.gen(function* (
        Props: Component.ComponentProps<{ cause: Cause.Cause<unknown> }>,
      ) {
        yield* Props;
        return <div data-testid="fallback">fallback</div>;
      });

      const Safe = yield* ErrorBoundary.catch(Risky).pipe(ErrorBoundary.catchAll(Fallback));
      const { getByTestId } = yield* render(<Safe />);

      yield* Signal.set(shouldFail, true);
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("fallback")).textContent, "fallback");
    }),
  );

  scoped("replaces provider scope when component key changes", () =>
    Effect.gen(function* () {
      const collector = yield* ContractTrace.createInMemoryCollector("provider-key-change");
      const selectedKey = yield* Signal.make<"first" | "second">("first");
      const acquireLog: Array<string> = [];
      const finalizeLog: Array<string> = [];

      class Label extends Context.Service<Label, { readonly value: string }>()("test/Label") {}

      const LabelLive = Layer.effect(
        Label,
        Effect.gen(function* () {
          acquireLog.push("label");
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              finalizeLog.push("label");
            }),
          );
          return { value: "label" };
        }),
      );

      const LabelView = Component.gen(function* () {
        const label = yield* Label;
        return <div data-testid="key-label">{label.value}</div>;
      });

      const ProvidedLabel = LabelView.pipe(Component.provide(LabelLive));

      const Host = Component.gen(function* () {
        const key = yield* Signal.get(selectedKey);
        return <ProvidedLabel key={key} />;
      });

      const { getByTestId } = yield* ContractTrace.withCollector(render(<Host />), collector);
      assert.strictEqual((yield* getByTestId("key-label")).textContent, "label");
      assert.deepStrictEqual(acquireLog, ["label"]);

      yield* Signal.set(selectedKey, "second");
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("key-label")).textContent, "label");
      const records = yield* collector.snapshot;
      assert.deepStrictEqual(acquireLog, ["label", "label"]);
      assert.deepStrictEqual(finalizeLog, ["label"]);

      const replacementReasons = records.flatMap((record) =>
        record.event.event === "provider.replace" &&
        typeof record.event.payload?.reason === "string"
          ? [record.event.payload.reason]
          : [],
      );
      assert.include(replacementReasons, "key-change");
    }),
  );

  scoped("replaces provider scope when layer identity changes", () =>
    Effect.gen(function* () {
      const collector = yield* ContractTrace.createInMemoryCollector("provider-identity-change");
      const selected = yield* Signal.make<"first" | "second">("first");
      const acquireLog: Array<string> = [];
      const finalizeLog: Array<string> = [];

      class Label extends Context.Service<Label, { readonly value: string }>()("test/Label") {}

      const makeLabelLayer = (value: string) =>
        Layer.effect(
          Label,
          Effect.gen(function* () {
            acquireLog.push(value);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                finalizeLog.push(value);
              }),
            );
            return { value };
          }),
        );

      const FirstLive = makeLabelLayer("first");
      const SecondLive = makeLabelLayer("second");

      const LabelView = Component.gen(function* () {
        const label = yield* Label;
        return <div data-testid="identity-label">{label.value}</div>;
      });

      const FirstLabel = LabelView.pipe(Component.provide(FirstLive));
      const SecondLabel = LabelView.pipe(Component.provide(SecondLive));

      const Host = Component.gen(function* () {
        const value = yield* Signal.get(selected);
        return value === "first" ? <FirstLabel key="stable" /> : <SecondLabel key="stable" />;
      });

      const { getByTestId } = yield* ContractTrace.withCollector(render(<Host />), collector);
      assert.strictEqual((yield* getByTestId("identity-label")).textContent, "first");
      assert.deepStrictEqual(acquireLog, ["first"]);

      yield* Signal.set(selected, "second");
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("identity-label")).textContent, "second");
      assert.deepStrictEqual(acquireLog, ["first", "second"]);
      assert.deepStrictEqual(finalizeLog, ["first"]);

      const records = yield* collector.snapshot;
      const replacementReasons = records.flatMap((record) =>
        record.event.event === "provider.replace" &&
        typeof record.event.payload?.reason === "string"
          ? [record.event.payload.reason]
          : [],
      );
      assert.include(replacementReasons, "identity-change");
    }),
  );

  scoped("routes provider acquisition failure through error boundary and retries on reset", () =>
    Effect.gen(function* () {
      const collector = yield* ContractTrace.createInMemoryCollector("provider-failure-retry");
      const providerShouldFail = yield* Signal.make(true);
      const retryKey = yield* Signal.make(0);
      let acquireAttempts = 0;

      class FlakyService extends Context.Service<FlakyService, { readonly label: string }>()(
        "test/FlakyService",
      ) {}

      const FlakyLive = Layer.effect(
        FlakyService,
        Effect.gen(function* () {
          acquireAttempts += 1;
          const shouldFail = yield* Signal.peek(providerShouldFail);
          if (shouldFail) {
            return yield* Effect.fail("provider failed");
          }
          return { label: "ready" };
        }),
      );

      const Risky = Component.gen(function* () {
        const service = yield* FlakyService;
        return <div data-testid="provider-ready">{service.label}</div>;
      }).pipe(Component.provide(FlakyLive));

      const Fallback = Component.gen(function* (
        Props: Component.ComponentProps<{ readonly cause: Cause.Cause<unknown> }>,
      ) {
        yield* Props;
        return (
          <button
            data-testid="provider-retry"
            onClick={() =>
              Effect.gen(function* () {
                yield* Signal.set(providerShouldFail, false);
                yield* Signal.update(retryKey, (value) => value + 1);
              })
            }
          >
            Retry provider
          </button>
        );
      });

      const SafeRisky = yield* ErrorBoundary.catch(Risky).pipe(ErrorBoundary.catchAll(Fallback));

      const Host = Component.gen(function* () {
        const key = yield* Signal.get(retryKey);
        return <SafeRisky key={key} />;
      });

      const { getByTestId } = yield* ContractTrace.withCollector(render(<Host />), collector);
      assert.strictEqual((yield* getByTestId("provider-retry")).textContent, "Retry provider");
      assert.strictEqual(acquireAttempts, 1);

      yield* click(yield* getByTestId("provider-retry"));
      yield* TestClock.adjust(20);

      assert.strictEqual((yield* getByTestId("provider-ready")).textContent, "ready");
      assert.strictEqual(acquireAttempts, 2);

      const events = (yield* collector.snapshot).map((record) => record.event.event);
      assert.strictEqual(events.filter((event) => event === "provider.failure").length, 1);
      assert.strictEqual(events.filter((event) => event === "provider.acquire").length, 1);
    }),
  );

  scoped("cleans subscriptions and DOM on unmount", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const count = yield* Signal.make(0);

      const Counter = Component.gen(function* () {
        const value = yield* Signal.get(count);
        return <div id="component-cleanup">{String(value)}</div>;
      });

      yield* render(<Counter />).pipe(Scope.provide(scope));
      const listenersBefore = count._listeners.size;

      yield* Scope.close(scope, Exit.void);

      assert.isNull(document.querySelector("#component-cleanup"));
      assert.isBelow(count._listeners.size, listenersBefore);
    }),
  );

  scoped("assembles the replacement subtree off-DOM during reconcile-driven swap", () =>
    Effect.gen(function* () {
      // Reconcile within a component falls through to a fresh render of the
      // replacement element when the child identity differs. Before the fix,
      // that render mounted progressively into the live parent — appendChild
      // attached an empty <section> first, then filled it child-by-child,
      // and only later removed the old subtree. Under CPU throttling, the
      // empty/partial new subtree was visible alongside the old one.
      //
      // With the fix, the replacement is assembled off-DOM in a
      // DocumentFragment so the new <section> is fully populated when it
      // first appears in the live tree.
      const which = yield* Signal.make<"first" | "second">("first");

      const First = Component.gen(function* () {
        return (
          <section data-marker="first">
            <p>old panel</p>
          </section>
        );
      });

      const Second = Component.gen(function* () {
        return (
          <section data-marker="second">
            <p>new panel</p>
          </section>
        );
      });

      const Host = Component.gen(function* () {
        const value = yield* Signal.get(which);
        return value === "first" ? <First /> : <Second />;
      });

      const childCountWhenFirstSeen: Array<number> = [];

      const { container } = yield* render(<Host />);

      // Synchronous spy on the container's DOM mutation methods. Without the
      // fix, the new section is appended empty (childElementCount === 0) and
      // its children are added later. With the fix, the section arrives
      // inside a fragment that already holds its <p> (childElementCount === 1).
      const recordSection = (node: Node): void => {
        if (node instanceof Element && node.matches("[data-marker='second']")) {
          childCountWhenFirstSeen.push(node.childElementCount);
          return;
        }
        if (node.nodeType === 11) {
          const section = (node as DocumentFragment).querySelector("[data-marker='second']");
          if (section !== null) {
            childCountWhenFirstSeen.push(section.childElementCount);
          }
        }
      };
      const originalAppendChild = container.appendChild.bind(container);
      const originalInsertBefore = container.insertBefore.bind(container);
      container.appendChild = (<T extends Node>(newNode: T): T => {
        recordSection(newNode);
        return originalAppendChild(newNode) as T;
      }) as typeof container.appendChild;
      container.insertBefore = (<T extends Node>(newNode: T, refNode: Node | null): T => {
        recordSection(newNode);
        return originalInsertBefore(newNode, refNode) as T;
      }) as typeof container.insertBefore;

      yield* Signal.set(which, "second");
      yield* TestClock.adjust(20);

      // The new section must already contain its <p> the first (and only)
      // time it is observed in the live DOM — i.e. it was assembled in a
      // fragment, not appended empty and progressively filled.
      assert.deepStrictEqual(childCountWhenFirstSeen, [1]);
      assert.strictEqual(container.querySelectorAll("[data-marker]").length, 1);
      assert.strictEqual(
        container.querySelector("[data-marker='second']")?.textContent,
        "new panel",
      );
    }),
  );
});
