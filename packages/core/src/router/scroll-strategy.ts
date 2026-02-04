/**
 * @since 1.0.0
 * Scroll Strategy
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
 */
import { Context, Layer } from "effect";

/**
 * Auto — save/restore scroll per history entry via sessionStorage.
 * New navigation scrolls to top. Back/forward restores. Hash scrolls to element.
 * @since 1.0.0
 */
export interface ScrollAuto {
  readonly _tag: "Auto";
}

/**
 * None — no scroll management. For tabs, modals, or routes where scroll should not change.
 * @since 1.0.0
 */
export interface ScrollNone {
  readonly _tag: "None";
}

/**
 * Union of all scroll strategies. Extend when adding new variants.
 * @since 1.0.0
 */
export type ScrollStrategyType = ScrollAuto | ScrollNone;

/**
 * ScrollStrategy Context.Tag.
 * @since 1.0.0
 */
/** @internal */
const autoStrategy: ScrollAuto = { _tag: "Auto" };

/** @internal */
const noneStrategy: ScrollNone = { _tag: "None" };

/**
 * ScrollStrategy Context.Tag — controls scroll position management per route.
 *
 * Consumed by the outlet after route matching. The resolved strategy type is
 * passed to the router's `_applyScroll`, which dispatches on `_tag`:
 *   - `Auto` → save/restore via sessionStorage
 *   - `None` → no-op
 *
 * @since 1.0.0
 */
export class ScrollStrategy extends Context.Tag("trygg/ScrollStrategy")<
  ScrollStrategy,
  ScrollStrategyType
>() {
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
