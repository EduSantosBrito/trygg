/**
 * @since 1.0.0
 * Component API for trygg
 *
 * Enables JSX components with typed props and explicit dependency injection.
 * Services are provided by parent effects via Component.provide.
 *
 * @example
 * ```tsx
 * import { Effect, Layer } from "effect"
 * import * as ServiceMap from "effect/ServiceMap"
 * import { Component, mount } from "trygg"
 *
 * class Theme extends ServiceMap.Service<Theme, { primary: string }>()("Theme") {}
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
import { Data, Effect, Layer } from "effect";
import * as ServiceMap from "effect/ServiceMap";
import { unsafeBuildContext, unsafeTagCallable } from "../internal/unsafe.js";
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

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Marker interface for Props service - distinguishes props from other services.
 * Used as the identifier type for the Props service key.
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
export type ComponentProps<P> = ServiceMap.Service<PropsMarker<P>, P>;

// =============================================================================
// Component Types
// =============================================================================

type ComponentResult = Element | Effect.Effect<Element, unknown, unknown>;
type ComponentCallProps<Props> = [Props] extends [never] ? {} : Props;
type ComponentYieldable = Effect.Yieldable.Any;
type LegacyGenResume = undefined;

const effectComponentTag = "EffectComponent" as const;

// buildContextFromLayers moved to internal/unsafe.ts as unsafeBuildContext
// Handles heterogeneous Layer.Any[] merging at a type system boundary

/**
 * Deduplicate layers by keeping only the last occurrence of each service
 * This prevents unnecessary layer accumulation while preserving last-write-wins semantics
 * @internal
 */
const deduplicateLayers = (layers: ReadonlyArray<Layer.Any>): ReadonlyArray<Layer.Any> => {
  // For now, we keep all layers and let Layer.mergeAll handle precedence
  // In a more sophisticated implementation, we could track service tags and deduplicate
  // But Layer.mergeAll already handles "last layer wins" correctly
  return layers;
};

/**
 * Tag a component function with Component metadata
 * @internal
 */
export const tagComponent = <Props, RuntimeProps, E, R>(
  fn: (props: RuntimeProps) => Element,
  layers: ReadonlyArray<Layer.Any> = [],
  runFn?: (props: RuntimeProps) => Effect.Effect<Element, E, unknown>,
  displayName?: string,
): Component.Type<Props, E, R> => {
  // Build provide as a standalone function, then pass to unsafeTagCallable
  // The provide implementation serves multiple overloads — the overload
  // signatures on Component.Type ensure type safety at call sites
  const provide = (layerOrLayers: Layer.Any | ReadonlyArray<Layer.Any>) => {
    const newLayers = Array.isArray(layerOrLayers) ? layerOrLayers : [layerOrLayers];
    // Append new layers - Layer.mergeAll applies left-to-right with last-write-wins
    // When we call .provide(A).provide(B), mergedLayers = [A, B], B wins
    // When we call .provide([A, B]), mergedLayers = [A, B], B wins (last in array)
    const mergedLayers = deduplicateLayers([...layers, ...newLayers]);

    // Create new component function that preserves the Props type
    const newComponent = (props: RuntimeProps): Element => {
      // Create a Component element whose run function builds context and wraps output in Provide
      const run = (): Effect.Effect<Element, E, unknown> =>
        Effect.gen(function* () {
          // Build context from layers
          // Layer.mergeAll applies layers left-to-right with last-write-wins semantics
          // mergedLayers is ordered chronologically, so last layer wins correctly
          const context = yield* unsafeBuildContext(mergedLayers);

          // Execute the stored runFn directly to get the element
          // Provide the context to satisfy service requirements
          const element = runFn ? yield* runFn(props).pipe(Effect.provide(context)) : fn(props);

          // Wrap the element in a Provide element so context propagates to children
          return provideElement(context, element);
        });

      return componentElement(run, null, newComponent, props);
    };

    // Tag the new component with merged layers and preserve the runFn and displayName
    return tagComponent<Props, RuntimeProps, E, R>(newComponent, mergedLayers, runFn, displayName);
  };

  return unsafeTagCallable<Component.Type<Props, E, R>>(fn, {
    _tag: effectComponentTag,
    _layers: layers,
    _runFn: runFn,
    _displayName: displayName,
    provide,
  });
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
  effectFn: (Props: ServiceMap.Service<PropsMarker<P>, P>) => Effect.Effect<Element, E, R>,
) => Component.Type<P, E, Exclude<R, PropsMarker<P>>> {
  return <E, R>(
    effectFn: (Props: ServiceMap.Service<PropsMarker<P>, P>) => Effect.Effect<Element, E, R>,
  ): Component.Type<P, E, Exclude<R, PropsMarker<P>>> => {
    const PropsTag = ServiceMap.Service<PropsMarker<P>, P>("@trygg/Props");

    const componentFn = (props: P): Element => {
      const run = (): Effect.Effect<Element, E, R> => {
        const baseEffect = effectFn(PropsTag);
        const withProps = Effect.provideService(baseEffect, PropsTag, props);
        return normalizeResult(withProps);
      };

      return componentElement(run, null, componentFn, props);
    };

    return tagComponent<P, P, E, Exclude<R, PropsMarker<P>>>(componentFn);
  };
}

/**
 * Internal storage for accumulated layers on a component
 * @internal
 */
export interface ComponentInternal {
  readonly _tag: "EffectComponent";
  readonly _layers: ReadonlyArray<Layer.Any>;
  readonly _baseFn: (props: unknown) => Element;
}

/**
 * Component type - a callable that returns an Element when used in JSX.
 * Tracks Props, Error, and Requirements (services needed from parent context).
 * @since 1.0.0
 */
export declare namespace Component {
  export interface Type<Props = never, _E = never, _R = never> {
    readonly _tag: "EffectComponent";
    readonly _layers: ReadonlyArray<Layer.Any>;
    readonly _runFn?: (
      props: ComponentCallProps<Props>,
    ) => Effect.Effect<Element, unknown, unknown>;
    readonly _displayName?: string;
    (props: ComponentCallProps<Props>): ComponentElementWithRequirements<_R>;

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
    provide<const Layers extends readonly [Layer.Any, ...Array<Layer.Any>]>(
      layers: Layers,
    ): Component.Type<
      Props,
      _E | { [k in keyof Layers]: Layer.Error<Layers[k]> }[number],
      | { [k in keyof Layers]: Layer.Services<Layers[k]> }[number]
      | Exclude<_R, { [k in keyof Layers]: Layer.Success<Layers[k]> }[number]>
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
export const isEffectComponent = (value: unknown): value is Component.Type<unknown> =>
  hasTag(value) && value._tag === effectComponentTag;

// =============================================================================
// Component.gen API
// =============================================================================

/**
 * Type alias for Effect v4 yieldables used in Effect.gen
 * @internal
 */
type EffectYieldable<A, E, R> = Effect.Yieldable<Effect.Effect<A, E, R>, A, E, R>;

/**
 * Extract error type from yieldable union
 * @internal
 */
type ExtractError<Eff> = [Eff] extends [never]
  ? never
  : [Eff] extends [Effect.Yieldable<infer _Self, infer _A, infer E, infer _R>]
    ? E
    : never;

/**
 * Extract context (requirements) type from yieldable union
 * @internal
 */
type ExtractContext<Eff> = [Eff] extends [never]
  ? never
  : [Eff] extends [Effect.Yieldable<infer _Self, infer _A, infer _E, infer R>]
    ? R
    : never;

/**
 * Create component without props from generator function.
 * @internal
 */
function genNoProps<Eff extends ComponentYieldable, AEff extends ComponentResult>(
  f: (resume: LegacyGenResume) => Generator<Eff, AEff, never>,
): Component.Type<never, ExtractError<Eff>, ExtractContext<Eff>> {
  type E = ExtractError<Eff>;

  const runFn = (): Effect.Effect<Element, E, unknown> =>
    normalizeResult(Effect.gen(() => f(undefined)));

  const componentFn = (_props: {}): Element => componentElement(runFn, null, componentFn);

  return tagComponent<never, {}, E, ExtractContext<Eff>>(componentFn, [], runFn);
}

/**
 * Create a function that creates components with props from generator factory.
 * @internal
 */
function genWithProps<P extends object>(): <
  Eff extends ComponentYieldable,
  AEff extends ComponentResult,
>(
  f: (
    Props: ServiceMap.Service<PropsMarker<P>, P>,
  ) => (resume: LegacyGenResume) => Generator<Eff, AEff, never>,
) => Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> {
  return <Eff extends ComponentYieldable, AEff extends ComponentResult>(
    f: (
      Props: ServiceMap.Service<PropsMarker<P>, P>,
    ) => (resume: LegacyGenResume) => Generator<Eff, AEff, never>,
  ): Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> => {
    type E = ExtractError<Eff>;
    const PropsTag = ServiceMap.Service<PropsMarker<P>, P>("@trygg/Props");

    const runFn = (props: P): Effect.Effect<Element, E, unknown> => {
      const baseEffect = Effect.gen(() => f(PropsTag)(undefined));
      const withProps = Effect.provideService(baseEffect, PropsTag, props);
      return normalizeResult(withProps);
    };

    const componentFn = (props: P): Element =>
      componentElement(() => runFn(props), null, componentFn, props);

    return tagComponent<P, P, E, Exclude<ExtractContext<Eff>, PropsMarker<P>>>(
      componentFn,
      [],
      runFn,
    );
  };
}

/**
 * Create a function that creates components with props from a generator directly.
 * @internal
 */
function genWithPropsDirect<P extends object>(): <
  Eff extends ComponentYieldable,
  AEff extends ComponentResult,
>(
  f: (
    Props: ServiceMap.Service<PropsMarker<P>, P>,
    resume?: LegacyGenResume,
  ) => Generator<Eff, AEff, never>,
) => Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> {
  const withProps = genWithProps<P>();

  return <Eff extends ComponentYieldable, AEff extends ComponentResult>(
    f: (
      Props: ServiceMap.Service<PropsMarker<P>, P>,
      resume?: LegacyGenResume,
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
) => Generator<ComponentYieldable, ComponentResult, never>;

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
  <Eff extends ComponentYieldable>(
    f: (resume: LegacyGenResume) => Generator<Eff, ComponentResult, never>,
  ): Component.Type<never, ExtractError<Eff>, ExtractContext<Eff>>;
  <
    P extends object = {},
    Eff extends ComponentYieldable = EffectYieldable<unknown, unknown, unknown>,
  >(
    f: (
      Props: ServiceMap.Service<PropsMarker<P>, P>,
      resume?: LegacyGenResume,
    ) => Generator<Eff, ComponentResult, never>,
  ): Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>>;
  <P extends object = {}>(): <
    Eff extends ComponentYieldable = EffectYieldable<unknown, unknown, unknown>,
  >(
    f: (
      Props: ServiceMap.Service<PropsMarker<P>, P>,
    ) => (resume: LegacyGenResume) => Generator<Eff, ComponentResult, never>,
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
