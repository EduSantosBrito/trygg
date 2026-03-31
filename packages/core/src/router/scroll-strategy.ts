/**
 * Scroll strategy primitives for `trygg/router`.
 *
 * @remarks
 * Owner module for route scroll behavior. This module owns the strategy union
 * and the service tag whose layers configure automatic scroll restoration or no
 * scroll management.
 *
 * Controls scroll position management during navigation.
 * Uses SessionStorage service keyed by navigation entry.
 *
 * @example
 * ```tsx
 * import { ScrollStrategy } from "trygg/router"
 *
 * Route.make("/settings")
 *   .layout(SettingsLayout)
 *   .children(...)
 *   .pipe(Route.provide(ScrollStrategy.None))
 * ```
 * @since 1.0.0
 * @module trygg/router/scroll-strategy
 */
import { Layer } from "effect";
import * as ServiceMap from "effect/ServiceMap";

/**
 * Auto — save/restore scroll per history entry via sessionStorage.
 * New navigation scrolls to top. Back/forward restores. Hash scrolls to element.
 *
 * @remarks
 * `ScrollAuto` is the default browser-like behavior used by the outlet when no
 * route overrides scroll handling.
 *
 * @example
 * ```ts
 * type Strategy = ScrollAuto
 * ```
 *
 * @category Scroll Strategies
 * @public
 * @since 1.0.0
 */
export interface ScrollAuto {
  readonly _tag: "Auto";
}

/**
 * None — no scroll management. For tabs, modals, or routes where scroll should not change.
 *
 * @remarks
 * `ScrollNone` disables all outlet-managed scroll behavior for a route tree.
 *
 * @example
 * ```ts
 * type Strategy = ScrollNone
 * ```
 *
 * @category Scroll Strategies
 * @public
 * @since 1.0.0
 */
export interface ScrollNone {
  readonly _tag: "None";
}

/**
 * Union of all scroll strategies. Extend when adding new variants.
 *
 * @remarks
 * `ScrollStrategyType` is the pure-data union the router dispatches on after it
 * resolves the nearest scroll strategy layer.
 *
 * @example
 * ```ts
 * const strategy: ScrollStrategyType = { _tag: "Auto" }
 * ```
 *
 * @category Scroll Strategies
 * @public
 * @since 1.0.0
 */
export type ScrollStrategyType = ScrollAuto | ScrollNone;

/**
 * ScrollStrategy service key.
 * @since 1.0.0
 */
/** @internal */
const autoStrategy: ScrollAuto = { _tag: "Auto" };

/** @internal */
const noneStrategy: ScrollNone = { _tag: "None" };

/**
 * ScrollStrategy service key — controls scroll position management per route.
 *
 * Consumed by the outlet after route matching. The resolved strategy type is
 * passed to the router's `_applyScroll`, which dispatches on `_tag`:
 *   - `Auto` → save/restore via sessionStorage
 *   - `None` → no-op
 *
 * @remarks
 * Apply `ScrollStrategy` with `Route.provide(...)` when a route tree should opt
 * out of default scroll restoration or make that behavior explicit.
 *
 * @example
 * ```tsx
 * Route.make("/settings").layout(SettingsLayout).pipe(Route.provide(ScrollStrategy.None))
 * ```
 *
 * @category Scroll Strategies
 * @public
 * @since 1.0.0
 */
export class ScrollStrategy extends ServiceMap.Service<ScrollStrategy, ScrollStrategyType>()(
  "trygg/ScrollStrategy",
) {
  /**
   * Auto scroll management:
   * - New navigation: scroll to top
   * - Back/Forward: restore from sessionStorage
   * - Hash links: scroll to element
   */
  static readonly Auto: Layer.Layer<ScrollStrategy> = Layer.succeed(ScrollStrategy, autoStrategy);

  /**
   * No scroll management.
   * For tabs, modals, or routes where scroll should not change.
   */
  static readonly None: Layer.Layer<ScrollStrategy> = Layer.succeed(ScrollStrategy, noneStrategy);
}
