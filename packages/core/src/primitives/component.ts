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
 *   return Effect.gen(function* () {
 *     return <Card title="Hello" />
 *   }).pipe(Component.provide(themeLayer))
 * })
 *
 * mount(container, <App />)
 * ```
 */
import { Context, Effect, Layer } from "effect";
import { YieldWrap } from "effect/Utils";
import { type Element, componentElement, provideElement } from "./element.js";

const emptyContext = Context.unsafeMake<unknown>(new Map());

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

const tagComponent = <Props, E, R>(fn: (props: any) => Element): Component.Type<Props, E, R> =>
  Object.assign(fn, { _tag: effectComponentTag });

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
 * Component type - a callable that returns an Element when used in JSX.
 * Tracks Props, Error, and Requirements (services needed from parent context).
 * @since 1.0.0
 */
export declare namespace Component {
  export interface Type<Props = never, _E = never, _R = never> {
    readonly _tag: "EffectComponent";
    (props: [Props] extends [never] ? {} : Props): Element;
  }
}

/**
 * Provide services to a component effect and propagate to children.
 *
 * Use this instead of Effect.provide() when the returned JSX should
 * make the provided services available to child components.
 *
 * Accepts a single layer or an array of layers.
 *
 * @example
 * ```tsx
 * // Single layer
 * Component.provide(ThemeLive)
 *
 * // Multiple layers
 * Component.provide([ThemeLive, AuthLive, HttpClientLive])
 * ```
 *
 * @since 1.0.0
 */
export const provide: {
  <ROut, E2, RIn>(
    layer: Layer.Layer<ROut, E2, RIn>,
  ): <E, R>(
    self: Effect.Effect<Element, E, R>,
  ) => Effect.Effect<Element, E | E2, RIn | Exclude<R, ROut>>;
  <Layers extends ReadonlyArray<Layer.Layer.Any>>(
    layers: Layers,
  ): <E, R>(
    self: Effect.Effect<Element, E, R>,
  ) => Effect.Effect<
    Element,
    E | { [K in keyof Layers]: Layer.Layer.Error<Layers[K]> }[number],
    | { [K in keyof Layers]: Layer.Layer.Context<Layers[K]> }[number]
    | Exclude<R, { [K in keyof Layers]: Layer.Layer.Success<Layers[K]> }[number]>
  >;
} = <ROut, E2, RIn>(layerOrLayers: Layer.Layer<ROut, E2, RIn> | ReadonlyArray<Layer.Layer.Any>) => {
  const layer = Array.isArray(layerOrLayers)
    ? (Layer.mergeAll as (...layers: ReadonlyArray<Layer.Layer.Any>) => Layer.Layer.Any)(
        ...layerOrLayers,
      )
    : layerOrLayers;

  return <E, R>(self: Effect.Effect<Element, E, R>) =>
    Effect.contextWithEffect((context: Context.Context<R | ROut>) =>
      Effect.map(self, (element) => provideElement(Context.merge(emptyContext, context), element)),
    ).pipe(Effect.provide(layer as Layer.Layer<ROut, E2, RIn>));
};

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

  const componentFn = (_props: {}): Element => {
    const run = (): Effect.Effect<Element, E, unknown> => normalizeResult(Effect.gen(f));

    return componentElement(run);
  };

  return tagComponent(componentFn);
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

    const componentFn = (props: P): Element => {
      const run = (): Effect.Effect<Element, E, unknown> => {
        const baseEffect = Effect.gen(f(PropsTag));
        const withProps = Effect.provideService(baseEffect, PropsTag, props);
        return normalizeResult(withProps);
      };

      return componentElement(run);
    };

    return tagComponent(componentFn);
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
  throw new Error("Component.gen: expected a generator function or call with type parameter first");
};
