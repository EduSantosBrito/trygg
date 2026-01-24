/**
 * @since 1.0.0
 * Scroll Service
 *
 * Control and read viewport scroll position.
 */
import { Context, Data, Effect, Layer } from "effect";

// =============================================================================
// Error type
// =============================================================================

export class ScrollError extends Data.TaggedError("ScrollError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// =============================================================================
// Service interface
// =============================================================================

export interface ScrollService {
  readonly scrollTo: (x: number, y: number) => Effect.Effect<void, ScrollError>;
  readonly scrollIntoView: (element: Element) => Effect.Effect<void, ScrollError>;
  readonly getPosition: Effect.Effect<{ readonly x: number; readonly y: number }, ScrollError>;
}

// =============================================================================
// Tag
// =============================================================================

export class Scroll extends Context.Tag("trygg/platform/Scroll")<Scroll, ScrollService>() {}

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<Scroll> = Layer.succeed(
  Scroll,
  Scroll.of({
    scrollTo: (x, y) =>
      Effect.try({
        try: () => {
          window.scrollTo(x, y);
        },
        catch: (cause) => new ScrollError({ operation: "scrollTo", cause }),
      }),

    scrollIntoView: (element) =>
      Effect.try({
        try: () => {
          element.scrollIntoView();
        },
        catch: (cause) => new ScrollError({ operation: "scrollIntoView", cause }),
      }),

    getPosition: Effect.try({
      try: () => ({ x: window.scrollX, y: window.scrollY }),
      catch: (cause) => new ScrollError({ operation: "getPosition", cause }),
    }),
  }),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<Scroll> = Layer.effect(
  Scroll,
  Effect.sync(() => {
    const position = { x: 0, y: 0 };

    return Scroll.of({
      scrollTo: (x, y) =>
        Effect.sync(() => {
          position.x = x;
          position.y = y;
        }),
      scrollIntoView: (_element) => Effect.void,
      getPosition: Effect.sync(() => ({ x: position.x, y: position.y })),
    });
  }),
);
