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
 *   .scrollStrategy(ScrollStrategy.None)
 * ```
 */
import { Context, Effect, Layer, ParseResult, Schema } from "effect";
import { SessionStorage, type StorageError } from "../platform/storage.js";
import { Scroll, type ScrollError } from "../platform/scroll.js";
import { Dom, type DomError } from "../platform/dom.js";

/**
 * Schema for scroll position serialization.
 * @internal
 */
const ScrollPosition = Schema.Struct({ x: Schema.Number, y: Schema.Number });

/** @internal */
export const ScrollPositionJson = Schema.parseJson(ScrollPosition);

/**
 * Location info for scroll key generation.
 * @since 1.0.0
 */
export interface ScrollLocation {
  readonly pathname: string;
  readonly key: string;
}

/**
 * ScrollStrategy service interface.
 * @since 1.0.0
 */
export interface ScrollStrategyService {
  readonly _tag: "ScrollStrategy";
  /** Generate storage key for this navigation entry */
  readonly getKey: (location: ScrollLocation) => string;
}

/**
 * ScrollStrategy Context.Tag.
 * @since 1.0.0
 */
export class ScrollStrategy extends Context.Tag("trygg/ScrollStrategy")<
  ScrollStrategy,
  ScrollStrategyService
>() {
  /**
   * Auto scroll management:
   * - New navigation: scroll to top
   * - Back/Forward: restore from sessionStorage
   * - Hash links: scroll to element
   */
  static readonly Auto: Layer.Layer<ScrollStrategy> = Layer.succeed(ScrollStrategy, {
    _tag: "ScrollStrategy",
    getKey: (location) => location.key,
  });

  /**
   * No scroll management.
   * For tabs, modals, or routes where scroll should not change.
   */
  static readonly None: Layer.Layer<ScrollStrategy> = Layer.succeed(ScrollStrategy, {
    _tag: "ScrollStrategy",
    getKey: () => "__none__",
  });
}

// =============================================================================
// Scroll Management Runtime
// =============================================================================

/** Storage key prefix for scroll positions in sessionStorage */
const SCROLL_STORAGE_PREFIX = "trygg:scroll:";

/**
 * Save current scroll position to sessionStorage keyed by navigation entry.
 * @internal
 */
export const saveScrollPosition = (
  key: string,
): Effect.Effect<
  void,
  StorageError | ScrollError | ParseResult.ParseError,
  SessionStorage | Scroll
> =>
  Effect.gen(function* () {
    const storage = yield* SessionStorage;
    const scroll = yield* Scroll;
    const position = yield* scroll.getPosition;
    const encoded = yield* Schema.encode(ScrollPositionJson)(position);
    yield* storage.set(SCROLL_STORAGE_PREFIX + key, encoded);
  });

/**
 * Restore scroll position from sessionStorage for a given key.
 * Returns true if position was restored, false otherwise.
 * @internal
 */
export const restoreScrollPosition = (
  key: string,
): Effect.Effect<
  boolean,
  StorageError | ScrollError | ParseResult.ParseError,
  SessionStorage | Scroll
> =>
  Effect.gen(function* () {
    const storage = yield* SessionStorage;
    const scroll = yield* Scroll;
    const stored = yield* storage.get(SCROLL_STORAGE_PREFIX + key);
    if (stored !== null) {
      const position = yield* Schema.decode(ScrollPositionJson)(stored);
      yield* scroll.scrollTo(position.x, position.y);
      return true;
    }
    return false;
  });

/**
 * Scroll to top of page.
 * @internal
 */
export const scrollToTop: Effect.Effect<void, ScrollError, Scroll> = Effect.gen(function* () {
  const scroll = yield* Scroll;
  yield* scroll.scrollTo(0, 0);
});

/**
 * Scroll to element matching hash (e.g., #section).
 * Returns true if element was found and scrolled to.
 * @internal
 */
export const scrollToHash = (
  hash: string,
): Effect.Effect<boolean, DomError | ScrollError, Dom | Scroll> =>
  Effect.gen(function* () {
    if (hash === "" || hash === "#") return false;
    const dom = yield* Dom;
    const scroll = yield* Scroll;
    const id = hash.startsWith("#") ? hash.slice(1) : hash;
    const element = yield* dom.getElementById(id);
    if (element !== null) {
      yield* scroll.scrollIntoView(element);
      return true;
    }
    return false;
  });

/**
 * Apply scroll behavior after navigation.
 * - If hash is present: scroll to element
 * - If strategy key is "__none__": do nothing
 * - If restoring (popstate): restore saved position
 * - Otherwise: scroll to top
 *
 * @internal
 */
export const applyScrollBehavior = (options: {
  readonly key: string;
  readonly hash: string;
  readonly isPopstate: boolean;
  readonly strategyKey: string;
}): Effect.Effect<
  void,
  StorageError | ScrollError | DomError | ParseResult.ParseError,
  SessionStorage | Scroll | Dom
> =>
  Effect.gen(function* () {
    // None strategy - don't touch scroll
    if (options.strategyKey === "__none__") {
      return;
    }

    // Hash takes priority
    if (options.hash !== "" && options.hash !== "#") {
      const scrolled = yield* scrollToHash(options.hash);
      if (scrolled) return;
    }

    // Popstate (back/forward) - try to restore
    if (options.isPopstate) {
      yield* restoreScrollPosition(options.key);
      return;
    }

    // New navigation - scroll to top
    yield* scrollToTop;
  });
