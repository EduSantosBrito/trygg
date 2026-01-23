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

      assert.strictEqual(getByTestId("result").textContent, "42");
    }),
  );

  it.scoped("should allow yielding services from context", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        const service = yield* TestService;
        return <div data-testid="service">{service.value}</div>;
      });

      const element = Effect.gen(function* () {
        return <MyComponent />;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(element);

      assert.strictEqual(getByTestId("service").textContent, "test-value");
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

  it.scoped("should provide props via yield", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ message: string }>,
      ) {
        const { message } = yield* Props;
        return <span data-testid="msg">{message}</span>;
      });

      const { getByTestId } = yield* render(<MyComponent message="Hello World" />);

      assert.strictEqual(getByTestId("msg").textContent, "Hello World");
    }),
  );

  it.scoped("should infer props type from ComponentProps parameter", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ count: number; label: string }>,
      ) {
        const { count, label } = yield* Props;
        return <div data-testid="display">{`${label}: ${count}`}</div>;
      });

      const { getByTestId } = yield* render(<MyComponent count={5} label="Total" />);

      assert.strictEqual(getByTestId("display").textContent, "Total: 5");
    }),
  );

  it.scoped("should receive props from JSX usage", () =>
    Effect.gen(function* () {
      const Greeting = Component.gen(function* (Props: Component.ComponentProps<{ name: string }>) {
        const { name } = yield* Props;
        return <h1 data-testid="greeting">{`Hello, ${name}!`}</h1>;
      });

      const { getByTestId } = yield* render(<Greeting name="Alice" />);

      assert.strictEqual(getByTestId("greeting").textContent, "Hello, Alice!");
    }),
  );

  it.scoped("should support multiple props", () =>
    Effect.gen(function* () {
      const Card = Component.gen(function* (
        Props: Component.ComponentProps<{ title: string; body: string; footer: string }>,
      ) {
        const { title, body, footer } = yield* Props;
        return (
          <div data-testid="card">
            <h2>{title}</h2>
            <p>{body}</p>
            <footer>{footer}</footer>
          </div>
        );
      });

      const { getByTestId } = yield* render(
        <Card title="Title" body="Body text" footer="Footer" />,
      );

      const card = getByTestId("card");
      assert.include(card.textContent, "Title");
      assert.include(card.textContent, "Body text");
      assert.include(card.textContent, "Footer");
    }),
  );

  it.scoped("should support optional props", () =>
    Effect.gen(function* () {
      const OptionalComponent = Component.gen(function* (
        Props: Component.ComponentProps<{ required: string; optional?: string }>,
      ) {
        const { required, optional } = yield* Props;
        return <div data-testid="opt">{optional ? `${required} - ${optional}` : required}</div>;
      });

      const { getByTestId } = yield* render(<OptionalComponent required="Required" />);

      assert.strictEqual(getByTestId("opt").textContent, "Required");
    }),
  );
});

// =============================================================================
// Component.gen - Curried form
// =============================================================================
// Scope: Alternative curried API for props

describe("Component.gen curried form", () => {
  it("should support curried form with type parameter", () => {
    const MyComponent = Component.Component<{ value: number }>()((Props) =>
      Effect.gen(function* () {
        const { value } = yield* Props;
        return <div>{String(value)}</div>;
      }),
    );

    assert.strictEqual(MyComponent._tag, "EffectComponent");
  });
});

// =============================================================================
// Component.provide - Service propagation
// =============================================================================
// Scope: Providing layers to child components

describe("Component.provide", () => {
  it.scoped("should provide layer services to effect", () =>
    Effect.gen(function* () {
      const component = Effect.gen(function* () {
        const service = yield* TestService;
        return <div data-testid="provided">{service.value}</div>;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(component);

      assert.strictEqual(getByTestId("provided").textContent, "test-value");
    }),
  );

  it.scoped("should propagate services to child components", () =>
    Effect.gen(function* () {
      const Child = Component.gen(function* () {
        const service = yield* TestService;
        return <span data-testid="child">{service.value}</span>;
      });

      const Parent = Effect.gen(function* () {
        return (
          <div>
            <Child />
          </div>
        );
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(Parent);

      assert.strictEqual(getByTestId("child").textContent, "test-value");
    }),
  );

  it.scoped("should wrap result in Provide element", () =>
    Effect.gen(function* () {
      const component = Effect.gen(function* () {
        return <div data-testid="wrapped">Content</div>;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(component);

      assert.strictEqual(getByTestId("wrapped").textContent, "Content");
    }),
  );

  it.scoped("should merge with existing context", () =>
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

      const component = Effect.gen(function* () {
        return <Child />;
      }).pipe(
        Component.provide(Layer.succeed(AnotherService, { other: "other-value" })),
        Component.provide(testServiceLayer),
      );

      const { getByTestId } = yield* render(component);

      assert.strictEqual(getByTestId("merged").textContent, "test-value-other-value");
    }),
  );

  it.scoped("should support chaining multiple provides", () =>
    Effect.gen(function* () {
      class ServiceA extends Context.Tag("ServiceA")<ServiceA, { a: string }>() {}
      class ServiceB extends Context.Tag("ServiceB")<ServiceB, { b: string }>() {}

      const Child = Component.gen(function* () {
        const a = yield* ServiceA;
        const b = yield* ServiceB;
        return <div data-testid="chained">{`${a.a}-${b.b}`}</div>;
      });

      const component = Effect.gen(function* () {
        return <Child />;
      }).pipe(
        Component.provide(Layer.succeed(ServiceA, { a: "A" })),
        Component.provide(Layer.succeed(ServiceB, { b: "B" })),
      );

      const { getByTestId } = yield* render(component);

      assert.strictEqual(getByTestId("chained").textContent, "A-B");
    }),
  );
});

// =============================================================================
// Service access
// =============================================================================
// Scope: Accessing services from parent context

describe("Service access in components", () => {
  it.scoped("should access service from parent context", () =>
    Effect.gen(function* () {
      const Child = Component.gen(function* () {
        const service = yield* TestService;
        return <span data-testid="svc">{service.value}</span>;
      });

      const component = Effect.gen(function* () {
        return <Child />;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(component);

      assert.strictEqual(getByTestId("svc").textContent, "test-value");
    }),
  );

  it.scoped("should fail when required service not provided", () =>
    Effect.gen(function* () {
      const Child = Component.gen(function* () {
        const service = yield* TestService;
        return <span>{service.value}</span>;
      });

      const exit = yield* Effect.exit(render(<Child />));

      assert.strictEqual(exit._tag, "Failure");
    }),
  );

  it.scoped("should propagate services to nested components", () =>
    Effect.gen(function* () {
      const DeepChild = Component.gen(function* () {
        const service = yield* TestService;
        return <span data-testid="deep">{service.value}</span>;
      });

      const MiddleChild = Component.gen(function* () {
        return (
          <div>
            <DeepChild />
          </div>
        );
      });

      const component = Effect.gen(function* () {
        return <MiddleChild />;
      }).pipe(Component.provide(testServiceLayer));

      const { getByTestId } = yield* render(component);

      assert.strictEqual(getByTestId("deep").textContent, "test-value");
    }),
  );
});

// =============================================================================
// isEffectComponent - Type guard
// =============================================================================
// Scope: Checking if value is an EffectComponent

describe("isEffectComponent", () => {
  it("should return true for Component.gen result", () => {
    const MyComponent = Component.gen(function* () {
      return <div />;
    });

    assert.isTrue(Component.isEffectComponent(MyComponent));
  });

  it("should return false for plain functions", () => {
    const plainFn = () => <div />;

    assert.isFalse(Component.isEffectComponent(plainFn));
  });

  it("should return false for plain objects", () => {
    const obj = { _tag: "SomeOtherTag" };

    assert.isFalse(Component.isEffectComponent(obj));
  });

  it("should return false for null", () => {
    assert.isFalse(Component.isEffectComponent(null));
  });
});

// =============================================================================
// Component rendering
// =============================================================================
// Scope: Components produce correct Element structure

describe("Component rendering", () => {
  it.scoped("should return JSX as Element", () =>
    Effect.gen(function* () {
      const MyComponent = Component.gen(function* () {
        return <article data-testid="article">Article content</article>;
      });

      const { getByTestId } = yield* render(<MyComponent />);

      assert.strictEqual(getByTestId("article").tagName, "ARTICLE");
    }),
  );

  it.scoped("should support nested component usage", () =>
    Effect.gen(function* () {
      const Inner = Component.gen(function* () {
        return <span data-testid="inner">Inner</span>;
      });

      const Outer = Component.gen(function* () {
        return (
          <div data-testid="outer">
            <Inner />
          </div>
        );
      });

      const { getByTestId } = yield* render(<Outer />);

      assert.strictEqual(getByTestId("outer").tagName, "DIV");
      assert.strictEqual(getByTestId("inner").textContent, "Inner");
    }),
  );

  it.scoped("should support conditional rendering", () =>
    Effect.gen(function* () {
      const Conditional = Component.gen(function* (
        Props: Component.ComponentProps<{ show: boolean }>,
      ) {
        const { show } = yield* Props;
        if (show) {
          return <div data-testid="shown">Visible</div>;
        }
        return <div data-testid="hidden">Hidden</div>;
      });

      const { getByTestId } = yield* render(<Conditional show={true} />);

      assert.strictEqual(getByTestId("shown").textContent, "Visible");
    }),
  );

  it.scoped("should support returning Effect of Element", () =>
    Effect.gen(function* () {
      const AsyncComponent = Component.gen(function* () {
        const data = yield* Effect.succeed("Async data");
        return <div data-testid="async">{data}</div>;
      });

      const { getByTestId } = yield* render(<AsyncComponent />);

      assert.strictEqual(getByTestId("async").textContent, "Async data");
    }),
  );
});

// =============================================================================
// Error handling
// =============================================================================
// Scope: Error propagation from components

describe("Component error handling", () => {
  it.scoped("should propagate errors from generator", () =>
    Effect.gen(function* () {
      const ErrorComponent = Component.gen(function* () {
        yield* new ComponentError({ message: "Component error" });
        return <div />;
      });

      const exit = yield* Effect.exit(render(<ErrorComponent />));

      assert.strictEqual(exit._tag, "Failure");
    }),
  );

  it.scoped("should propagate Effect failures", () =>
    Effect.gen(function* () {
      const FailingComponent = Component.gen(function* () {
        yield* Effect.fail("Failure reason");
        return <div />;
      });

      const exit = yield* Effect.exit(render(<FailingComponent />));

      assert.strictEqual(exit._tag, "Failure");
    }),
  );
});
