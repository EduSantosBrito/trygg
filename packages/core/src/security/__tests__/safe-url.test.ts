/**
 * SafeUrl Unit Tests
 *
 * Tests for URL validation to prevent XSS via href/src attributes.
 */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import * as SafeUrl from "../safe-url.js";

const withDefaultConfig = <A, E>(
  effect: Effect.Effect<A, E, SafeUrl.SafeUrlConfig>,
): Effect.Effect<A, E> => effect.pipe(Effect.provide(SafeUrl.SafeUrlConfig.layer));

const customConfig = (allowedSchemes: ReadonlyArray<string>): Layer.Layer<SafeUrl.SafeUrlConfig> =>
  Layer.succeed(SafeUrl.SafeUrlConfig, { allowedSchemes });

describe("SafeUrl.validate", () => {
  it.effect("allows default safe schemes and relative URLs", () =>
    withDefaultConfig(
      Effect.gen(function* () {
        const urls = [
          "https://example.com/path",
          "http://example.com/path",
          "mailto:test@example.com",
          "tel:+1234567890",
          "sms:+1234567890",
          "blob:https://example.com/550e8400-e29b-41d4-a716-446655440000",
          "data:image/png;base64,iVBORw0KGgo=",
          "/path/to/page",
          "./relative",
          "../parent",
          "page.html",
          "#anchor",
          "//example.com/path",
        ];

        for (const url of urls) {
          const result = yield* SafeUrl.validate(url);
          assert.strictEqual(result, url);
        }
      }),
    ),
  );

  it.effect("blocks unsafe and empty URLs with UnsafeUrlError", () =>
    withDefaultConfig(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(SafeUrl.validate("javascript:alert(1)"));

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
          assert.strictEqual(error?._tag, "UnsafeUrlError");
          assert.strictEqual(error?.reason, "unsafe_scheme");
          assert.strictEqual(error?.scheme, "javascript");
          assert.include(error?.message, "Unsafe URL scheme");
        }

        const emptyExit = yield* Effect.exit(SafeUrl.validate("   "));
        assert.isTrue(Exit.isFailure(emptyExit));
        if (Exit.isFailure(emptyExit)) {
          const error = Option.getOrNull(Cause.findErrorOption(emptyExit.cause));
          assert.strictEqual(error?.reason, "empty_url");
          assert.include(error?.message, "Empty URL");
        }
      }),
    ),
  );

  it.effect("uses fiber-scoped custom allowlist layers", () =>
    Effect.gen(function* () {
      const allowed = yield* SafeUrl.validate("myapp://settings").pipe(
        Effect.provide(customConfig(["myapp"])),
      );

      assert.strictEqual(allowed, "myapp://settings");

      const isolated = yield* Effect.exit(
        withDefaultConfig(SafeUrl.validate("myapp://settings")),
      );
      assert.isTrue(Exit.isFailure(isolated));
    }),
  );
});

describe("SafeUrl.validateSync", () => {
  it("returns Some for default safe URLs", () => {
    for (const url of ["https://example.com", "http://localhost:3000", "/path"]) {
      const result = SafeUrl.validateSync(url);
      assert.isTrue(Option.isSome(result), `Expected Some for ${url}`);
      if (Option.isSome(result)) {
        assert.strictEqual(result.value, url);
      }
    }
  });

  it("returns None for unsafe or empty URLs", () => {
    for (const url of ["javascript:alert(1)", "vbscript:msgbox", "", "   "]) {
      const result = SafeUrl.validateSync(url);
      assert.isTrue(Option.isNone(result), `Expected None for ${url}`);
    }
  });

  it("accepts explicit config without global mutation", () => {
    const result = SafeUrl.validateSyncWithConfig("custom://test", {
      allowedSchemes: ["custom"],
    });
    const defaultResult = SafeUrl.validateSync("custom://test");

    assert.isTrue(Option.isSome(result));
    assert.isTrue(Option.isNone(defaultResult));
  });
});

describe("SafeUrl helpers", () => {
  it.effect("validateOption and isSafe use Context config", () =>
    Effect.gen(function* () {
      const option = yield* SafeUrl.validateOption("custom://test").pipe(
        Effect.provide(customConfig(["custom"])),
      );
      const safe = yield* SafeUrl.isSafe("custom://test").pipe(
        Effect.provide(customConfig(["custom"])),
      );
      const unsafe = yield* withDefaultConfig(SafeUrl.isSafe("custom://test"));

      assert.isTrue(Option.isSome(option));
      assert.isTrue(safe);
      assert.isFalse(unsafe);
    }),
  );
});
