/**
 * SafeUrl validation for secure href/src attributes.
 *
 * @remarks
 * Owner module for the `SafeUrl` topic. Use this module when URLs can cross an
 * untrusted boundary before they reach DOM attributes like `href` or `src`.
 * The root `trygg` entrypoint publishes this topic as `SafeUrl.*` and
 * `UnsafeUrlError`.
 *
 * @see ./safe-url.docs.md - Source-owned topic guide
 * @see https://url.spec.whatwg.org/ - WHATWG URL Standard
 * @see https://www.iana.org/assignments/uri-schemes/ - IANA URI Schemes
 * @since 1.0.0
 * @module trygg/security/safe-url
 */
import { Data, Effect, Option } from "effect";

/**
 * Error produced when a URL fails validation.
 *
 * @remarks
 * `SafeUrl.validate` and related helpers fail with this error when input is
 * empty or uses a blocked scheme.
 *
 * @example
 * ```ts
 * const exit = yield* Effect.exit(SafeUrl.validate("javascript:alert(1)"))
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export class UnsafeUrlError extends Data.TaggedError("UnsafeUrlError")<{
  readonly url: string;
  readonly reason: "invalid_url" | "unsafe_scheme" | "empty_url";
  readonly scheme?: string;
  readonly allowedSchemes: ReadonlyArray<string>;
}> {
  override get message(): string {
    switch (this.reason) {
      case "invalid_url":
        return `Invalid URL: "${this.url}". URL must be a valid absolute or relative URL.`;
      case "unsafe_scheme":
        return (
          `Unsafe URL scheme "${this.scheme}" in "${this.url}". ` +
          `Allowed schemes: ${this.allowedSchemes.join(", ")}. ` +
          `Use SafeUrl.allowSchemes([...]) to add custom schemes.`
        );
      case "empty_url":
        return `Empty URL is not allowed.`;
    }
  }
}

/**
 * Default allowed URL schemes based on web standards.
 *
 * - http/https: Standard web protocols
 * - mailto: Email links
 * - tel: Phone links
 * - sms: SMS links
 * - blob: Blob URLs (for local file references)
 * - data: Data URLs (for embedded content)
 *
 * @remarks
 * This list seeds the global SafeUrl configuration. Custom schemes extend this
 * baseline instead of replacing it.
 *
 * @example
 * ```ts
 * const defaults = SafeUrl.DEFAULT_ALLOWED_SCHEMES
 * ```
 *
 * @category Security
 * @public
 *
 * @since 1.0.0
 */
export const DEFAULT_ALLOWED_SCHEMES: ReadonlyArray<string> = [
  "http",
  "https",
  "mailto",
  "tel",
  "sms",
  "blob",
  "data",
] as const;

/**
 * Configuration for SafeUrl validation.
 *
 * @remarks
 * `SafeUrlConfig` captures the allowlist used by `validate`, `validateSync`,
 * and the renderer's attribute sanitization path.
 *
 * @example
 * ```ts
 * const config: SafeUrl.SafeUrlConfig = {
 *   allowedSchemes: ["https", "mailto"],
 * }
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export interface SafeUrlConfig {
  readonly allowedSchemes: ReadonlyArray<string>;
}

/**
 * Current SafeUrl configuration
 * Module-level state to allow global configuration
 */
let _config: SafeUrlConfig = {
  allowedSchemes: DEFAULT_ALLOWED_SCHEMES,
};

// =============================================================================
// Config (sync — trivial state read/write, no failure modes)
// =============================================================================

/**
 * Get the current SafeUrl configuration.
 *
 * @remarks
 * Use this to inspect the active allowlist before validating or extending it.
 *
 * @example
 * ```ts
 * const config = SafeUrl.getConfig()
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const getConfig = (): SafeUrlConfig => _config;

/**
 * Add custom schemes to the allowlist.
 *
 * @remarks
 * Added schemes are normalized to lowercase, deduplicated, and appended to the
 * default allowlist.
 *
 * @example
 * ```ts
 * SafeUrl.allowSchemes(["myapp", "web+myapp"])
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const allowSchemes = (schemes: ReadonlyArray<string>): void => {
  const normalized = schemes.map((s) => s.toLowerCase().replace(/:$/, ""));
  _config = {
    allowedSchemes: [...new Set([..._config.allowedSchemes, ...normalized])],
  };
};

/**
 * Reset configuration to defaults.
 *
 * @remarks
 * Useful for test isolation and for restoring the default allowlist after local
 * customization.
 *
 * @example
 * ```ts
 * SafeUrl.resetConfig()
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const resetConfig = (): void => {
  _config = { allowedSchemes: DEFAULT_ALLOWED_SCHEMES };
};

// =============================================================================
// Internal helpers (pure sync)
// =============================================================================

/**
 * Parse a URL and extract its scheme.
 * Returns None for relative URLs (no scheme).
 * @internal
 */
const extractScheme = (url: string): Option.Option<string> => {
  // Try parsing as absolute URL first
  try {
    const parsed = new URL(url);
    return Option.some(parsed.protocol.replace(/:$/, "").toLowerCase());
  } catch {
    // Not an absolute URL - check for scheme pattern
    const schemeMatch = url.match(/^([a-z][a-z0-9+.-]*):/);
    const scheme = schemeMatch !== null ? schemeMatch[1] : undefined;
    if (scheme !== undefined) {
      return Option.some(scheme.toLowerCase());
    }
    // Relative URL (no scheme) - allowed
    return Option.none();
  }
};

// =============================================================================
// Sync validation (for renderer's DOM attribute path)
// =============================================================================

/**
 * Validate a URL synchronously, returning Option.some(url) for valid
 * or Option.none() for invalid.
 *
 * @remarks
 * Used by the renderer in the sync DOM attribute-setting path.
 *
 * @example
 * ```ts
 * const safe = SafeUrl.validateSync("https://example.com")
 * ```
 *
 * @category Security
 * @public
 *
 * @since 1.0.0
 */
export const validateSync = (url: string): Option.Option<string> => {
  if (url.trim() === "") {
    return Option.none();
  }

  const schemeOption = extractScheme(url);

  if (Option.isNone(schemeOption)) {
    // Relative URL - always allowed
    return Option.some(url);
  }

  const scheme = schemeOption.value;
  if (_config.allowedSchemes.includes(scheme.toLowerCase())) {
    return Option.some(url);
  }

  return Option.none();
};

// =============================================================================
// Effect-based validation (for Effect pipelines)
// =============================================================================

/**
 * Validate a URL string against the current configuration.
 *
 * @remarks
 * - Empty URLs are rejected with UnsafeUrlError
 * - Relative URLs (no scheme) are allowed
 * - Absolute URLs must use an allowed scheme
 * - javascript: and other dangerous schemes are blocked by default
 *
 * @example
 * ```ts
 * // These succeed:
 * yield* SafeUrl.validate("/page")
 * yield* SafeUrl.validate("https://example.com")
 *
 * // These fail with UnsafeUrlError:
 * yield* SafeUrl.validate("javascript:alert(1)")
 * yield* SafeUrl.validate("")
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const validate: (url: string) => Effect.Effect<string, UnsafeUrlError> = Effect.fn(
  "SafeUrl.validate",
)(function* (url: string) {
  const config = getConfig();

  // Empty URL check
  if (url.trim() === "") {
    return yield* new UnsafeUrlError({
      url,
      reason: "empty_url",
      allowedSchemes: config.allowedSchemes,
    });
  }

  // Parse and check scheme
  const schemeOption = extractScheme(url);

  if (Option.isNone(schemeOption)) {
    // Relative URL - always allowed
    return url;
  }

  const scheme = schemeOption.value;
  if (!config.allowedSchemes.includes(scheme.toLowerCase())) {
    return yield* new UnsafeUrlError({
      url,
      reason: "unsafe_scheme",
      scheme,
      allowedSchemes: config.allowedSchemes,
    });
  }

  return url;
});

/**
 * Validate a URL, returning Option.some(url) for valid or Option.none() for invalid.
 * Does not fail — useful when you want to skip invalid URLs without error handling.
 *
 * @remarks
 * Use this when invalid URLs should be dropped instead of surfaced as
 * `UnsafeUrlError` failures.
 *
 * @example
 * ```ts
 * const result = yield* SafeUrl.validateOption("javascript:alert(1)")
 * // Option.none()
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const validateOption = (url: string): Effect.Effect<Option.Option<string>> =>
  Effect.sync(() => validateSync(url));

/**
 * Check if a URL is safe.
 *
 * @remarks
 * `isSafe` gives the same scheme verdict as `validateSync`, but collapsed to a
 * boolean for guard-style control flow.
 *
 * @example
 * ```ts
 * const safe = yield* SafeUrl.isSafe("https://example.com")
 * // true
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const isSafe = (url: string): Effect.Effect<boolean> =>
  Effect.sync(() => Option.isSome(validateSync(url)));
