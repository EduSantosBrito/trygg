/**
 * @since 1.0.0
 * Component API for trygg
 *
 * Enables JSX components with typed props and explicit dependency injection.
 * Services are provided by parent effects via Component.provide.
 *
 * @example
 * ```tsx
 * import { Context, Effect, Layer } from "effect"
 * import { Component, mount } from "trygg"
 *
 * class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}
 *
 * const Card = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
 *   const { title } = yield* Props
 *   const theme = yield* Theme
 *   return <div style={{ color: theme.primary }}>{title}</div>
 * })
 *
 * const themeLayer = Layer.succeed(Theme, { primary: "blue" })
 *
 * const App = Component.gen(function* () {
 *   return <Card title="Hello" />
 * }).provide(themeLayer)
 *
 * mount(container, <App />)
 * ```
 */
import { Context, Data, Effect, Layer } from "effect";
import { YieldWrap } from "effect/Utils";
import {
  Element,
  componentElement,
  provideElement,
  type ComponentElementWithRequirements,
} from "./element.js";

/**
 * Error raised when an invalid component type is used in JSX.
 * @since 1.0.0
 */
export class InvalidComponentError extends Data.TaggedError("InvalidComponentError")<{
  readonly reason: "plain-function" | "effect" | "unknown";
  readonly displayName?: string | undefined;
}> {}

/**
 * Error raised when Component.gen is called incorrectly.
 * @since 1.0.0
 */
export class ComponentGenError extends Data.TaggedError("ComponentGenError")<{
  readonly message: string;
}> {}

/**
 * Error raised when a component is rendered without required services.
 * @since 1.0.0
 */
export class MissingServiceError extends Data.TaggedError("MissingServiceError")<{
  readonly componentName: string;
  readonly missingServices: ReadonlyArray<string>;
  readonly example: string;
}> {
  override get message(): string {
    const services = this.missingServices.join(", ");
    return `Component "${this.componentName}" requires the following services: [${services}]\n${this.example}`;
  }
}

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Marker interface for Props service - distinguishes props from other services.
 * Used as the identifier type for the Props Context.Tag.
 * @since 1.0.0
 */
export interface PropsMarker<P> {
  readonly _brand: "@trygg/Props";
  readonly _P: P;
}

/**
 * Props tag type used in Component.gen for inference.
 * @since 1.0.0
 */
export type ComponentProps<P> = Context.Tag<PropsMarker<P>, P>;

// =============================================================================
// Component Types
// =============================================================================

type ComponentResult = Element | Effect.Effect<Element, unknown, unknown>;

const effectComponentTag = "EffectComponent" as const;

/**
 * Build a context from an array of layers by merging them
 * Uses Layer.mergeAll for proper precedence handling (last layer wins)
 * @internal
 */
const buildContextFromLayers = <A>(
  layers: ReadonlyArray<Layer.Layer.Any>,
): Effect.Effect<Context.Context<A>, never, never> => {
  if (layers.length === 0) {
    return Effect.succeed(Context.unsafeMake(new Map()));
  }

  // Use Layer.mergeAll - it handles multiple layers with correct precedence
  // We cast through unknown to handle the Layer.Any type
  const mergedLayer =
    layers.length === 1
      ? (layers[0] as unknown as Layer.Layer<A, never, never>)
      : (Layer.mergeAll(
          layers[0] as unknown as Layer.Layer<A, never, never>,
          ...(layers.slice(1) as unknown as Array<Layer.Layer<A, never, never>>),
        ) as Layer.Layer<A, never, never>);

  // Build context by providing a dummy effect and extracting the context
  return Effect.gen(function* () {
    const context = yield* Effect.context<A>().pipe(Effect.provide(mergedLayer));
    return context;
  }) as Effect.Effect<Context.Context<A>, never, never>;
};

/**
 * Deduplicate layers by keeping only the last occurrence of each service
 * This prevents unnecessary layer accumulation while preserving last-write-wins semantics
 * @internal
 */
const deduplicateLayers = (
  layers: ReadonlyArray<Layer.Layer.Any>,
): ReadonlyArray<Layer.Layer.Any> => {
  // For now, we keep all layers and let Layer.mergeAll handle precedence
  // In a more sophisticated implementation, we could track service tags and deduplicate
  // But Layer.mergeAll already handles "last layer wins" correctly
  return layers;
};

/**
 * Tag a component function with Component metadata
 * @internal
 */
export const tagComponent = <Props, E, R>(
  fn: (props: any) => Element,
  layers: ReadonlyArray<Layer.Layer.Any> = [],
  requirements: ReadonlyArray<Context.Tag<any, any>> = [],
  runFn?: (props: any) => Effect.Effect<Element, E, unknown>,
  displayName?: string,
): Component.Type<Props, E, R> => {
  // Create the base tagged function
  const tagged = Object.assign(fn, {
    _tag: effectComponentTag,
    _layers: layers,
    _requirements: requirements,
    _runFn: runFn,
    _displayName: displayName,
  }) as Component.Type<Props, E, R>;

  // Attach the .provide() method that creates a new component with merged layers
  tagged.provide = ((layerOrLayers: Layer.Layer.Any | ReadonlyArray<Layer.Layer.Any>): any => {
    const newLayers = Array.isArray(layerOrLayers) ? layerOrLayers : [layerOrLayers];
    // Append new layers - Layer.mergeAll applies left-to-right with last-write-wins
    // When we call .provide(A).provide(B), mergedLayers = [A, B], B wins
    // When we call .provide([A, B]), mergedLayers = [A, B], B wins (last in array)
    const mergedLayers = deduplicateLayers([...layers, ...newLayers]);

    // Create new component function that preserves the Props type
    const newComponent = (props: [Props] extends [never] ? {} : Props): Element => {
      // Create a Component element whose run function builds context and wraps output in Provide
      const run = (): Effect.Effect<Element, E, unknown> =>
        Effect.gen(function* () {
          // Build context from layers
          // Layer.mergeAll applies layers left-to-right with last-write-wins semantics
          // mergedLayers is ordered chronologically, so last layer wins correctly
          const context = yield* buildContextFromLayers(mergedLayers);

          // Execute the stored runFn directly to get the element
          // Provide the context to satisfy service requirements
          const element = runFn ? yield* runFn(props).pipe(Effect.provide(context)) : fn(props);

          // Wrap the element in a Provide element so context propagates to children
          return provideElement(context, element);
        });

      return componentElement(run);
    };

    // Tag the new component with merged layers and preserve the runFn and displayName
    return tagComponent(newComponent, mergedLayers, requirements, runFn, displayName);
  }) as Component.Type<Props, E, R>["provide"];

  return tagged;
};

const normalizeResult = <E, R>(
  effect: Effect.Effect<ComponentResult, E, R>,
): Effect.Effect<Element, E, R> =>
  Effect.map(effect, (result) =>
    Effect.isEffect(result) ? componentElement(() => result) : result,
  );

// =============================================================================
// Component Function
// =============================================================================

/**
 * Create a JSX-compatible component with typed props.
 *
 * Service requirements are resolved from the parent context.
 * @since 1.0.0
 */
export function Component<P extends object = {}>(): <E, R>(
  effectFn: (Props: Context.Tag<PropsMarker<P>, P>) => Effect.Effect<Element, E, R>,
) => Component.Type<P, E, Exclude<R, PropsMarker<P>>> {
  return <E, R>(
    effectFn: (Props: Context.Tag<PropsMarker<P>, P>) => Effect.Effect<Element, E, R>,
  ): Component.Type<P, E, Exclude<R, PropsMarker<P>>> => {
    const PropsTag = Context.GenericTag<PropsMarker<P>, P>("@trygg/Props");

    const componentFn = (props: P): Element => {
      const run = (): Effect.Effect<Element, E, R> => {
        const baseEffect = effectFn(PropsTag);
        const withProps = Effect.provideService(baseEffect, PropsTag, props);
        return normalizeResult(withProps);
      };

      return componentElement(run);
    };

    return tagComponent(componentFn);
  };
}

/**
 * Internal storage for accumulated layers on a component
 * @internal
 */
export interface ComponentInternal {
  readonly _tag: "EffectComponent";
  readonly _layers: ReadonlyArray<Layer.Layer.Any>;
  readonly _baseFn: (props: unknown) => Element;
  readonly _requirements: ReadonlyArray<Context.Tag<any, any>>;
}

/**
 * Component type - a callable that returns an Element when used in JSX.
 * Tracks Props, Error, and Requirements (services needed from parent context).
 * @since 1.0.0
 */
export declare namespace Component {
  export interface Type<Props = never, _E = never, _R = never> {
    readonly _tag: "EffectComponent";
    readonly _layers: ReadonlyArray<Layer.Layer.Any>;
    readonly _requirements: ReadonlyArray<Context.Tag<any, any>>;
    readonly _runFn?: (props: any) => Effect.Effect<Element, unknown, unknown>;
    readonly _displayName?: string;
    (props: [Props] extends [never] ? {} : Props): ComponentElementWithRequirements<_R>;

    /**
     * Provide services to satisfy component requirements at definition time.
     * Returns a new component with narrowed R type.
     *
     * @example
     * ```tsx
     * const Button = Component.gen(function* () {
     *   const theme = yield* Theme;
     *   return <button style={theme.primary}>Click</button>;
     * }).provide(themeLayer);
     * ```
     */
    provide<ROut, E2, RIn>(
      layer: Layer.Layer<ROut, E2, RIn>,
    ): Component.Type<Props, _E | E2, RIn | Exclude<_R, ROut>>;

    /**
     * Provide multiple services at once using an array of layers.
     *
     * @example
     * ```tsx
     * const Button = Component.gen(...).provide([themeLayer, analyticsLayer]);
     * ```
     */
    provide<const Layers extends readonly [Layer.Layer.Any, ...Array<Layer.Layer.Any>]>(
      layers: Layers,
    ): Component.Type<
      Props,
      _E | { [k in keyof Layers]: Layer.Layer.Error<Layers[k]> }[number],
      | { [k in keyof Layers]: Layer.Layer.Context<Layers[k]> }[number]
      | Exclude<_R, { [k in keyof Layers]: Layer.Layer.Success<Layers[k]> }[number]>
    >;
  }
}

// =============================================================================
// Type Guards
// =============================================================================

const hasTag = (value: unknown): value is { _tag: unknown } =>
  typeof value === "function" && value !== null && "_tag" in value;

/**
 * Check if a value is an EffectComponent
 * @since 1.0.0
 */
export const isEffectComponent = (value: unknown): value is Component.Type<unknown> => {
  const hasTagResult = hasTag(value);
  const tagValue = hasTagResult ? (value as any)._tag : undefined;
  return hasTagResult && tagValue === effectComponentTag;
};

// =============================================================================
// Component.gen API
// =============================================================================

/**
 * Type alias for the YieldWrap type used in Effect.gen
 * @internal
 */
type EffectYieldWrap<A, E, R> = YieldWrap<Effect.Effect<A, E, R>>;

/**
 * Extract error type from YieldWrap union
 * @internal
 */
type ExtractError<Eff> = [Eff] extends [never]
  ? never
  : [Eff] extends [YieldWrap<Effect.Effect<infer _A, infer E, infer _R>>]
    ? E
    : never;

/**
 * Extract context (requirements) type from YieldWrap union
 * @internal
 */
type ExtractContext<Eff> = [Eff] extends [never]
  ? never
  : [Eff] extends [YieldWrap<Effect.Effect<infer _A, infer _E, infer R>>]
    ? R
    : never;

/**
 * Create component without props from generator function.
 * @internal
 */
function genNoProps<
  Eff extends EffectYieldWrap<unknown, unknown, unknown>,
  AEff extends ComponentResult,
>(
  f: (resume?: Effect.Adapter) => Generator<Eff, AEff, never>,
): Component.Type<never, ExtractError<Eff>, ExtractContext<Eff>> {
  type E = ExtractError<Eff>;

  const runFn = (): Effect.Effect<Element, E, unknown> => normalizeResult(Effect.gen(f));

  const componentFn = (_props: {}): Element => componentElement(runFn);

  return tagComponent(componentFn, [], [], runFn);
}

/**
 * Create a function that creates components with props from generator factory.
 * @internal
 */
function genWithProps<P extends object>(): <
  Eff extends EffectYieldWrap<unknown, unknown, unknown>,
  AEff extends ComponentResult,
>(
  f: (
    Props: Context.Tag<PropsMarker<P>, P>,
  ) => (resume: Effect.Adapter) => Generator<Eff, AEff, never>,
) => Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> {
  return <Eff extends EffectYieldWrap<unknown, unknown, unknown>, AEff extends ComponentResult>(
    f: (
      Props: Context.Tag<PropsMarker<P>, P>,
    ) => (resume: Effect.Adapter) => Generator<Eff, AEff, never>,
  ): Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> => {
    type E = ExtractError<Eff>;
    const PropsTag = Context.GenericTag<PropsMarker<P>, P>("@trygg/Props");

    const runFn = (props: P): Effect.Effect<Element, E, unknown> => {
      const baseEffect = Effect.gen(f(PropsTag));
      const withProps = Effect.provideService(baseEffect, PropsTag, props);
      return normalizeResult(withProps);
    };

    const componentFn = (props: P): Element => componentElement(() => runFn(props));

    return tagComponent(componentFn, [], [], runFn);
  };
}

/**
 * Create a function that creates components with props from a generator directly.
 * @internal
 */
function genWithPropsDirect<P extends object>(): <
  Eff extends EffectYieldWrap<unknown, unknown, unknown>,
  AEff extends ComponentResult,
>(
  f: (
    Props: Context.Tag<PropsMarker<P>, P>,
    resume?: Effect.Adapter,
  ) => Generator<Eff, AEff, never>,
) => Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> {
  const withProps = genWithProps<P>();

  return <Eff extends EffectYieldWrap<unknown, unknown, unknown>, AEff extends ComponentResult>(
    f: (
      Props: Context.Tag<PropsMarker<P>, P>,
      resume?: Effect.Adapter,
    ) => Generator<Eff, AEff, never>,
  ): Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> =>
    withProps((Props) => (resume) => f(Props, resume));
}

/**
 * Check if a function is a generator function
 * @internal
 */
type GeneratorComponentFn = (
  ...args: ReadonlyArray<unknown>
) => Generator<EffectYieldWrap<unknown, unknown, unknown>, ComponentResult, never>;

const isGeneratorFunction = (fn: unknown): fn is GeneratorComponentFn =>
  typeof fn === "function" && fn.constructor.name === "GeneratorFunction";

/**
 * Component.gen - Create components using generator syntax.
 *
 * Usage patterns:
 * 1. Without props: `Component.gen(function* () { ... })`
 * 2. With props: `Component.gen(function* (Props: ComponentProps<{ title: string }>) { ... })`
 * 3. Curried form still supported: `Component.gen<P>()(Props => function* () { ... })`
 *
 * @since 1.0.0
 */
type Gen = {
  <Eff extends EffectYieldWrap<unknown, unknown, unknown>>(
    f: (resume: Effect.Adapter) => Generator<Eff, ComponentResult, never>,
  ): Component.Type<never, ExtractError<Eff>, ExtractContext<Eff>>;
  <
    P extends object = {},
    Eff extends EffectYieldWrap<unknown, unknown, unknown> = EffectYieldWrap<
      unknown,
      unknown,
      unknown
    >,
  >(
    f: (
      Props: Context.Tag<PropsMarker<P>, P>,
      resume?: Effect.Adapter,
    ) => Generator<Eff, ComponentResult, never>,
  ): Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>>;
  <P extends object = {}>(): <
    Eff extends EffectYieldWrap<unknown, unknown, unknown> = EffectYieldWrap<
      unknown,
      unknown,
      unknown
    >,
  >(
    f: (
      Props: Context.Tag<PropsMarker<P>, P>,
    ) => (resume: Effect.Adapter) => Generator<Eff, ComponentResult, never>,
  ) => Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>>;
};

export const gen: Gen = function <P extends object>(f?: unknown): any {
  if (f !== undefined && isGeneratorFunction(f)) {
    if (f.length === 0) {
      return genNoProps((resume) => f(resume));
    }
    return genWithPropsDirect<P>()((Props, resume) => f(Props, resume));
  }
  if (f === undefined) {
    return genWithProps<P>();
  }
  // Return a component that fails when rendered, instead of throwing synchronously
  return genNoProps(function* () {
    return yield* new ComponentGenError({
      message: "Component.gen: expected a generator function or call with type parameter first",
    });
  });
};
