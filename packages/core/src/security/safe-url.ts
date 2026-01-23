/**
 * @since 1.0.0
 * SafeUrl validation for secure href/src attributes
 *
 * Uses WHATWG URL parsing and a scheme allowlist to prevent
 * dangerous URLs like `javascript:` from being rendered.
 *
 * Config functions (getConfig, resetConfig, allowSchemes) are sync
 * since they only read/write module-level state with no failure modes.
 *
 * Validation functions (validate, validateOption, isSafe) return Effects
 * for composability in Effect pipelines.
 *
 * validateSync is provided for the renderer's sync DOM attribute path.
 *
 * @see https://url.spec.whatwg.org/ - WHATWG URL Standard
 * @see https://www.iana.org/assignments/uri-schemes/ - IANA URI Schemes
 */
import { Data, Effect, Option } from "effect";

/**
 * Error produced when a URL fails validation.
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
 * Configuration for SafeUrl validation
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
 * @since 1.0.0
 */
export const getConfig = (): SafeUrlConfig => _config;

/**
 * Add custom schemes to the allowlist.
 *
 * @example
 * ```ts
 * SafeUrl.allowSchemes(["myapp", "web+myapp"])
 * ```
 *
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
 * Useful for testing.
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
 * Used by the renderer in the sync DOM attribute-setting path.
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
 * @example
 * ```ts
 * const result = yield* SafeUrl.validateOption("javascript:alert(1)")
 * // Option.none()
 * ```
 *
 * @since 1.0.0
 */
export const validateOption = (url: string): Effect.Effect<Option.Option<string>> =>
  Effect.sync(() => validateSync(url));

/**
 * Check if a URL is safe.
 *
 * @example
 * ```ts
 * const safe = yield* SafeUrl.isSafe("https://example.com")
 * // true
 * ```
 *
 * @since 1.0.0
 */
export const isSafe = (url: string): Effect.Effect<boolean> =>
  Effect.sync(() => Option.isSome(validateSync(url)));
