/**
 * SafeUrl Unit Tests
 *
 * Tests for URL validation to prevent XSS via href/src attributes.
 *
 * Goals: Security, reliability
 * - Verify dangerous schemes are blocked
 * - Verify safe schemes are allowed
 * - Verify relative URLs work
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";
import * as SafeUrl from "../safe-url.js";

// Reset config before each test to ensure isolation
const withResetConfig = <A, E>(effect: Effect.Effect<A, E, never>): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    SafeUrl.resetConfig();
    const result = yield* effect;
    SafeUrl.resetConfig();
    return result;
  });

// =============================================================================
// SafeUrl.validate - Effect-based validation
// =============================================================================
// Scope: Validating URLs with Effect error handling

describe("SafeUrl.validate", () => {
  it.effect("should allow https URLs", () =>
    withResetConfig(
      Effect.gen(function* () {
        const url = "https://example.com/path";
        const result = yield* SafeUrl.validate(url);

        assert.strictEqual(result, url);
      }),
    ),
  );

  it.effect("should allow http URLs", () =>
    withResetConfig(
      Effect.gen(function* () {
        const url = "http://example.com/path";
        const result = yield* SafeUrl.validate(url);

        assert.strictEqual(result, url);
      }),
    ),
  );

  it.effect("should allow mailto URLs", () =>
    withResetConfig(
      Effect.gen(function* () {
        const url = "mailto:test@example.com";
        const result = yield* SafeUrl.validate(url);

        assert.strictEqual(result, url);
      }),
    ),
  );

  it.effect("should allow tel URLs", () =>
    withResetConfig(
      Effect.gen(function* () {
        const url = "tel:+1234567890";
        const result = yield* SafeUrl.validate(url);

        assert.strictEqual(result, url);
      }),
    ),
  );

  it.effect("should allow relative URLs without scheme", () =>
    withResetConfig(
      Effect.gen(function* () {
        const paths = ["/path/to/page", "./relative", "../parent", "page.html", "#anchor"];

        for (const path of paths) {
          const result = yield* SafeUrl.validate(path);
          assert.strictEqual(result, path);
        }
      }),
    ),
  );

  it.effect("should block javascript: URLs", () =>
    withResetConfig(
      Effect.gen(function* () {
        const url = "javascript:alert(1)";
        const exit = yield* Effect.exit(SafeUrl.validate(url));

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = exit.cause._tag === "Fail" ? exit.cause.error : null;
          assert.isNotNull(error);
          assert.strictEqual(error?._tag, "UnsafeUrlError");
          assert.strictEqual(error?.reason, "unsafe_scheme");
          assert.strictEqual(error?.scheme, "javascript");
        }
      }),
    ),
  );

  it.effect("should block vbscript: URLs", () =>
    withResetConfig(
      Effect.gen(function* () {
        const url = "vbscript:msgbox";
        const exit = yield* Effect.exit(SafeUrl.validate(url));

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = exit.cause._tag === "Fail" ? exit.cause.error : null;
          assert.strictEqual(error?.reason, "unsafe_scheme");
        }
      }),
    ),
  );

  it.effect("should block empty URLs", () =>
    withResetConfig(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(SafeUrl.validate(""));

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = exit.cause._tag === "Fail" ? exit.cause.error : null;
          assert.strictEqual(error?.reason, "empty_url");
        }
      }),
    ),
  );

  it.effect("should block whitespace-only URLs", () =>
    withResetConfig(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(SafeUrl.validate("   "));

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = exit.cause._tag === "Fail" ? exit.cause.error : null;
          assert.strictEqual(error?.reason, "empty_url");
        }
      }),
    ),
  );

  it.effect("should block schemes case-insensitively", () =>
    withResetConfig(
      Effect.gen(function* () {
        const urls = ["JAVASCRIPT:alert(1)", "JavaScript:alert(1)", "JaVaScRiPt:alert(1)"];

        for (const url of urls) {
          const exit = yield* Effect.exit(SafeUrl.validate(url));
          assert.isTrue(Exit.isFailure(exit), `Expected ${url} to be blocked`);
        }
      }),
    ),
  );
});

// =============================================================================
// SafeUrl.validateSync - Synchronous validation
// =============================================================================
// Scope: Sync validation returning Option

describe("SafeUrl.validateSync", () => {
  it("should return Some for valid URLs", () => {
    SafeUrl.resetConfig();
    const urls = [
      "https://example.com",
      "http://localhost:3000",
      "/path",
      "mailto:test@example.com",
    ];

    for (const url of urls) {
      const result = SafeUrl.validateSync(url);
      assert.isTrue(Option.isSome(result), `Expected Some for ${url}`);
      if (Option.isSome(result)) {
        assert.strictEqual(result.value, url);
      }
    }
    SafeUrl.resetConfig();
  });

  it("should return None for invalid URLs", () => {
    SafeUrl.resetConfig();
    const urls = ["javascript:alert(1)", "vbscript:msgbox", "", "   "];

    for (const url of urls) {
      const result = SafeUrl.validateSync(url);
      assert.isTrue(Option.isNone(result), `Expected None for "${url}"`);
    }
    SafeUrl.resetConfig();
  });
});

// =============================================================================
// SafeUrl.validate failure path - Effect-based error handling
// =============================================================================
// Scope: Validation that fails with UnsafeUrlError

describe("SafeUrl.validate (failure path)", () => {
  it.effect("should succeed with URL for valid input", () =>
    Effect.gen(function* () {
      SafeUrl.resetConfig();
      const url = "https://example.com";
      const result = yield* SafeUrl.validate(url);

      assert.strictEqual(result, url);
      SafeUrl.resetConfig();
    }),
  );

  it.effect("should fail with UnsafeUrlError for invalid input", () =>
    Effect.gen(function* () {
      SafeUrl.resetConfig();
      const exit = yield* Effect.exit(SafeUrl.validate("javascript:alert(1)"));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = exit.cause._tag === "Fail" ? exit.cause.error : null;
        assert.isNotNull(error);
        assert.strictEqual(error?._tag, "UnsafeUrlError");
        assert.strictEqual(error?.reason, "unsafe_scheme");
      }
      SafeUrl.resetConfig();
    }),
  );
});

// =============================================================================
// SafeUrl.isSafe - Boolean check
// =============================================================================
// Scope: Simple boolean validation

describe("SafeUrl.isSafe", () => {
  it.effect("should return true for safe URLs", () =>
    Effect.gen(function* () {
      SafeUrl.resetConfig();
      const urls = ["https://example.com", "/path", "mailto:test@example.com"];

      for (const url of urls) {
        const result = yield* SafeUrl.isSafe(url);
        assert.isTrue(result, `Expected ${url} to be safe`);
      }
      SafeUrl.resetConfig();
    }),
  );

  it.effect("should return false for unsafe URLs", () =>
    Effect.gen(function* () {
      SafeUrl.resetConfig();
      const urls = ["javascript:alert(1)", "vbscript:msgbox", "", "   "];

      for (const url of urls) {
        const result = yield* SafeUrl.isSafe(url);
        assert.isFalse(result, `Expected "${url}" to be unsafe`);
      }
      SafeUrl.resetConfig();
    }),
  );
});

// =============================================================================
// SafeUrl.allowSchemes - Custom schemes
// =============================================================================
// Scope: Adding custom allowed schemes

describe("SafeUrl.allowSchemes", () => {
  it("should allow added custom schemes", () => {
    SafeUrl.resetConfig();
    SafeUrl.allowSchemes(["myapp"]);

    const result = SafeUrl.validateSync("myapp://settings");

    assert.isTrue(Option.isSome(result));
    SafeUrl.resetConfig();
  });

  it("should normalize scheme format", () => {
    SafeUrl.resetConfig();
    // Trailing colon should be removed
    SafeUrl.allowSchemes(["custom:"]);

    const config = SafeUrl.getConfig();
    assert.isTrue(config.allowedSchemes.includes("custom"));
    assert.isFalse(config.allowedSchemes.includes("custom:"));

    const result = SafeUrl.validateSync("custom://test");
    assert.isTrue(Option.isSome(result));
    SafeUrl.resetConfig();
  });

  it("should preserve existing allowed schemes", () => {
    SafeUrl.resetConfig();
    const originalSchemes = [...SafeUrl.getConfig().allowedSchemes];

    SafeUrl.allowSchemes(["newscheme"]);

    const newConfig = SafeUrl.getConfig();
    for (const scheme of originalSchemes) {
      assert.isTrue(newConfig.allowedSchemes.includes(scheme), `Should preserve ${scheme}`);
    }
    assert.isTrue(newConfig.allowedSchemes.includes("newscheme"));
    SafeUrl.resetConfig();
  });

  it("should deduplicate schemes", () => {
    SafeUrl.resetConfig();
    SafeUrl.allowSchemes(["https", "https", "https"]);

    const config = SafeUrl.getConfig();
    const httpsCount = config.allowedSchemes.filter((s) => s === "https").length;

    assert.strictEqual(httpsCount, 1);
    SafeUrl.resetConfig();
  });
});

// =============================================================================
// SafeUrl.resetConfig - Reset to defaults
// =============================================================================
// Scope: Resetting configuration

describe("SafeUrl.resetConfig", () => {
  it("should reset to default allowed schemes", () => {
    SafeUrl.allowSchemes(["custom1", "custom2"]);

    SafeUrl.resetConfig();

    const config = SafeUrl.getConfig();
    assert.deepStrictEqual(config.allowedSchemes, SafeUrl.DEFAULT_ALLOWED_SCHEMES);
  });
});

// =============================================================================
// SafeUrl.getConfig - Get current config
// =============================================================================
// Scope: Reading current configuration

describe("SafeUrl.getConfig", () => {
  it("should return current configuration", () => {
    SafeUrl.resetConfig();
    const config = SafeUrl.getConfig();

    assert.isDefined(config.allowedSchemes);
    assert.isArray(config.allowedSchemes);
    assert.isTrue(config.allowedSchemes.length > 0);
    SafeUrl.resetConfig();
  });
});

// =============================================================================
// UnsafeUrlError - Error details
// =============================================================================
// Scope: Error message formatting

describe("UnsafeUrlError", () => {
  it.effect("should format unsafe_scheme error message", () =>
    Effect.gen(function* () {
      SafeUrl.resetConfig();
      const exit = yield* Effect.exit(SafeUrl.validate("javascript:alert(1)"));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        const error = exit.cause.error;
        assert.include(error.message, "javascript");
        assert.include(error.message, "Unsafe URL scheme");
      }
      SafeUrl.resetConfig();
    }),
  );

  it.effect("should format empty_url error message", () =>
    Effect.gen(function* () {
      SafeUrl.resetConfig();
      const exit = yield* Effect.exit(SafeUrl.validate(""));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        const error = exit.cause.error;
        assert.include(error.message, "Empty URL");
      }
      SafeUrl.resetConfig();
    }),
  );

  it.effect("should include URL in error", () =>
    Effect.gen(function* () {
      SafeUrl.resetConfig();
      const exit = yield* Effect.exit(SafeUrl.validate("javascript:alert(1)"));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        const error = exit.cause.error;
        assert.strictEqual(error.url, "javascript:alert(1)");
      }
      SafeUrl.resetConfig();
    }),
  );

  it.effect("should include allowed schemes in error", () =>
    Effect.gen(function* () {
      SafeUrl.resetConfig();
      const exit = yield* Effect.exit(SafeUrl.validate("javascript:alert(1)"));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        const error = exit.cause.error;
        assert.isDefined(error.allowedSchemes);
        assert.isTrue(error.allowedSchemes.includes("https"));
      }
      SafeUrl.resetConfig();
    }),
  );
});

// =============================================================================
// Edge cases
// =============================================================================
// Scope: Edge case handling

describe("SafeUrl edge cases", () => {
  it("should allow data: URLs by default", () => {
    SafeUrl.resetConfig();
    const url = "data:image/png;base64,iVBORw0KGgo=";
    const result = SafeUrl.validateSync(url);

    assert.isTrue(Option.isSome(result));
    SafeUrl.resetConfig();
  });

  it("should allow blob: URLs by default", () => {
    SafeUrl.resetConfig();
    const url = "blob:https://example.com/550e8400-e29b-41d4-a716-446655440000";
    const result = SafeUrl.validateSync(url);

    assert.isTrue(Option.isSome(result));
    SafeUrl.resetConfig();
  });

  it("should handle protocol-relative URLs", () => {
    SafeUrl.resetConfig();
    // Protocol-relative URLs start with // and are treated as relative
    const url = "//example.com/path";
    const result = SafeUrl.validateSync(url);

    assert.isTrue(Option.isSome(result));
    SafeUrl.resetConfig();
  });

  it("should handle URLs with ports", () => {
    SafeUrl.resetConfig();
    const url = "http://localhost:3000/path";
    const result = SafeUrl.validateSync(url);

    assert.isTrue(Option.isSome(result));
    if (Option.isSome(result)) {
      assert.strictEqual(result.value, url);
    }
    SafeUrl.resetConfig();
  });

  it("should handle URLs with authentication", () => {
    SafeUrl.resetConfig();
    const url = "https://user:pass@example.com/path";
    const result = SafeUrl.validateSync(url);

    assert.isTrue(Option.isSome(result));
    SafeUrl.resetConfig();
  });

  it("should handle URLs with hash fragments", () => {
    SafeUrl.resetConfig();
    const url = "/page#section";
    const result = SafeUrl.validateSync(url);

    assert.isTrue(Option.isSome(result));
    if (Option.isSome(result)) {
      assert.strictEqual(result.value, url);
    }
    SafeUrl.resetConfig();
  });

  it("should handle URLs with query strings", () => {
    SafeUrl.resetConfig();
    const url = "/page?foo=bar&baz=qux";
    const result = SafeUrl.validateSync(url);

    assert.isTrue(Option.isSome(result));
    if (Option.isSome(result)) {
      assert.strictEqual(result.value, url);
    }
    SafeUrl.resetConfig();
  });
});
