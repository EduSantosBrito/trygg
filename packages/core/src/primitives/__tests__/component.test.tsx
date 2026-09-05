/**
 * Component Unit Tests
 *
 * Component API enables JSX components with typed props and explicit DI.
 * Uses generator syntax with Component.gen for ergonomic component creation.
 *
 * Test Categories:
 * - Component.gen: Creating components with generator syntax
 * - Props: Typed props via ComponentProps<T>
 * - Services: Yielding services from context
 * - Component.provide: Providing layers to children
 * - isEffectComponent: Type guard
 *
 * Goals: Reliability, stability
 * - Verify props flow correctly
 * - Verify services are accessible
 * - Verify provide propagates to children
 */
import { assert, describe, it } from "@effect/vitest";
import { Data, Effect, Exit, Layer, Result, Context, Schema, Scope } from "effect";

// Tagged error for testing component failures
class ComponentError extends Schema.TaggedError<ComponentError>()("ComponentError", {
  message: Schema.String,
}) {}
import * as Component from "../component.js";
import { unsafeBuildContext } from "../../internal/unsafe.js";
import { click, render } from "../../testing/index.js";
import * as Signal from "../signal.js";

// Test service for DI tests
class TestService extends Context.Service<TestService, { value: string }>()(
  "component.test/TestService",
) {}
const testServiceLayer = Layer.succeed(TestService, { value: "test-value" });

// =============================================================================
// Component.gen - No props
// =============================================================================
// Scope: Creating components without props

describe("Component.gen without props", () => {
  it("should create ComponentType from generator function", () => {
    const MyComponent = Component.gen(function* () {
      return <div>Hello</div>;
    });

    assert.strictEqual(MyComponent._tag, "EffectComponent");
  });

  it("should return Element when called", () => {
    const MyComponent = Component.gen(function* () {
      return <div>Content</div>;
    });

    const element = MyComponent({});

    assert.strictEqual(element._tag, "Component");
  });

  it.effect("should execute generator body during render", () =>
    Effect.gen(function* () {
      let executed = false;

      const MyComponent = Component.gen(function* () {
        executed = true;
        return <div>Rendered</div>;
      });

      yield* render(<MyComponent />);

      assert.isTrue(executed);
    }),
  );

  it.effect("should support yielding effects inside generator", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const result = yield* Effect.succeed(42);
        return <div data-testid="result">{String(result)}</div>;
      });

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("result")).textContent, "42");
    }),
  );

  it.effect("should allow yielding services from context", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const service = yield* TestService;
        return <div data-testid="service">{service.value}</div>;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("service")).textContent, "test-value");
    }),
  );
});

// =============================================================================
// Component.gen - With props
// =============================================================================
// Scope: Creating components with typed props

describe("Component.gen with props", () => {
  it("should create component with typed props", () => {
    const MyComponent = Component.gen(function* (
      Props: Component.ComponentProps<{ title: string }>,
    ) {
      const { title } = yield* Props;
      return <div>{title}</div>;
    });

    assert.strictEqual(MyComponent._tag, "EffectComponent");
  });

  it.effect("should receive props via yield* Props", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ title: string }>,
      ) {
        const { title } = yield* Props;
        return <div data-testid="title">{title}</div>;
      });

      const { getByTestId } = yield* render(<MyComponent title="Hello World" />);

      assert.strictEqual((yield* getByTestId("title")).textContent, "Hello World");
    }),
  );

  it.effect("should support optional props", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ title?: string }>,
      ) {
        const { title } = yield* Props;
        return <div data-testid="title">{title ?? "Default"}</div>;
      });

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("title")).textContent, "Default");
    }),
  );

  it.effect("should combine props and services", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ prefix: string }>,
      ) {
        const { prefix } = yield* Props;
        const service = yield* TestService;
        return (
          <div data-testid="combined">
            {prefix}-{service.value}
          </div>
        );
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<MyComponent prefix="Test" />);

      assert.strictEqual((yield* getByTestId("combined")).textContent, "Test-test-value");
    }),
  );
});

// =============================================================================
// Component Type
// =============================================================================
// Scope: Component type properties and metadata

describe("Component Type", () => {
  it("should track _tag as EffectComponent", () => {
    const MyComponent = Component.gen(function* () {
      return <div>Test</div>;
    });

    assert.strictEqual(MyComponent._tag, "EffectComponent");
  });

  it("should have _layers array", () => {
    const MyComponent = Component.gen(function* () {
      return <div>Test</div>;
    });

    assert.isArray(MyComponent._layers);
    assert.strictEqual(MyComponent._layers.length, 0);
  });
});

// =============================================================================
// Component.provide
// =============================================================================
// Scope: Providing layers to satisfy service requirements

describe("Component.provide", () => {
  it.effect("should provide layer services to component", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const service = yield* TestService;
        return <div data-testid="provided">{service.value}</div>;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("provided")).textContent, "test-value");
    }),
  );

  it.effect("should propagate services to child components", () =>
    Effect.gen(function* () {
      const Child = Component.gen(function* () {
        const service = yield* TestService;
        return <span data-testid="child">{service.value}</span>;
      });

      const Parent = Component.gen(function* () {
        return (
          <div>
            <Child />
          </div>
        );
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<Parent />);

      assert.strictEqual((yield* getByTestId("child")).textContent, "test-value");
    }),
  );

  it.effect("should support providing services at parent level", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        return <div data-testid="wrapped">Content</div>;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("wrapped")).textContent, "Content");
    }),
  );

  it.effect("should merge with existing context from parent", () =>
    Effect.gen(function* () {
      class AnotherService extends Context.Service<AnotherService, { other: string }>()(
        "component.test/AnotherService",
      ) {}

      const Child = Component.gen(function* () {
        const test = yield* TestService;
        const another = yield* AnotherService;
        return <div data-testid="merged">{`${test.value}-${another.other}`}</div>;
      });

      const Parent = Component.gen(function* () {
        return <Child />;
      }).pipe(Component.provide(Layer.succeed(AnotherService, { other: "other-value" })));

      const GrandParent = Component.gen(function* () {
        return <Parent />;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<GrandParent />);

      assert.strictEqual((yield* getByTestId("merged")).textContent, "test-value-other-value");
    }),
  );

  it.effect("should support chaining multiple provides on same component", () =>
    Effect.gen(function* () {
      class ServiceA extends Context.Service<ServiceA, { a: string }>()(
        "component.test/ServiceA",
      ) {}
      class ServiceB extends Context.Service<ServiceB, { b: string }>()(
        "component.test/ServiceB",
      ) {}

      const MyComponent = Component.gen(function* () {
        const a = yield* ServiceA;
        const b = yield* ServiceB;
        return <div data-testid="chained">{`${a.a}-${b.b}`}</div>;
      }).pipe(
        Component.provide(Layer.succeed(ServiceA, { a: "A" })),
        Component.provide(Layer.succeed(ServiceB, { b: "B" })),
      );

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("chained")).textContent, "A-B");
    }),
  );

  it.effect(
    "should acquire pipeable lifecycle provider once while rerendering stable component",
    () =>
      Effect.gen(function* () {
        let acquireCount = 0;
        let finalizeCount = 0;

        class Store extends Context.Service<
          Store,
          {
            readonly count: Signal.Signal<number>;
            readonly increment: Effect.Effect<void>;
          }
        >()("component.test/Store") {}

        const StoreLive = Layer.effect(
          Store,
          Effect.gen(function* () {
            acquireCount += 1;
            const count = yield* Signal.make(0);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                finalizeCount += 1;
              }),
            );
            return {
              count,
              increment: Signal.update(count, (value) => value + 1),
            };
          }).pipe(Effect.annotateLogs("service", "Store")),
        );

        const StoreView = Component.gen(function* () {
          const store = yield* Store;
          const count = yield* Signal.get(store.count);
          return (
            <button data-testid="store" onClick={() => store.increment}>
              {String(count)}
            </button>
          );
        });

        const App = Component.gen(function* () {
          const parentRenders = yield* Signal.make(0);
          const renderCount = yield* Signal.get(parentRenders);
          return (
            <section>
              <button
                data-testid="rerender"
                onClick={() => Signal.update(parentRenders, (value) => value + 1)}
              >
                {String(renderCount)}
              </button>
              <StoreView />
            </section>
          );
        }).pipe(Component.provide(StoreLive));

        const scope = yield* Scope.make();
        const result = yield* render(<App />).pipe(Scope.provide(scope));

        assert.strictEqual(acquireCount, 1);
        assert.strictEqual((yield* result.getByTestId("store")).textContent, "0");

        yield* click(yield* result.getByTestId("store"));
        yield* Effect.yieldNow;
        assert.strictEqual((yield* result.getByTestId("store")).textContent, "1");

        yield* click(yield* result.getByTestId("rerender"));
        yield* Effect.yieldNow;
        assert.strictEqual(acquireCount, 1);
        assert.strictEqual((yield* result.getByTestId("store")).textContent, "1");

        yield* Scope.close(scope, Exit.void);
        assert.strictEqual(finalizeCount, 1);
      }),
  );
});

// =============================================================================
// Service access
// =============================================================================
// Scope: Components yielding services from context

describe("Service access", () => {
  it.effect("should yield service from provided layer", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const service = yield* TestService;
        return <div data-testid="service">{service.value}</div>;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("service")).textContent, "test-value");
    }),
  );

  it.effect("should fail when service is not provided", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const service = yield* TestService;
        return <div>{service.value}</div>;
      });

      // Intentionally not providing - this test verifies error handling when service is missing
      const context = yield* unsafeBuildContext<unknown>([]);
      const result = yield* render(<MyComponent />).pipe(
        Effect.sandbox,
        Effect.provide(context),
        Effect.result,
      );

      assert.isTrue(Result.isFailure(result));
    }),
  );
});

// =============================================================================
// Error handling
// =============================================================================
// Scope: Component error handling

describe("Error handling", () => {
  it.effect("should propagate errors from component", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        return yield* new ComponentError({ message: "Component failed" });
      });

      const context = yield* unsafeBuildContext<unknown>([]);
      const result = yield* render(<MyComponent />).pipe(Effect.provide(context), Effect.result);

      assert.isTrue(Result.isFailure(result));
    }),
  );

  it.effect("should handle errors in nested components", () =>
    Effect.gen(function* () {
      const ErrorChild = Component.gen(function* () {
        return yield* new ComponentError({ message: "Child error" });
      });

      const Parent = Component.gen(function* () {
        return (
          <div>
            <ErrorChild />
          </div>
        );
      });

      const context = yield* unsafeBuildContext<unknown>([]);
      const result = yield* render(<Parent />).pipe(Effect.provide(context), Effect.result);

      assert.isTrue(Result.isFailure(result));
    }),
  );
});

// =============================================================================
// isEffectComponent
// =============================================================================
// Scope: Type guard for component detection

describe("isEffectComponent", () => {
  it("should return true for Component.gen result", () => {
    const MyComponent = Component.gen(function* () {
      return <div>Test</div>;
    });

    assert.isTrue(Component.isEffectComponent(MyComponent));
  });

  it("should return false for plain functions", () => {
    const plainFn = () => <div>Test</div>;

    assert.isFalse(Component.isEffectComponent(plainFn));
  });

  it("should return false for regular objects", () => {
    assert.isFalse(Component.isEffectComponent({}));
    assert.isFalse(Component.isEffectComponent(null));
    assert.isFalse(Component.isEffectComponent(undefined));
  });

  it("should return true for components with .provide() applied", () => {
    const MyComponent = Component.gen(function* () {
      return <div>Test</div>;
    }).pipe(Component.provide(testServiceLayer));

    assert.isTrue(Component.isEffectComponent(MyComponent));
  });

  it.effect("should return false for arrow functions without _tag", () =>
    Effect.sync(() => {
      const arrow = () => "hi";
      assert.isFalse(Component.isEffectComponent(arrow));
    }),
  );

  it.effect("should return false for Effect objects (have _tag but wrong value)", () =>
    Effect.sync(() => {
      const eff = Effect.succeed(42);
      assert.isFalse(Component.isEffectComponent(eff));
    }),
  );

  it("should return false for objects with _tag: 'EffectComponent' that are not functions", () => {
    class FakeComponent extends Data.TaggedClass("EffectComponent") {}
    const fakeComponent = new FakeComponent();
    assert.isFalse(Component.isEffectComponent(fakeComponent));
  });

  it("should return false for strings and numbers", () => {
    assert.isFalse(Component.isEffectComponent("EffectComponent"));
    assert.isFalse(Component.isEffectComponent(42));
  });
});

// =============================================================================
// Component function API (Component())
// =============================================================================
// Scope: Alternative component creation with explicit type parameter

describe("Component function API", () => {
  it.effect("should create component with explicit props type", () =>
    Effect.sync(() => {
      const MyComponent = Component.Component<{ title: string }>()((Props) =>
        Effect.gen(function* () {
          const { title } = yield* Props;
          return <div>{title}</div>;
        }),
      );

      assert.strictEqual(MyComponent._tag, "EffectComponent");
    }),
  );

  it.effect("should work with props", () =>
    Effect.gen(function* () {
      const MyComponent = Component.Component<{ message: string }>()((Props) =>
        Effect.gen(function* () {
          const { message } = yield* Props;
          return <div data-testid="msg">{message}</div>;
        }),
      );

      const { getByTestId } = yield* render(<MyComponent message="Hello" />);

      assert.strictEqual((yield* getByTestId("msg")).textContent, "Hello");
    }),
  );

  it.effect("should support services with Component() API", () =>
    Effect.gen(function* () {
      const MyComponent = Component.Component()(() =>
        Effect.gen(function* () {
          const service = yield* TestService;
          return <div data-testid="svc">{service.value}</div>;
        }),
      ).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("svc")).textContent, "test-value");
    }),
  );
});

// =============================================================================
// Layer Precedence
// =============================================================================
// Scope: Verify nested provider semantics

describe("Layer Precedence", () => {
  it.effect("should preserve Effect nesting via chaining (inner provision wins)", () =>
    Effect.gen(function* () {
      class Theme extends Context.Service<Theme, { color: string }>()("component.test/Theme") {}

      const BlueTheme = Layer.succeed(Theme, { color: "blue" });
      const RedTheme = Layer.succeed(Theme, { color: "red" });

      const MyComponent = Component.gen(function* () {
        const theme = yield* Theme;
        return <div data-testid="theme">{theme.color}</div>;
      }).pipe(Component.provide(BlueTheme), Component.provide(RedTheme));

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("theme")).textContent, "blue");
    }),
  );

  it("rejects legacy array provision", () => {
    class Theme extends Context.Service<Theme, { color: string }>()("component.test/Theme") {}

    const BlueTheme = Layer.succeed(Theme, { color: "blue" });
    const RedTheme = Layer.succeed(Theme, { color: "red" });

    const MyComponent = Component.gen(function* () {
      const theme = yield* Theme;
      return <div data-testid="theme">{theme.color}</div>;
    });

    // @ts-expect-error array provision was removed; use one Component.provide(layer) per call.
    MyComponent.pipe(Component.provide([BlueTheme, RedTheme]));
  });

  it.effect("should keep fully provided component services nested inside later provision", () =>
    Effect.gen(function* () {
      class Theme extends Context.Service<Theme, { color: string }>()("component.test/Theme") {}

      const BlueTheme = Layer.succeed(Theme, { color: "blue" });
      const RedTheme = Layer.succeed(Theme, { color: "red" });

      const BaseComponent = Component.gen(function* () {
        const theme = yield* Theme;
        return <div data-testid="theme">{theme.color}</div>;
      }).pipe(Component.provide(BlueTheme));

      const OverriddenComponent = BaseComponent.pipe(Component.provide(RedTheme));

      const { getByTestId } = yield* render(<OverriddenComponent />);

      assert.strictEqual((yield* getByTestId("theme")).textContent, "blue");
    }),
  );
});

// =============================================================================
// Immutability
// =============================================================================
// Scope: Verify original component is not mutated

describe("Immutability", () => {
  it("should not mutate original component after provision", () => {
    const BaseComponent = Component.gen(function* () {
      return <div>Base</div>;
    });

    const ProvidedComponent = BaseComponent.pipe(Component.provide(testServiceLayer));

    // Original should still have empty layers
    assert.strictEqual(BaseComponent._layers.length, 0);
    // New component should have the layer
    assert.strictEqual(ProvidedComponent._layers.length, 1);
  });

  it.effect("should create independent variants from base", () =>
    Effect.gen(function* () {
      class ServiceA extends Context.Service<ServiceA, { value: string }>()(
        "component.test/ServiceA",
      ) {}
      class ServiceB extends Context.Service<ServiceB, { value: string }>()(
        "component.test/ServiceB",
      ) {}

      const BaseComponent = Component.gen(function* () {
        const a = yield* ServiceA;
        const b = yield* ServiceB;
        return (
          <div data-testid="combined">
            {a.value}-{b.value}
          </div>
        );
      });

      const VariantA = BaseComponent.pipe(
        Component.provide(Layer.succeed(ServiceA, { value: "A" })),
        Component.provide(Layer.succeed(ServiceB, { value: "B" })),
      );

      const { getByTestId: getA } = yield* render(<VariantA />);
      assert.strictEqual((yield* getA("combined")).textContent, "A-B");
    }),
  );

  it.effect("should fail when partial provision leaves unsatisfied services", () =>
    Effect.gen(function* () {
      class ServiceA extends Context.Service<ServiceA, { value: string }>()(
        "component.test/ServiceA",
      ) {}
      class ServiceB extends Context.Service<ServiceB, { value: string }>()(
        "component.test/ServiceB",
      ) {}

      const BaseComponent = Component.gen(function* () {
        const a = yield* ServiceA;
        const b = yield* ServiceB;
        return (
          <div>
            {a.value}-{b.value}
          </div>
        );
      });

      // Only provide ServiceA — ServiceB is missing
      const VariantA = BaseComponent.pipe(
        Component.provide(Layer.succeed(ServiceA, { value: "A" })),
      );

      const context = yield* unsafeBuildContext<unknown>([]);
      const result = yield* render(<VariantA />).pipe(
        Effect.sandbox,
        Effect.provide(context),
        Effect.result,
      );
      assert.isTrue(Result.isFailure(result));
    }),
  );

  it("should create distinct objects on chaining", () => {
    const Step1 = Component.gen(function* () {
      return <div>Step1</div>;
    }).pipe(Component.provide(testServiceLayer));

    const Step2 = Step1.pipe(Component.provide(testServiceLayer));
    const Step3 = Step2.pipe(Component.provide(testServiceLayer));

    // Each step should be a different object
    assert.notStrictEqual(Step1, Step2);
    assert.notStrictEqual(Step2, Step3);
    assert.notStrictEqual(Step1, Step3);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================
// Scope: Boundary conditions and unusual scenarios

describe("Edge Cases", () => {
  it.effect("should handle providing to component with no requirements", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        return <div data-testid="no-req">No requirements</div>;
      });

      const ProvidedComponent = MyComponent.pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<ProvidedComponent />);

      assert.strictEqual((yield* getByTestId("no-req")).textContent, "No requirements");
    }),
  );

  it.effect("should preserve props after provision", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ title: string }>,
      ) {
        const { title } = yield* Props;
        return <div data-testid="props">{title}</div>;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<MyComponent title="Test Title" />);

      assert.strictEqual((yield* getByTestId("props")).textContent, "Test Title");
    }),
  );

  it.effect("should handle already satisfied service (extra provision)", () =>
    Effect.gen(function* () {
      // Component with no requirements
      const MyComponent = Component.gen(function* () {
        return <div data-testid="extra">Extra provision</div>;
      });

      // Providing extra layers should be harmless
      const ProvidedComponent = MyComponent.pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(<ProvidedComponent />);

      assert.strictEqual((yield* getByTestId("extra")).textContent, "Extra provision");
    }),
  );
});
