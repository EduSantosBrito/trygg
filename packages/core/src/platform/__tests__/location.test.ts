/**
 * Location Service Tests
 *
 * Tests the in-memory test layer for Location.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Location, test as locationTest } from "../location.js";

describe("Location", () => {
  it.effect("defaults to / pathname", () =>
    Effect.gen(function* () {
      const loc = yield* Location;
      const path = yield* loc.pathname;
      assert.strictEqual(path, "/");
    }).pipe(Effect.provide(locationTest())),
  );

  it.effect("parses pathname from initial path", () =>
    Effect.gen(function* () {
      const loc = yield* Location;
      const path = yield* loc.pathname;
      assert.strictEqual(path, "/users/123");
    }).pipe(Effect.provide(locationTest("/users/123"))),
  );

  it.effect("parses search from initial path", () =>
    Effect.gen(function* () {
      const loc = yield* Location;
      const search = yield* loc.search;
      assert.strictEqual(search, "?tab=settings");
    }).pipe(Effect.provide(locationTest("/page?tab=settings"))),
  );

  it.effect("parses hash from initial path", () =>
    Effect.gen(function* () {
      const loc = yield* Location;
      const hash = yield* loc.hash;
      assert.strictEqual(hash, "#section");
    }).pipe(Effect.provide(locationTest("/page#section"))),
  );

  it.effect("parses full path with search and hash", () =>
    Effect.gen(function* () {
      const loc = yield* Location;
      const pathname = yield* loc.pathname;
      const search = yield* loc.search;
      const hash = yield* loc.hash;
      assert.strictEqual(pathname, "/page");
      assert.strictEqual(search, "?q=hello");
      assert.strictEqual(hash, "#top");
    }).pipe(Effect.provide(locationTest("/page?q=hello#top"))),
  );

  it.effect("fullPath returns concatenated path", () =>
    Effect.gen(function* () {
      const loc = yield* Location;
      const full = yield* loc.fullPath;
      assert.strictEqual(full, "/page?q=hello#top");
    }).pipe(Effect.provide(locationTest("/page?q=hello#top"))),
  );

  it.effect("href includes localhost origin", () =>
    Effect.gen(function* () {
      const loc = yield* Location;
      const href = yield* loc.href;
      assert.strictEqual(href, "http://localhost/page");
    }).pipe(Effect.provide(locationTest("/page"))),
  );

  it.effect("handles root path", () =>
    Effect.gen(function* () {
      const loc = yield* Location;
      const full = yield* loc.fullPath;
      assert.strictEqual(full, "/");
    }).pipe(Effect.provide(locationTest("/"))),
  );

  it.effect("handles empty search and hash", () =>
    Effect.gen(function* () {
      const loc = yield* Location;
      const search = yield* loc.search;
      const hash = yield* loc.hash;
      assert.strictEqual(search, "");
      assert.strictEqual(hash, "");
    }).pipe(Effect.provide(locationTest("/plain"))),
  );
});
