/**
 * @since 1.0.0
 * Storage Service
 *
 * Persist and retrieve string key-value pairs.
 * Two Tags: SessionStorage, LocalStorage — same interface, different browser backends.
 */
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Error type
// =============================================================================

const StorageOperation = Schema.Union([
  Schema.Literal("get"),
  Schema.Literal("set"),
  Schema.Literal("remove"),
]);

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  operation: StorageOperation,
  key: Schema.String,
  cause: Schema.Unknown,
}) {}

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

export interface SessionStorage extends Context.Service<
  SessionStorage,
  {
    readonly get: (key: string) => Effect.Effect<string | null, StorageError>;
    readonly set: (key: string, value: string) => Effect.Effect<void, StorageError>;
    readonly remove: (key: string) => Effect.Effect<void, StorageError>;
  }
> {}

export const SessionStorage = Context.Service<
  SessionStorage,
  {
    readonly get: (key: string) => Effect.Effect<string | null, StorageError>;
    readonly set: (key: string, value: string) => Effect.Effect<void, StorageError>;
    readonly remove: (key: string) => Effect.Effect<void, StorageError>;
  }
>("trygg/platform/SessionStorage");

export interface LocalStorage extends Context.Service<
  LocalStorage,
  {
    readonly get: (key: string) => Effect.Effect<string | null, StorageError>;
    readonly set: (key: string, value: string) => Effect.Effect<void, StorageError>;
    readonly remove: (key: string) => Effect.Effect<void, StorageError>;
  }
> {}

export const LocalStorage = Context.Service<
  LocalStorage,
  {
    readonly get: (key: string) => Effect.Effect<string | null, StorageError>;
    readonly set: (key: string, value: string) => Effect.Effect<void, StorageError>;
    readonly remove: (key: string) => Effect.Effect<void, StorageError>;
  }
>("trygg/platform/LocalStorage");

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
  // oxlint-disable-next-line effect/no-localstorage -- This adapter is the explicit LocalStorage capability boundary.
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

export const sessionStorageTest: Layer.Layer<SessionStorage> = Layer.sync(SessionStorage, () =>
  SessionStorage.of(makeStorageTestLayer()),
);

export const localStorageTest: Layer.Layer<LocalStorage> = Layer.sync(LocalStorage, () =>
  LocalStorage.of(makeStorageTestLayer()),
);
