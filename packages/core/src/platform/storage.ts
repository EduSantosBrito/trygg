/**
 * @since 1.0.0
 * Storage Service
 *
 * Persist and retrieve string key-value pairs.
 * Two Tags: SessionStorage, LocalStorage — same interface, different browser backends.
 */
import { Context, Data, Effect, Layer } from "effect";

// =============================================================================
// Error type
// =============================================================================

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: "get" | "set" | "remove";
  readonly key: string;
  readonly cause: unknown;
}> {}

// =============================================================================
// Service interface
// =============================================================================

export interface StorageService {
  readonly get: (key: string) => Effect.Effect<string | null, StorageError>;
  readonly set: (key: string, value: string) => Effect.Effect<void, StorageError>;
  readonly remove: (key: string) => Effect.Effect<void, StorageError>;
}

// =============================================================================
// Tags
// =============================================================================

export class SessionStorage extends Context.Tag("effect-ui/platform/SessionStorage")<
  SessionStorage,
  StorageService
>() {}

export class LocalStorage extends Context.Tag("effect-ui/platform/LocalStorage")<
  LocalStorage,
  StorageService
>() {}

// =============================================================================
// Browser layers
// =============================================================================

const makeStorageBrowserLayer = (storage: () => Storage): StorageService => ({
  get: (key) =>
    Effect.try({
      try: () => storage().getItem(key),
      catch: (cause) => new StorageError({ operation: "get", key, cause }),
    }),

  set: (key, value) =>
    Effect.try({
      try: () => {
        storage().setItem(key, value);
      },
      catch: (cause) => new StorageError({ operation: "set", key, cause }),
    }),

  remove: (key) =>
    Effect.try({
      try: () => {
        storage().removeItem(key);
      },
      catch: (cause) => new StorageError({ operation: "remove", key, cause }),
    }),
});

export const sessionStorageBrowser: Layer.Layer<SessionStorage> = Layer.succeed(
  SessionStorage,
  SessionStorage.of(makeStorageBrowserLayer(() => sessionStorage)),
);

export const localStorageBrowser: Layer.Layer<LocalStorage> = Layer.succeed(
  LocalStorage,
  LocalStorage.of(makeStorageBrowserLayer(() => localStorage)),
);

// =============================================================================
// Test layers
// =============================================================================

const makeStorageTestLayer = (): StorageService => {
  const store = new Map<string, string>();

  return {
    get: (key) => Effect.succeed(store.get(key) ?? null),
    set: (key, value) =>
      Effect.sync(() => {
        store.set(key, value);
      }),
    remove: (key) =>
      Effect.sync(() => {
        store.delete(key);
      }),
  };
};

export const sessionStorageTest: Layer.Layer<SessionStorage> = Layer.effect(
  SessionStorage,
  Effect.sync(() => SessionStorage.of(makeStorageTestLayer())),
);

export const localStorageTest: Layer.Layer<LocalStorage> = Layer.effect(
  LocalStorage,
  Effect.sync(() => LocalStorage.of(makeStorageTestLayer())),
);
