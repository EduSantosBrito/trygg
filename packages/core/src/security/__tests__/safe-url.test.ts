/**
 * SafeUrl Unit Tests
 *
 * Tests for URL validation before values reach URL-bearing DOM attributes.
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
          assert.strictEqual(error?.url, "javascript:alert(1)");
        }

        const emptyExit = yield* Effect.exit(SafeUrl.validate("   "));
        assert.isTrue(Exit.isFailure(emptyExit));
        if (Exit.isFailure(emptyExit)) {
          const error = Option.getOrNull(Cause.findErrorOption(emptyExit.cause));
          assert.strictEqual(error?.reason, "empty_url");
          assert.strictEqual(error?.url, "   ");
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

      const isolated = yield* Effect.exit(withDefaultConfig(SafeUrl.validate("myapp://settings")));
      assert.isTrue(Exit.isFailure(isolated));
    }),
  );
});

describe("SafeUrl.validateSync", () => {
  it("returns Some for default safe URLs", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["https://example.com", "https://example.com/"],
      ["http://localhost:3000", "http://localhost:3000/"],
      ["/path", "/path"],
    ];

    for (const [url, expected] of cases) {
      const result = SafeUrl.validateSync(url);
      assert.isTrue(Option.isSome(result), `Expected Some for ${url}`);
      if (Option.isSome(result)) {
        assert.strictEqual(result.value, expected);
      }
    }
  });

  it("preserves base-dependent references without leaking the validation sentinel", () => {
    // Test: should preserve references whose canonical URL depends on the application base.
    // Scope: covers same-scheme relative forms and Unicode-leading paths at the WHATWG boundary.
    // Assertion: validation never substitutes trygg.invalid and the browser resolves the result against the real base.
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ["https:foo", "https://app.example/dir/page", "https://app.example/dir/foo"],
      ["https:/foo", "https://app.example/dir/page", "https://app.example/foo"],
      ["https:../submit", "https://app.example/dir/page", "https://app.example/submit"],
      ["http:foo", "http://app.example/dir/page", "http://app.example/dir/foo"],
      [
        "\u00a0javascript:alert(1)",
        "https://app.example/dir/page",
        "https://app.example/dir/%C2%A0javascript:alert(1)",
      ],
      [
        "\ufeffjavascript:alert(1)",
        "https://app.example/dir/page",
        "https://app.example/dir/%EF%BB%BFjavascript:alert(1)",
      ],
    ];

    for (const [url, base, expected] of cases) {
      const result = SafeUrl.validateSync(url);
      assert.isTrue(Option.isSome(result), `Expected Some for ${JSON.stringify(url)}`);
      if (Option.isSome(result)) {
        assert.strictEqual(result.value, url);
        assert.strictEqual(new URL(result.value, base).href, expected);
        assert.notInclude(result.value, "trygg.invalid");
      }
    }
  });

  it("rejects browser-canonicalized active schemes without overblocking encoded paths", () => {
    // Test: should reject browser-canonicalized active schemes without overblocking encoded paths.
    // Scope: covers the WHATWG parsing boundary used before values reach URL-bearing DOM attributes.
    // Assertion: case, leading whitespace, and embedded controls cannot disguise javascript:, while percent encoding remains a relative HTTPS URL.
    const hostile = [
      "JAVASCRIPT:alert(1)",
      "  javascript:alert(1)",
      "\tjavascript:alert(1)",
      "java\nscript:alert(1)",
      "java\rscript:alert(1)",
      "java\tscript:alert(1)",
      "\u0000javascript:alert(1)",
    ];

    for (const url of hostile) {
      assert.isTrue(Option.isNone(SafeUrl.validateSync(url)), `Expected None for ${url}`);
    }

    const encoded = "javascript%3Aalert(1)";
    assert.strictEqual(new URL(encoded, "https://example.test/").protocol, "https:");
    assert.isTrue(Option.isSome(SafeUrl.validateSync(encoded)));
  });

  it.effect("classifies malformed absolute URLs as invalid input", () =>
    Effect.gen(function* () {
      // Test: should classify malformed absolute URLs as invalid input.
      // Scope: distinguishes parser failure from a valid but unauthorized scheme.
      // Assertion: Effect validation fails with UnsafeUrlError reason invalid_url.
      const exit = yield* Effect.exit(withDefaultConfig(SafeUrl.validate("https://[invalid-host")));
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Option.getOrNull(Cause.findErrorOption(exit.cause));
        assert.strictEqual(error?.reason, "invalid_url");
      }
    }),
  );

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

describe("SafeUrl sink policies", () => {
  it("allows blob and data only for explicitly approved passive sinks", () => {
    // Test: should allow blob and data only for explicitly approved passive sinks.
    // Scope: verifies one configured capability cannot silently widen navigation, form, or executable-resource sinks.
    // Assertion: image/media accept their passive schemes while navigation/resource reject the same values.
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const blobUrl = "blob:https://example.com/550e8400-e29b-41d4-a716-446655440000";

    assert.isTrue(
      Option.isSome(SafeUrl.validateSyncForSink(dataUrl, "image", SafeUrl.defaultConfig)),
    );
    assert.isTrue(
      Option.isSome(SafeUrl.validateSyncForSink(blobUrl, "media", SafeUrl.defaultConfig)),
    );
    assert.isTrue(
      Option.isNone(SafeUrl.validateSyncForSink(dataUrl, "navigation", SafeUrl.defaultConfig)),
    );
    assert.isTrue(
      Option.isNone(SafeUrl.validateSyncForSink(blobUrl, "resource", SafeUrl.defaultConfig)),
    );
  });

  it("keeps forms and executable resources HTTP-only while navigation supports custom schemes", () => {
    // Test: should keep forms and executable resources HTTP-only while navigation supports custom schemes.
    // Scope: covers sink-specific policy composition with application configuration.
    // Assertion: custom navigation remains opt-in but does not widen form or resource execution.
    const config = { allowedSchemes: [...SafeUrl.DEFAULT_ALLOWED_SCHEMES, "myapp"] };

    assert.isTrue(
      Option.isSome(SafeUrl.validateSyncForSink("myapp://settings", "navigation", config)),
    );
    assert.isTrue(Option.isNone(SafeUrl.validateSyncForSink("myapp://submit", "form", config)));
    assert.isTrue(
      Option.isNone(SafeUrl.validateSyncForSink("mailto:code@example.com", "resource", config)),
    );
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
