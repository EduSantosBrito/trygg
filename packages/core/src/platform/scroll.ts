/**
 * @since 1.0.0
 * Scroll Service
 *
 * Control and read viewport scroll position.
 */
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Error type
// =============================================================================

export class ScrollError extends Schema.TaggedError<ScrollError>()("ScrollError", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

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

export interface Scroll extends Context.Service<
  Scroll,
  {
    readonly scrollTo: (x: number, y: number) => Effect.Effect<void, ScrollError>;
    readonly scrollIntoView: (element: Element) => Effect.Effect<void, ScrollError>;
    readonly getPosition: Effect.Effect<{ readonly x: number; readonly y: number }, ScrollError>;
  }
> {}

export const Scroll = Context.Service<
  Scroll,
  {
    readonly scrollTo: (x: number, y: number) => Effect.Effect<void, ScrollError>;
    readonly scrollIntoView: (element: Element) => Effect.Effect<void, ScrollError>;
    readonly getPosition: Effect.Effect<{ readonly x: number; readonly y: number }, ScrollError>;
  }
>("trygg/platform/Scroll");

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

export const test: Layer.Layer<Scroll> = Layer.sync(Scroll, () => {
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
});
