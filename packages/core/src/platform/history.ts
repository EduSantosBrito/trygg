/**
 * @since 1.0.0
 * History Service
 *
 * Manage the browser navigation stack.
 */
import { Context, Data, Effect, Layer } from "effect";

// =============================================================================
// Error type
// =============================================================================

export class HistoryError extends Data.TaggedError("HistoryError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// =============================================================================
// Service interface
// =============================================================================

export interface HistoryService {
  readonly pushState: (state: unknown, url: string) => Effect.Effect<void, HistoryError>;
  readonly replaceState: (state: unknown, url: string) => Effect.Effect<void, HistoryError>;
  readonly back: Effect.Effect<void, HistoryError>;
  readonly forward: Effect.Effect<void, HistoryError>;
  readonly state: Effect.Effect<unknown, HistoryError>;
  /** Set `history.scrollRestoration` to `"manual"` or `"auto"`. */
  readonly setScrollRestoration: (mode: ScrollRestoration) => Effect.Effect<void, HistoryError>;
}

// =============================================================================
// Tag
// =============================================================================

export class History extends Context.Tag("trygg/platform/History")<History, HistoryService>() {}

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<History> = Layer.succeed(
  History,
  History.of({
    pushState: (state, url) =>
      Effect.try({
        try: () => {
          window.history.pushState(state, "", url);
        },
        catch: (cause) => new HistoryError({ operation: "pushState", cause }),
      }),

    replaceState: (state, url) =>
      Effect.try({
        try: () => {
          window.history.replaceState(state, "", url);
        },
        catch: (cause) => new HistoryError({ operation: "replaceState", cause }),
      }),

    back: Effect.try({
      try: () => {
        window.history.back();
      },
      catch: (cause) => new HistoryError({ operation: "back", cause }),
    }),

    forward: Effect.try({
      try: () => {
        window.history.forward();
      },
      catch: (cause) => new HistoryError({ operation: "forward", cause }),
    }),

    state: Effect.try({
      try: () => window.history.state as unknown,
      catch: (cause) => new HistoryError({ operation: "state", cause }),
    }),

    setScrollRestoration: (mode) =>
      Effect.try({
        try: () => {
          window.history.scrollRestoration = mode;
        },
        catch: (cause) => new HistoryError({ operation: "setScrollRestoration", cause }),
      }),
  }),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<History> = Layer.effect(
  History,
  Effect.sync(() => {
    const entries: Array<{ state: unknown; url: string }> = [{ state: null, url: "/" }];
    let index = 0;

    return History.of({
      pushState: (state, url) =>
        Effect.sync(() => {
          // Truncate forward entries when pushing new state
          entries.length = index + 1;
          entries.push({ state, url });
          index = entries.length - 1;
        }),

      replaceState: (state, url) =>
        Effect.sync(() => {
          entries[index] = { state, url };
        }),

      back: Effect.sync(() => {
        if (index > 0) {
          index--;
        }
      }),

      forward: Effect.sync(() => {
        if (index < entries.length - 1) {
          index++;
        }
      }),

      state: Effect.sync(() => entries[index]?.state ?? null),

      setScrollRestoration: () => Effect.void,
    });
  }),
);
