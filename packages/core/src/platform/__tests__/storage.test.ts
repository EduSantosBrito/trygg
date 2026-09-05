/**
 * Storage Service Tests
 *
 * Tests the in-memory test layer for SessionStorage and LocalStorage.
 * Success paths, failure paths, and boundary values.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema, Scope } from "effect";
import {
  SessionStorage,
  LocalStorage,
  sessionStorageBrowser,
  localStorageBrowser,
  sessionStorageTest,
  localStorageTest,
} from "../storage.js";

const PointJson = Schema.fromJsonString(Schema.Struct({ x: Schema.Number, y: Schema.Number }));
const encodePointJson = Schema.encodeEffect(PointJson);

const makeNativeStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

const installNativeStorageBackends: Effect.Effect<
  { readonly session: Storage; readonly local: Storage },
  never,
  Scope.Scope
> = Effect.acquireRelease(
  Effect.sync(() => {
    const sessionDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const localDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const session = makeNativeStorage();
    const local = makeNativeStorage();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: session,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: local,
    });
    return { session, local, sessionDescriptor, localDescriptor };
  }),
  ({ sessionDescriptor, localDescriptor }) =>
    Effect.sync(() => {
      if (sessionDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "sessionStorage");
      } else {
        Object.defineProperty(globalThis, "sessionStorage", sessionDescriptor);
      }
      if (localDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "localStorage");
      } else {
        Object.defineProperty(globalThis, "localStorage", localDescriptor);
      }
    }),
).pipe(Effect.map(({ session, local }) => ({ session, local })));

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
      const data = yield* encodePointJson({ x: 100, y: 200 });
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

const storageAdapters: ReadonlyArray<
  readonly [string, Layer.Layer<SessionStorage | LocalStorage>]
> = [
  ["browser", Layer.merge(sessionStorageBrowser, localStorageBrowser)],
  ["test", Layer.merge(sessionStorageTest, localStorageTest)],
];

for (const [name, layer] of storageAdapters) {
  describe(`Storage ${name} adapter conformance`, () => {
    it.effect("should preserve set get remove and backend isolation", () =>
      Effect.gen(function* () {
        // Test: should preserve set get remove and backend isolation through every Storage adapter.
        // Scope: executes one public contract table against both controlled live globals and in-memory layers.
        // Assertion: equal keys remain independent and successful mutations are observable in the selected backend only.
        const native = yield* installNativeStorageBackends;
        const session = yield* SessionStorage;
        const local = yield* LocalStorage;

        yield* session.set("shared", "session");
        yield* local.set("shared", "local");
        assert.strictEqual(yield* session.get("shared"), "session");
        assert.strictEqual(yield* local.get("shared"), "local");

        yield* session.remove("shared");
        assert.isNull(yield* session.get("shared"));
        assert.strictEqual(yield* local.get("shared"), "local");

        if (name === "browser") {
          assert.isNull(native.session.getItem("shared"));
          assert.strictEqual(native.local.getItem("shared"), "local");
        }
      }).pipe(Effect.provide(layer)),
    );
  });
}
