/**
 * Storage Service Tests
 *
 * Tests the in-memory test layer for SessionStorage and LocalStorage.
 * Success paths, failure paths, and boundary values.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { SessionStorage, LocalStorage, sessionStorageTest, localStorageTest } from "../storage.js";

describe("SessionStorage", () => {
  it.effect("get returns null for missing key", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      const result = yield* storage.get("nonexistent");
      assert.strictEqual(result, null);
    }).pipe(Effect.provide(sessionStorageTest)),
  );

  it.effect("set then get returns value", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      yield* storage.set("key1", "value1");
      const result = yield* storage.get("key1");
      assert.strictEqual(result, "value1");
    }).pipe(Effect.provide(sessionStorageTest)),
  );

  it.effect("set overwrites existing value", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      yield* storage.set("key1", "first");
      yield* storage.set("key1", "second");
      const result = yield* storage.get("key1");
      assert.strictEqual(result, "second");
    }).pipe(Effect.provide(sessionStorageTest)),
  );

  it.effect("remove deletes key", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      yield* storage.set("key1", "value1");
      yield* storage.remove("key1");
      const result = yield* storage.get("key1");
      assert.strictEqual(result, null);
    }).pipe(Effect.provide(sessionStorageTest)),
  );

  it.effect("remove on nonexistent key is no-op", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      yield* storage.remove("nonexistent");
      const result = yield* storage.get("nonexistent");
      assert.strictEqual(result, null);
    }).pipe(Effect.provide(sessionStorageTest)),
  );

  it.effect("handles empty string key", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      yield* storage.set("", "empty-key-value");
      const result = yield* storage.get("");
      assert.strictEqual(result, "empty-key-value");
    }).pipe(Effect.provide(sessionStorageTest)),
  );

  it.effect("handles empty string value", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      yield* storage.set("key", "");
      const result = yield* storage.get("key");
      assert.strictEqual(result, "");
    }).pipe(Effect.provide(sessionStorageTest)),
  );

  it.effect("stores JSON-serialized objects", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage;
      const PointJson = Schema.parseJson(Schema.Struct({ x: Schema.Number, y: Schema.Number }));
      const data = yield* Schema.encode(PointJson)({ x: 100, y: 200 });
      yield* storage.set("scroll:page-1", data);
      const result = yield* storage.get("scroll:page-1");
      assert.strictEqual(result, data);
    }).pipe(Effect.provide(sessionStorageTest)),
  );
});

describe("LocalStorage", () => {
  it.effect("get returns null for missing key", () =>
    Effect.gen(function* () {
      const storage = yield* LocalStorage;
      const result = yield* storage.get("nonexistent");
      assert.strictEqual(result, null);
    }).pipe(Effect.provide(localStorageTest)),
  );

  it.effect("set then get returns value", () =>
    Effect.gen(function* () {
      const storage = yield* LocalStorage;
      yield* storage.set("debug", "enabled");
      const result = yield* storage.get("debug");
      assert.strictEqual(result, "enabled");
    }).pipe(Effect.provide(localStorageTest)),
  );

  it.effect("isolation between SessionStorage and LocalStorage", () =>
    Effect.gen(function* () {
      const session = yield* SessionStorage;
      const local = yield* LocalStorage;
      yield* session.set("shared-key", "session-value");
      yield* local.set("shared-key", "local-value");
      const sessionResult = yield* session.get("shared-key");
      const localResult = yield* local.get("shared-key");
      assert.strictEqual(sessionResult, "session-value");
      assert.strictEqual(localResult, "local-value");
    }).pipe(Effect.provide(Layer.merge(sessionStorageTest, localStorageTest))),
  );
});
