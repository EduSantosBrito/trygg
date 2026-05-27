/**
 * Component creation primitives for the root `Component` API.
 *
 * @remarks
 * Owner module for the `Component` topic. This module owns the callable
 * `Component` export, `Component.gen`, and the typing helpers used to thread
 * props and service requirements through JSX components.
 *
 * @see ./component.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/primitives/component
 */
import { Data, Effect, Layer, Pipeable } from "effect";
import * as Context from "effect/Context";
import { unsafeTagCallable } from "../internal/unsafe.js";
import { Element, type ComponentElementWithRequirements } from "./element.js";

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
 *
 * @remarks
 * `PropsMarker<P>` exists so `ComponentProps<P>` can carry the props shape as a
 * service identity without colliding with other services in the component
 * context.
 *
 * @example
 * ```ts
 * type GreetingProps = ComponentProps<{ readonly name: string }>
 * ```
 *
 * @category Components
 * @public
 * @since 1.0.0
 */
export interface PropsMarker<P> {
  readonly _brand: "@trygg/Props";
  readonly _P: P;
}

/**
 * Props service handle yielded inside `Component.gen`.
 *
 * @remarks
 * `ComponentProps<P>` gives generator-based components a typed service they can
 * `yield*` to read their props exactly once during component execution.
 *
 * @example
 * ```tsx
 * const Greeting = Component.gen(function* (Props: ComponentProps<{ name: string }>) {
 *   const { name } = yield* Props
 *   return <h1>{name}</h1>
 * })
 * ```
 *
 * @category Components
 * @public
 * @since 1.0.0
 */
export type ComponentProps<P> = Context.Service<PropsMarker<P>, P>;

// =============================================================================
// Component Types
// =============================================================================

type ComponentResult = Element | Effect.Effect<Element, unknown, unknown>;
type ComponentCallProps<Props> = [Props] extends [never] ? {} : Props;
type ComponentYieldable = Effect.Yieldable.Any;
type LegacyGenResume = undefined;

const effectComponentTag = "EffectComponent" as const;

/**
 * Tag a component function with Component metadata.
 * @internal
 */
export const tagComponent = <Props, RuntimeProps, E, R>(
  fn: (props: RuntimeProps) => Element,
  layers: ReadonlyArray<unknown> = [],
  runFn?: (props: RuntimeProps) => Effect.Effect<Element, E, unknown>,
  displayName?: string,
): Component.Type<Props, E, R> =>
  unsafeTagCallable<Component.Type<Props, E, R>>(fn, {
    _tag: effectComponentTag,
    _layers: layers,
    _runFn: runFn,
    _displayName: displayName,
    pipe() {
      return Pipeable.pipeArguments(this, arguments);
    },
  });

const normalizeResult = <E, R>(
  effect: Effect.Effect<ComponentResult, E, R>,
): Effect.Effect<Element, E, R> =>
  Effect.map(effect, (result) => (Effect.isEffect(result) ? Element.fromEffect(result) : result));

// =============================================================================
// Component Function
// =============================================================================

/**
 * Create a JSX-compatible component with typed props.
 *
 * Service requirements are resolved from the parent context.
 * @since 1.0.0
 */
function makeComponent<P extends object = {}>(): <E, R>(
  effectFn: (Props: Context.Service<PropsMarker<P>, P>) => Effect.Effect<Element, E, R>,
) => Component.Type<P, E, Exclude<R, PropsMarker<P>>> {
  return <E, R>(
    effectFn: (Props: Context.Service<PropsMarker<P>, P>) => Effect.Effect<Element, E, R>,
  ): Component.Type<P, E, Exclude<R, PropsMarker<P>>> => {
    const PropsTag = Context.Service<PropsMarker<P>, P>("@trygg/Props");

    const componentFn = (props: P): Element => {
      const run = (): Effect.Effect<Element, E, R> => {
        const baseEffect = effectFn(PropsTag);
        const withProps = Effect.provideService(baseEffect, PropsTag, props);
        return normalizeResult(withProps);
      };

      return Element.fromEffect(Effect.suspend(run), { identity: componentFn, inputs: props });
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
  readonly _layers: ReadonlyArray<unknown>;
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
    readonly _layers: ReadonlyArray<unknown>;
    readonly _runFn?: (
      props: ComponentCallProps<Props>,
    ) => Effect.Effect<Element, unknown, unknown>;
    readonly _displayName?: string;
    readonly pipe: Pipeable.Pipeable["pipe"];
    (props: ComponentCallProps<Props>): ComponentElementWithRequirements<_R>;
  }
}

// =============================================================================
// Type Guards
// =============================================================================

const hasTag = (value: unknown): value is { _tag: unknown } =>
  typeof value === "function" && value !== null && "_tag" in value;

/**
 * Check whether a value is a trygg component.
 *
 * @remarks
 * Use this guard when a lower-level integration accepts unknown JSX values and
 * needs to distinguish `Component.gen` outputs from plain functions.
 *
 * @example
 * ```ts
 * const value: unknown = Component.gen(function* () {
 *   return <div />
 * })
 *
 * const ok = isEffectComponent(value)
 * ```
 *
 * @category Components
 * @public
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

  const componentFn = (_props: {}): Element =>
    Element.fromEffect(Effect.suspend(runFn), { identity: componentFn });

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
    Props: Context.Service<PropsMarker<P>, P>,
  ) => (resume: LegacyGenResume) => Generator<Eff, AEff, never>,
) => Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> {
  return <Eff extends ComponentYieldable, AEff extends ComponentResult>(
    f: (
      Props: Context.Service<PropsMarker<P>, P>,
    ) => (resume: LegacyGenResume) => Generator<Eff, AEff, never>,
  ): Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> => {
    type E = ExtractError<Eff>;
    const PropsTag = Context.Service<PropsMarker<P>, P>("@trygg/Props");

    const runFn = (props: P): Effect.Effect<Element, E, unknown> => {
      const baseEffect = Effect.gen(() => f(PropsTag)(undefined));
      const withProps = Effect.provideService(baseEffect, PropsTag, props);
      return normalizeResult(withProps);
    };

    const componentFn = (props: P): Element =>
      Element.fromEffect(
        Effect.suspend(() => runFn(props)),
        { identity: componentFn, inputs: props },
      );

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
    Props: Context.Service<PropsMarker<P>, P>,
    resume?: LegacyGenResume,
  ) => Generator<Eff, AEff, never>,
) => Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>> {
  const withProps = genWithProps<P>();

  return <Eff extends ComponentYieldable, AEff extends ComponentResult>(
    f: (
      Props: Context.Service<PropsMarker<P>, P>,
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
      Props: Context.Service<PropsMarker<P>, P>,
      resume?: LegacyGenResume,
    ) => Generator<Eff, ComponentResult, never>,
  ): Component.Type<P, ExtractError<Eff>, Exclude<ExtractContext<Eff>, PropsMarker<P>>>;
  <P extends object = {}>(): <
    Eff extends ComponentYieldable = EffectYieldable<unknown, unknown, unknown>,
  >(
    f: (
      Props: Context.Service<PropsMarker<P>, P>,
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

export const provide =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <Props, E, R>(
    component: Component.Type<Props, E, R>,
  ): Component.Type<Props, E | E2, RIn | Exclude<R, ROut>> => {
    const providedComponent = (props: ComponentCallProps<Props>): Element =>
      Element.fromEffect(Effect.succeed(component(props)), {
        identity: providedComponent,
        inputs: props,
        provider: { layer, displayName: component._displayName },
      });

    return tagComponent<Props, ComponentCallProps<Props>, E | E2, RIn | Exclude<R, ROut>>(
      providedComponent,
      [layer],
      (props) => Effect.succeed(component(props)),
      component._displayName,
    );
  };

type ComponentApi = typeof makeComponent & {
  readonly gen: typeof gen;
  readonly provide: typeof provide;
};

/**
 * Create JSX-compatible components and access `Component.gen`.
 *
 * @remarks
 * `Component` is the public entry surface for component definitions. Call it
 * directly for explicit effect functions, or use `Component.gen` for the
 * generator-based style shown throughout the framework docs.
 *
 * @example
 * ```tsx
 * const Counter = Component.gen(function* () {
 *   return <button>Count</button>
 * })
 * ```
 *
 * @category Components
 * @public
 * @since 1.0.0
 */
export const Component: ComponentApi = Object.assign(makeComponent, {
  gen,
  provide,
});
