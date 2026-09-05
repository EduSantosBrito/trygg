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
import { Effect, Layer, Pipeable, Predicate, Schema } from "effect";
import * as Context from "effect/Context";
import { unsafeTagCallable } from "../internal/unsafe.js";
import {
  Element,
  type ComponentElementWithRequirements,
  type ElementRequirementsOf,
} from "./element.js";

/**
 * Error raised when an invalid component type is used in JSX.
 * @since 1.0.0
 */
export class InvalidComponentError extends Schema.TaggedError<InvalidComponentError>()(
  "InvalidComponentError",
  {
    reason: Schema.Union([
      Schema.Literal("plain-function"),
      Schema.Literal("effect"),
      Schema.Literal("unknown"),
    ]),
    displayName: Schema.optional(Schema.String),
  },
) {}

/**
 * Error raised when Component.gen is called incorrectly.
 * @since 1.0.0
 */
export class ComponentGenError extends Schema.TaggedError<ComponentGenError>()(
  "ComponentGenError",
  {
    message: Schema.String,
  },
) {}

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

type ComponentResult = Element | Effect.Effect<Element, unknown, never | object>;
type ComponentCallProps<Props> = [Props] extends [never] ? {} : Props;
type ExtractResultError<Result> = [Result] extends [Effect.Effect<unknown, infer E, infer _R>]
  ? E
  : never;
type ExtractResultContext<Result> = [Result] extends [Effect.Effect<infer A, infer _E, infer R>]
  ? R | ElementRequirementsOf<A>
  : ElementRequirementsOf<Result>;
type ComponentError<Eff, Result> = ExtractError<Eff> | ExtractResultError<Result>;
type ComponentContext<Eff, Result> = ExtractContext<Eff> | ExtractResultContext<Result>;
// oxlint-disable-next-line effect/no-unknown-runtime-requirements -- This yield constraint is existential, preserves concrete R, and is not an executable root (RFC 5.2, 8.4, 9.2).
type ComponentYieldable = Effect.Effect<unknown, unknown, unknown>;
type LegacyGenResume = undefined;

const effectComponentTag = "EffectComponent";

/**
 * Tag a component function with Component metadata.
 * @internal
 */
export const tagComponent = <Props, RuntimeProps, E, R>(
  fn: (props: RuntimeProps) => Element,
  layers: ReadonlyArray<unknown> = [],
  runFn?: (props: RuntimeProps) => Effect.Effect<Element, E, R>,
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
function makeComponent<P extends object = {}>(): <A extends ComponentResult, E, R>(
  effectFn: (Props: Context.Service<PropsMarker<P>, P>) => Effect.Effect<A, E, R>,
) => Component.Type<
  P,
  E | ExtractResultError<A>,
  Exclude<R | ExtractResultContext<A>, PropsMarker<P>>
> {
  return <A extends ComponentResult, E, R>(
    effectFn: (Props: Context.Service<PropsMarker<P>, P>) => Effect.Effect<A, E, R>,
  ): Component.Type<
    P,
    E | ExtractResultError<A>,
    Exclude<R | ExtractResultContext<A>, PropsMarker<P>>
  > => {
    const PropsTag = Context.Service<PropsMarker<P>, P & {}>("@trygg/Props");

    const componentFn = (props: P): Element => {
      const run = (): Effect.Effect<Element, E, R> => {
        const baseEffect = effectFn(PropsTag);
        const withProps = Effect.provideService(baseEffect, PropsTag, props);
        return normalizeResult(withProps);
      };

      return Element.fromEffect(Effect.suspend(run), { identity: componentFn, inputs: props });
    };

    return tagComponent<
      P,
      P,
      E | ExtractResultError<A>,
      Exclude<R | ExtractResultContext<A>, PropsMarker<P>>
    >(componentFn);
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
    readonly _runFn?: (props: ComponentCallProps<Props>) => unknown;
    readonly _displayName?: string;
    readonly pipe: Pipeable.Pipeable["pipe"];
    (props: ComponentCallProps<Props>): ComponentElementWithRequirements<_R>;
  }
}

// =============================================================================
// Type Guards
// =============================================================================

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
  typeof value === "function" && Predicate.isTagged(value, effectComponentTag);

// =============================================================================
// Component.gen API
// =============================================================================

/**
 * Type alias for Effect v4 yieldables used in Effect.gen
 * @internal
 */
type EffectYieldable<A, E, R> = Effect.Effect<A, E, R>;

/**
 * Extract error type from yieldable union
 * @internal
 */
type ExtractError<Eff> = [Eff] extends [never]
  ? never
  : [Eff] extends [Effect.Effect<infer _A, infer E, infer _R>]
    ? E
    : never;

/**
 * Extract context (requirements) type from yieldable union
 * @internal
 */
type ExtractContext<Eff> = [Eff] extends [never]
  ? never
  : [Eff] extends [Effect.Effect<infer _A, infer _E, infer R>]
    ? R
    : never;

/**
 * Create component without props from generator function.
 * @internal
 */
function genNoProps<Eff extends ComponentYieldable, AEff extends ComponentResult>(
  f: (resume: LegacyGenResume) => Generator<Eff, AEff, never>,
): Component.Type<never, ComponentError<Eff, AEff>, ComponentContext<Eff, AEff>> {
  const runFn = (): Effect.Effect<
    Element,
    ComponentError<Eff, AEff>,
    ComponentContext<Eff, AEff>
  > => normalizeResult(Effect.gen(() => f(undefined)));

  const componentFn = (_props: {}): Element =>
    Element.fromEffect(Effect.suspend(runFn), { identity: componentFn });

  return tagComponent<never, {}, ComponentError<Eff, AEff>, ComponentContext<Eff, AEff>>(
    componentFn,
    [],
    runFn,
  );
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
) => Component.Type<
  P,
  ComponentError<Eff, AEff>,
  Exclude<ComponentContext<Eff, AEff>, PropsMarker<P>>
> {
  return <Eff extends ComponentYieldable, AEff extends ComponentResult>(
    f: (
      Props: Context.Service<PropsMarker<P>, P>,
    ) => (resume: LegacyGenResume) => Generator<Eff, AEff, never>,
  ): Component.Type<
    P,
    ComponentError<Eff, AEff>,
    Exclude<ComponentContext<Eff, AEff>, PropsMarker<P>>
  > => {
    const PropsTag = Context.Service<PropsMarker<P>, P & {}>("@trygg/Props");

    const runFn = (
      props: P,
    ): Effect.Effect<
      Element,
      ComponentError<Eff, AEff>,
      Exclude<ComponentContext<Eff, AEff>, PropsMarker<P>>
    > => {
      const baseEffect = Effect.gen(() => f(PropsTag)(undefined));
      const withProps = Effect.provideService(baseEffect, PropsTag, props);
      return normalizeResult(withProps);
    };

    const componentFn = (props: P): Element =>
      Element.fromEffect(
        Effect.suspend(() => runFn(props)),
        { identity: componentFn, inputs: props },
      );

    return tagComponent<
      P,
      P,
      ComponentError<Eff, AEff>,
      Exclude<ComponentContext<Eff, AEff>, PropsMarker<P>>
    >(componentFn, [], runFn);
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
) => Component.Type<
  P,
  ComponentError<Eff, AEff>,
  Exclude<ComponentContext<Eff, AEff>, PropsMarker<P>>
> {
  const withProps = genWithProps<P>();

  return <Eff extends ComponentYieldable, AEff extends ComponentResult>(
    f: (
      Props: Context.Service<PropsMarker<P>, P>,
      resume?: LegacyGenResume,
    ) => Generator<Eff, AEff, never>,
  ): Component.Type<
    P,
    ComponentError<Eff, AEff>,
    Exclude<ComponentContext<Eff, AEff>, PropsMarker<P>>
  > => withProps((Props) => (resume) => f(Props, resume));
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
export function gen<Eff extends ComponentYieldable, AEff extends ComponentResult>(
  f: (resume: LegacyGenResume) => Generator<Eff, AEff, never>,
): Component.Type<never, ComponentError<Eff, AEff>, ComponentContext<Eff, AEff>>;
export function gen<
  P extends object = {},
  Eff extends ComponentYieldable = EffectYieldable<unknown, unknown, unknown>,
  AEff extends ComponentResult = ComponentResult,
>(
  f: (
    Props: Context.Service<PropsMarker<P>, P>,
    resume?: LegacyGenResume,
  ) => Generator<Eff, AEff, never>,
): Component.Type<
  P,
  ComponentError<Eff, AEff>,
  Exclude<ComponentContext<Eff, AEff>, PropsMarker<P>>
>;
export function gen<P extends object = {}>(): <
  Eff extends ComponentYieldable = EffectYieldable<unknown, unknown, unknown>,
  AEff extends ComponentResult = ComponentResult,
>(
  f: (
    Props: Context.Service<PropsMarker<P>, P>,
  ) => (resume: LegacyGenResume) => Generator<Eff, AEff, never>,
) => Component.Type<
  P,
  ComponentError<Eff, AEff>,
  Exclude<ComponentContext<Eff, AEff>, PropsMarker<P>>
>;
export function gen<P extends object>(f?: unknown): unknown {
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
}

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
