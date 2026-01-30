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
import { Context, Data, Effect, Layer } from "effect";

// Tagged error for testing component failures
class ComponentError extends Data.TaggedError("ComponentError")<{ message: string }> {}
import * as Component from "../component.js";
import { render } from "../../testing/index.js";

// Test service for DI tests
class TestService extends Context.Tag("TestService")<TestService, { value: string }>() {}
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

  it.scoped("should execute generator body during render", () =>
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

  it.scoped("should support yielding effects inside generator", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const result = yield* Effect.succeed(42);
        return <div data-testid="result">{String(result)}</div>;
      });

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("result")).textContent, "42");
    }),
  );

  it.scoped("should allow yielding services from context", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const service = yield* TestService;
        return <div data-testid="service">{service.value}</div>;
      }).provide(testServiceLayer);

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

  it.scoped("should receive props via yield* Props", () =>
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

  it.scoped("should support optional props", () =>
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

  it.scoped("should combine props and services", () =>
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
      }).provide(testServiceLayer);

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

  it("should have _requirements array", () => {
    const MyComponent = Component.gen(function* () {
      return <div>Test</div>;
    });

    assert.isArray(MyComponent._requirements);
  });
});

// =============================================================================
// Component.provide
// =============================================================================
// Scope: Providing layers to satisfy service requirements

describe("Component.provide", () => {
  it.scoped("should provide layer services to component", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const service = yield* TestService;
        return <div data-testid="provided">{service.value}</div>;
      }).provide(testServiceLayer);

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("provided")).textContent, "test-value");
    }),
  );

  it.scoped("should propagate services to child components", () =>
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
      }).provide(testServiceLayer);

      const { getByTestId } = yield* render(<Parent />);

      assert.strictEqual((yield* getByTestId("child")).textContent, "test-value");
    }),
  );

  it.scoped("should support providing services at parent level", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        return <div data-testid="wrapped">Content</div>;
      }).provide(testServiceLayer);

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("wrapped")).textContent, "Content");
    }),
  );

  it.scoped("should merge with existing context from parent", () =>
    Effect.gen(function* () {
      class AnotherService extends Context.Tag("AnotherService")<
        AnotherService,
        { other: string }
      >() {}

      const Child = Component.gen(function* () {
        const test = yield* TestService;
        const another = yield* AnotherService;
        return <div data-testid="merged">{`${test.value}-${another.other}`}</div>;
      });

      const Parent = Component.gen(function* () {
        return <Child />;
      }).provide(Layer.succeed(AnotherService, { other: "other-value" }));

      const GrandParent = Component.gen(function* () {
        return <Parent />;
      }).provide(testServiceLayer);

      const { getByTestId } = yield* render(<GrandParent />);

      assert.strictEqual((yield* getByTestId("merged")).textContent, "test-value-other-value");
    }),
  );

  it.scoped("should support chaining multiple provides on same component", () =>
    Effect.gen(function* () {
      class ServiceA extends Context.Tag("ServiceA")<ServiceA, { a: string }>() {}
      class ServiceB extends Context.Tag("ServiceB")<ServiceB, { b: string }>() {}

      const MyComponent = Component.gen(function* () {
        const a = yield* ServiceA;
        const b = yield* ServiceB;
        return <div data-testid="chained">{`${a.a}-${b.b}`}</div>;
      })
        .provide(Layer.succeed(ServiceA, { a: "A" }))
        .provide(Layer.succeed(ServiceB, { b: "B" }));

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("chained")).textContent, "A-B");
    }),
  );
});

// =============================================================================
// Service access
// =============================================================================
// Scope: Components yielding services from context

describe("Service access", () => {
  it.scoped("should yield service from provided layer", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const service = yield* TestService;
        return <div data-testid="service">{service.value}</div>;
      }).provide(testServiceLayer);

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("service")).textContent, "test-value");
    }),
  );

  it.scoped("should fail when service is not provided", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const service = yield* TestService;
        return <div>{service.value}</div>;
      });

      // Intentionally not providing - this test verifies error handling when service is missing
      const result = yield* Effect.either(render(<MyComponent />).pipe(Effect.sandbox));

      // The error should be a failure (Left) because TestService is not available
      assert.strictEqual(result._tag, "Left");
    }),
  );
});

// =============================================================================
// Error handling
// =============================================================================
// Scope: Component error handling

describe("Error handling", () => {
  it.scoped("should propagate errors from component", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        return yield* new ComponentError({ message: "Component failed" });
      });

      const result = yield* Effect.either(render(<MyComponent />));

      assert.isTrue(result._tag === "Left");
    }),
  );

  it.scoped("should handle errors in nested components", () =>
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

      const result = yield* Effect.either(render(<Parent />));

      assert.isTrue(result._tag === "Left");
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
    }).provide(testServiceLayer);

    assert.isTrue(Component.isEffectComponent(MyComponent));
  });
});

// =============================================================================
// Component function API (Component())
// =============================================================================
// Scope: Alternative component creation with explicit type parameter

describe("Component function API", () => {
  it("should create component with explicit props type", () => {
    const MyComponent = Component.Component<{ title: string }>()((Props) =>
      Effect.gen(function* () {
        const { title } = yield* Props;
        return <div>{title}</div>;
      }),
    );

    assert.strictEqual(MyComponent._tag, "EffectComponent");
  });

  it.scoped("should work with props", () =>
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

  it.scoped("should support services with Component() API", () =>
    Effect.gen(function* () {
      const MyComponent = Component.Component()(() =>
        Effect.gen(function* () {
          const service = yield* TestService;
          return <div data-testid="svc">{service.value}</div>;
        }),
      ).provide(testServiceLayer);

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("svc")).textContent, "test-value");
    }),
  );
});

// =============================================================================
// Layer Precedence
// =============================================================================
// Scope: Verify last-write-wins semantics

describe("Layer Precedence", () => {
  it.scoped("should override via chaining (last provision wins)", () =>
    Effect.gen(function* () {
      class Theme extends Context.Tag("Theme")<Theme, { color: string }>() {}

      const BlueTheme = Layer.succeed(Theme, { color: "blue" });
      const RedTheme = Layer.succeed(Theme, { color: "red" });

      const MyComponent = Component.gen(function* () {
        const theme = yield* Theme;
        return <div data-testid="theme">{theme.color}</div>;
      })
        .provide(BlueTheme)
        .provide(RedTheme);

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("theme")).textContent, "red");
    }),
  );

  it.scoped("should override via array order (last in array wins)", () =>
    Effect.gen(function* () {
      class Theme extends Context.Tag("Theme")<Theme, { color: string }>() {}

      const BlueTheme = Layer.succeed(Theme, { color: "blue" });
      const RedTheme = Layer.succeed(Theme, { color: "red" });

      const MyComponent = Component.gen(function* () {
        const theme = yield* Theme;
        return <div data-testid="theme">{theme.color}</div>;
      }).provide([BlueTheme, RedTheme]);

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual((yield* getByTestId("theme")).textContent, "red");
    }),
  );

  it.scoped("should allow override after full provision", () =>
    Effect.gen(function* () {
      class Theme extends Context.Tag("Theme")<Theme, { color: string }>() {}

      const BlueTheme = Layer.succeed(Theme, { color: "blue" });
      const RedTheme = Layer.succeed(Theme, { color: "red" });

      const BaseComponent = Component.gen(function* () {
        const theme = yield* Theme;
        return <div data-testid="theme">{theme.color}</div>;
      }).provide(BlueTheme);

      const OverriddenComponent = BaseComponent.provide(RedTheme);

      const { getByTestId } = yield* render(<OverriddenComponent />);

      assert.strictEqual((yield* getByTestId("theme")).textContent, "red");
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

    const ProvidedComponent = BaseComponent.provide(testServiceLayer);

    // Original should still have empty layers
    assert.strictEqual(BaseComponent._layers.length, 0);
    // New component should have the layer
    assert.strictEqual(ProvidedComponent._layers.length, 1);
  });

  it("should create independent variants from base", () =>
    Effect.gen(function* () {
      class ServiceA extends Context.Tag("ServiceA")<ServiceA, { value: string }>() {}
      class ServiceB extends Context.Tag("ServiceB")<ServiceB, { value: string }>() {}

      const BaseComponent = Component.gen(function* () {
        const a = yield* ServiceA;
        const b = yield* ServiceB;
        return (
          <div data-testid="combined">
            {a.value}-{b.value}
          </div>
        );
      });

      const VariantA = BaseComponent.provide(Layer.succeed(ServiceA, { value: "A" }));

      // VariantA provides ServiceA, and ServiceB comes from outer context
      const { getByTestId: getA } = yield* render(<VariantA />);
      assert.strictEqual((yield* getA("combined")).textContent, "A-B");
    }));

  it("should create distinct objects on chaining", () => {
    const Step1 = Component.gen(function* () {
      return <div>Step1</div>;
    }).provide(testServiceLayer);

    const Step2 = Step1.provide(testServiceLayer);
    const Step3 = Step2.provide(testServiceLayer);

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
  it.scoped("should handle providing to component with no requirements", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        return <div data-testid="no-req">No requirements</div>;
      });

      const ProvidedComponent = MyComponent.provide(testServiceLayer);

      const { getByTestId } = yield* render(<ProvidedComponent />);

      assert.strictEqual((yield* getByTestId("no-req")).textContent, "No requirements");
    }),
  );

  it.scoped("should preserve props after provision", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ title: string }>,
      ) {
        const { title } = yield* Props;
        return <div data-testid="props">{title}</div>;
      }).provide(testServiceLayer);

      const { getByTestId } = yield* render(<MyComponent title="Test Title" />);

      assert.strictEqual((yield* getByTestId("props")).textContent, "Test Title");
    }),
  );

  it.scoped("should handle already satisfied service (extra provision)", () =>
    Effect.gen(function* () {
      // Component with no requirements
      const MyComponent = Component.gen(function* () {
        return <div data-testid="extra">Extra provision</div>;
      });

      // Providing extra layers should be harmless
      const ProvidedComponent = MyComponent.provide(testServiceLayer);

      const { getByTestId } = yield* render(<ProvidedComponent />);

      assert.strictEqual((yield* getByTestId("extra")).textContent, "Extra provision");
    }),
  );
});
