/**
 * @since 1.0.0
 * Component API for effect-ui
 * 
 * Enables JSX components with typed props and automatic layer injection:
 * 
 * @example
 * ```tsx
 * import { Context, Effect, Layer } from "effect"
 * import { Component, mount } from "effect-ui"
 * 
 * // Define a service
 * class Theme extends Context.Tag("Theme")<Theme, { primary: string }>() {}
 * 
 * // Create component with typed props and service requirements
 * const Card = Component<{ title: string }>()(Props => 
 *   Effect.gen(function* () {
 *     const { title } = yield* Props
 *     const theme = yield* Theme
 *     return (
 *       <div style={{ color: theme.primary }}>
 *         <h1>{title}</h1>
 *       </div>
 *     )
 *   })
 * )
 * 
 * // TypeScript infers Card accepts: { title: string, theme: Layer<Theme> }
 * const themeLayer = Layer.succeed(Theme, { primary: "blue" })
 * mount(container, <Card title="Hello" theme={themeLayer} />)
 * ```
 */
import { Context, Effect, Layer, Option } from "effect"
import { YieldWrap } from "effect/Utils"
import { type Element, componentElement } from "./Element.js"

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Marker interface for Props service - distinguishes props from other services.
 * Used as the identifier type for the Props Context.Tag.
 * @since 1.0.0
 */
export interface PropsMarker<P> {
  readonly _brand: "@effect-ui/Props"
  readonly _P: P
}

/**
 * Convert a Tag class to a layer prop entry.
 * 
 * Uses Context.TagClassShape to extract the key from Tag classes
 * declared with `class Theme extends Context.Tag("Theme")<Theme, Service>() {}`.
 * 
 * Maps Theme with key "Theme" to `{ readonly theme: Layer<Theme> }`.
 * 
 * Note: Layer<Theme> is the correct type because:
 * - Layer.succeed(Theme, {...}) creates Layer<Theme, never, never>
 * - The Layer's output type is the Tag class itself, not the service type
 * 
 * PropsMarker types are excluded (they become regular props, not layer props).
 * 
 * @internal
 */
type TagToLayerProp<T> = 
  // Skip PropsMarker - those are regular props, not layer props
  T extends PropsMarker<infer _P>
    ? never
    // Use TagClassShape to extract key from Tag classes
    // Layer<T> because Layer.succeed(Tag, value) produces Layer<Tag>
    : T extends Context.TagClassShape<infer K extends string, infer _Service>
      ? { readonly [Key in Uncapitalize<K>]: Layer.Layer<T> }
      : never

/**
 * Helper to convert union to intersection.
 * Transforms `A | B` into `A & B`.
 * @internal
 */
type UnionToIntersection<U> = 
  (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
    ? I
    : never

/**
 * Map Effect requirements (R type) to layer props.
 * 
 * For an Effect with R = Theme | Logger, produces:
 * `{ readonly theme: Layer<ThemeService> } & { readonly logger: Layer<LoggerService> }`
 * 
 * PropsMarker types in R are automatically excluded.
 * 
 * @internal
 */
type RequirementsToLayerProps<R> = UnionToIntersection<TagToLayerProp<R>>

/**
 * Combined props type for a component: regular props P + layer props from R.
 * 
 * For `Component<{ title: string }>()` with an effect requiring Theme:
 * - P = { title: string }
 * - R = PropsMarker<{ title: string }> | Theme
 * - Result = { title: string } & { readonly theme: Layer<ThemeService> }
 * 
 * @since 1.0.0
 */
export type ComponentProps<P, R> = P & RequirementsToLayerProps<R>

// =============================================================================
// Runtime Utilities
// =============================================================================

/**
 * Check if a value is a Layer
 * @internal
 */
const isLayer = (value: unknown): value is Layer.Layer<unknown, unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Layer.LayerTypeId in value

/**
 * Separate layer props from regular props.
 * 
 * SAFE CAST RATIONALE: This function takes props of type `P & LayerProps<R>` and
 * separates them into layers and regular props. The cast to `P` is safe because
 * we're extracting exactly the non-layer properties, which by definition are `P`.
 * TypeScript cannot verify this statically because it requires runtime inspection.
 * 
 * @internal
 */
const separateProps = <P extends object>(
  allProps: object
): { layers: Array<Layer.Layer<unknown, unknown, unknown>>; regularProps: P } => {
  const layers: Array<Layer.Layer<unknown, unknown, unknown>> = []
  const regularProps: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(allProps)) {
    if (isLayer(value)) {
      layers.push(value)
    } else {
      regularProps[key] = value
    }
  }

  // SAFE CAST: regularProps contains exactly the non-layer properties from allProps.
  // Since allProps is P & LayerProps<R>, and we've removed all layers, what remains is P.
  return { layers, regularProps: regularProps as P }
}

/**
 * Merge multiple layers into one.
 * 
 * SAFE CAST RATIONALE: Layer.mergeAll accepts heterogeneous layers at runtime.
 * TypeScript's variance rules prevent assigning Layer<A, E1, R1> to Layer<unknown, unknown, unknown>
 * due to contravariance in R. However, merging layers is runtime-correct regardless of types.
 * The resulting merged layer correctly provides all services from all input layers.
 * 
 * @internal
 */
const mergeAllLayers = (
  layers: ReadonlyArray<Layer.Layer<unknown, unknown, unknown>>
): Option.Option<Layer.Layer<unknown, unknown, unknown>> => {
  if (layers.length === 0) {
    return Option.none()
  }
  
  const first = layers[0]
  if (first === undefined) {
    return Option.none()
  }
  
  if (layers.length === 1) {
    return Option.some(first)
  }
  
  // SAFE: Layer.mergeAll handles heterogeneous layers correctly at runtime
  let result: Layer.Layer<unknown, unknown, unknown> = first
  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i]
    if (layer !== undefined) {
      result = Layer.mergeAll(result, layer)
    }
  }
  return Option.some(result)
}

// =============================================================================
// Component Types
// =============================================================================

/**
 * Component type - a callable that returns an Element when used in JSX.
 * @since 1.0.0
 */
export interface ComponentType<Props = Record<string, never>, E = never> {
  readonly _tag: "EffectComponent"
  (props: Props): Element
}

// =============================================================================
// Component Function
// =============================================================================

/**
 * Create a JSX-compatible component with typed props and automatic layer injection.
 * 
 * Component is curried: first specify the props type, then provide a function
 * that receives a typed `Props` tag and returns an Effect<Element>.
 * 
 * Service requirements from the effect are automatically mapped to layer props.
 * For example, if your effect requires `Theme`, the component will accept a
 * `theme: Layer<Theme>` prop that gets auto-provided.
 * 
 * @example
 * ```tsx
 * // Component with typed props and service requirements
 * const Card = Component<{ title: string; onClick?: () => Effect.Effect<void> }>()(Props => 
 *   Effect.gen(function* () {
 *     const { title, onClick } = yield* Props
 *     const theme = yield* Theme
 *     return (
 *       <div style={{ color: theme.primary }} onClick={onClick}>
 *         <h1>{title}</h1>
 *       </div>
 *     )
 *   })
 * )
 * 
 * // TypeScript infers: { title: string, onClick?: ..., theme: Layer<Theme> }
 * <Card title="Hello" theme={themeLayer} />
 * ```
 * 
 * @example
 * ```tsx
 * // Component with only service requirements (no regular props)
 * const ThemedButton = Component()(Props => 
 *   Effect.gen(function* () {
 *     yield* Props  // Props is {} - empty but required to access the tag
 *     const theme = yield* Theme
 *     return <button style={{ color: theme.primary }}>Click</button>
 *   })
 * )
 * 
 * <ThemedButton theme={themeLayer} />
 * ```
 * 
 * @since 1.0.0
 */
export function Component<P extends object = {}>(): <E, R>(
  effectFn: (Props: Context.Tag<PropsMarker<P>, P>) => Effect.Effect<Element, E, R>
) => ComponentType<ComponentProps<P, R>, E> {
  return <E, R>(
    effectFn: (Props: Context.Tag<PropsMarker<P>, P>) => Effect.Effect<Element, E, R>
  ): ComponentType<ComponentProps<P, R>, E> => {
    // Create a unique Props tag for this component instance
    const PropsTag = Context.GenericTag<PropsMarker<P>, P>("@effect-ui/Props")
    
    const componentFn = (allProps: ComponentProps<P, R>): Element => {
      const { layers, regularProps } = separateProps<P>(allProps)
      
      // Create the effect by calling effectFn with the Props tag
      const baseEffect = effectFn(PropsTag)
      
      // Create Props layer from regularProps
      const propsLayer = Layer.succeed(PropsTag, regularProps)
      
      // Create thunk that produces the final effect with all layers provided
      const run = (): Effect.Effect<Element, E, never> => {
        // Start with the base effect
        let effect = baseEffect
        
        // Provide the props layer first
        // SAFE CAST: propsLayer provides PropsMarker<P>, which is part of R.
        // After providing, R becomes R - PropsMarker<P>.
        effect = Effect.provide(effect, propsLayer) as typeof effect
        
        // Provide all other layers (service requirements from R)
        const mergedOther = mergeAllLayers(layers)
        if (Option.isSome(mergedOther)) {
          // SAFE CAST: The layers array contains exactly the Layer props passed by the user.
          // TypeScript enforces at the call site that all required layers are provided.
          // After providing these layers, R should be never (all requirements satisfied).
          effect = Effect.provide(effect, mergedOther.value) as typeof effect
        }
        
        // SAFE CAST: After providing propsLayer and all service layers, R should be never.
        // TypeScript enforces at ComponentProps<P, R> that all required layers are passed.
        // If a layer is missing, the call site will have a type error.
        return effect as Effect.Effect<Element, E, never>
      }
      
      return componentElement(run)
    }
    
    // Mark as EffectComponent for JSX runtime detection
    Object.defineProperty(componentFn, "_tag", {
      value: "EffectComponent",
      writable: false,
      enumerable: true
    })
    
    return componentFn as ComponentType<ComponentProps<P, R>, E>
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is an EffectComponent
 * @since 1.0.0
 */
export const isEffectComponent = (value: unknown): value is ComponentType<unknown> =>
  typeof value === "function" &&
  "_tag" in value &&
  (value as { _tag: unknown })._tag === "EffectComponent"

/**
 * Check if a value is a legacy component (has .effect property)
 * @internal
 */
export const isLegacyComponent = (value: unknown): value is { effect: Effect.Effect<Element, unknown, never> } =>
  typeof value === "function" &&
  "effect" in value &&
  Effect.isEffect((value as { effect: unknown }).effect)

// =============================================================================
// Component.gen API
// =============================================================================

/**
 * Type alias for the YieldWrap type used in Effect.gen
 * @internal
 */
type EffectYieldWrap<A, E, R> = YieldWrap<Effect.Effect<A, E, R>>

/**
 * Extract error type from YieldWrap union
 * @internal
 */
type ExtractError<Eff> = [Eff] extends [never] 
  ? never 
  : [Eff] extends [YieldWrap<Effect.Effect<infer _A, infer E, infer _R>>] 
    ? E 
    : never

/**
 * Extract context type from YieldWrap union
 * @internal  
 */
type ExtractContext<Eff> = [Eff] extends [never] 
  ? never 
  : [Eff] extends [YieldWrap<Effect.Effect<infer _A, infer _E, infer R>>] 
    ? R 
    : never

/**
 * Create component without props from generator function.
 * @internal
 */
function genNoProps<Eff extends EffectYieldWrap<unknown, unknown, unknown>, AEff extends Element>(
  f: (resume: Effect.Adapter) => Generator<Eff, AEff, never>
): ComponentType<RequirementsToLayerProps<ExtractContext<Eff>>, ExtractError<Eff>> {
  type R = ExtractContext<Eff>
  type E = ExtractError<Eff>
  
  const componentFn = (allProps: RequirementsToLayerProps<R>): Element => {
    // Handle case where allProps might be {} or have properties
    const { layers } = separateProps<Record<string, unknown>>(allProps as Record<string, unknown>)
    
    // Create thunk that produces the final effect with all layers provided
    const run = (): Effect.Effect<Element, E, never> => {
      // Create the base effect using Effect.gen
      const baseEffect = Effect.gen(f)
      
      // Provide all layers (service requirements)
      const mergedLayers = mergeAllLayers(layers)
      if (Option.isSome(mergedLayers)) {
        const provided = Effect.provide(baseEffect, mergedLayers.value)
        // SAFE CAST: After providing all required layers, R becomes never.
        // The public type signature ensures all required layers are provided.
        return provided as unknown as Effect.Effect<Element, E, never>
      }
      
      // SAFE CAST: No layers needed means R was already never.
      return baseEffect as unknown as Effect.Effect<Element, E, never>
    }
    
    return componentElement(run)
  }
  
  // Mark as EffectComponent for JSX runtime detection
  Object.defineProperty(componentFn, "_tag", {
    value: "EffectComponent",
    writable: false,
    enumerable: true
  })
  
  return componentFn as ComponentType<RequirementsToLayerProps<R>, E>
}

/**
 * Create a function that creates components with props from generator factory.
 * @internal
 */
function genWithProps<P extends object>(): <
  Eff extends EffectYieldWrap<unknown, unknown, unknown>,
  AEff extends Element
>(
  f: (Props: Context.Tag<PropsMarker<P>, P>) => (resume: Effect.Adapter) => Generator<Eff, AEff, never>
) => ComponentType<ComponentProps<P, Exclude<ExtractContext<Eff>, PropsMarker<P>>>, ExtractError<Eff>> {
  
  return <Eff extends EffectYieldWrap<unknown, unknown, unknown>, AEff extends Element>(
    f: (Props: Context.Tag<PropsMarker<P>, P>) => (resume: Effect.Adapter) => Generator<Eff, AEff, never>
  ): ComponentType<ComponentProps<P, Exclude<ExtractContext<Eff>, PropsMarker<P>>>, ExtractError<Eff>> => {
    type R = Exclude<ExtractContext<Eff>, PropsMarker<P>>
    type E = ExtractError<Eff>
    
    // Create a unique Props tag for this component instance
    const PropsTag = Context.GenericTag<PropsMarker<P>, P>("@effect-ui/Props")
    
    const componentFn = (allProps: ComponentProps<P, R>): Element => {
      const { layers, regularProps } = separateProps<P>(allProps)
      
      // Create Props layer from regularProps
      const propsLayer = Layer.succeed(PropsTag, regularProps)
      
      // Create thunk that produces the final effect with all layers provided
      const run = (): Effect.Effect<Element, E, never> => {
        // Create effect from generator, passing PropsTag
        const baseEffect = Effect.gen(f(PropsTag))
        
        // Provide the props layer first
        const withProps = Effect.provide(baseEffect, propsLayer)
        
        // Provide all other layers (service requirements)
        const mergedOther = mergeAllLayers(layers)
        const fullyProvided = Option.isSome(mergedOther)
          ? Effect.provide(withProps, mergedOther.value)
          : withProps
        
        // SAFE CAST: After providing propsLayer and all required layers, R becomes never.
        // The public type signature ensures all required layers are provided.
        return fullyProvided as unknown as Effect.Effect<Element, E, never>
      }
      
      return componentElement(run)
    }
    
    // Mark as EffectComponent for JSX runtime detection
    Object.defineProperty(componentFn, "_tag", {
      value: "EffectComponent",
      writable: false,
      enumerable: true
    })
    
    return componentFn as ComponentType<ComponentProps<P, R>, E>
  }
}

/**
 * Check if a function is a generator function
 * @internal
 */
const isGeneratorFunction = (fn: Function): boolean => {
  return fn.constructor.name === "GeneratorFunction"
}

/**
 * Component.gen - Create components using generator syntax.
 * 
 * Two usage patterns:
 * 1. Without props: `Component.gen(function* () { ... })`
 * 2. With props: `Component.gen<{ title: string }>()(Props => function* () { ... })`
 * 
 * Service requirements are automatically mapped to layer props.
 * 
 * @example
 * ```tsx
 * // Without props - just pass the generator directly
 * const ThemedCard = Component.gen(function* () {
 *   const theme = yield* Theme
 *   return <div style={{ color: theme.text }}>{theme.name}</div>
 * })
 * 
 * // With typed props - call with type param first, then pass generator factory
 * const Card = Component.gen<{ title: string }>()(Props => function* () {
 *   const { title } = yield* Props
 *   const theme = yield* Theme
 *   return <div style={{ color: theme.primary }}>{title}</div>
 * })
 * 
 * // TypeScript infers: { title: string, theme: Layer<Theme> }
 * <Card title="Hello" theme={themeLayer} />
 * ```
 * 
 * @since 1.0.0
 */
export function gen<Eff extends EffectYieldWrap<unknown, unknown, unknown>, AEff extends Element>(
  f: (resume: Effect.Adapter) => Generator<Eff, AEff, never>
): ComponentType<RequirementsToLayerProps<ExtractContext<Eff>>, ExtractError<Eff>>

export function gen<P extends object>(): <Eff extends EffectYieldWrap<unknown, unknown, unknown>, AEff extends Element>(
  f: (Props: Context.Tag<PropsMarker<P>, P>) => (resume: Effect.Adapter) => Generator<Eff, AEff, never>
) => ComponentType<ComponentProps<P, Exclude<ExtractContext<Eff>, PropsMarker<P>>>, ExtractError<Eff>>

export function gen<P extends object>(
  f?: Function
): unknown {
  // If f is provided and is a generator function, it's overload 1 (no props)
  if (f !== undefined && isGeneratorFunction(f)) {
    return genNoProps(f as (resume: Effect.Adapter) => Generator<EffectYieldWrap<unknown, unknown, unknown>, Element, never>)
  }
  // If f is not provided, return the curried function for overload 2 (with props)
  if (f === undefined) {
    return genWithProps<P>()
  }
  // Otherwise f is a regular function that should be a generator factory
  // This handles the case where someone passes a non-generator function to the first overload
  throw new Error("Component.gen: expected a generator function or call with type parameter first")
}
