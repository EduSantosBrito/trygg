/**
 * @since 1.0.0
 * SafeUrl validation for secure href/src attributes
 *
 * Uses WHATWG URL parsing and a scheme allowlist to prevent
 * dangerous URLs like `javascript:` from being rendered.
 *
 * @see https://url.spec.whatwg.org/ - WHATWG URL Standard
 * @see https://www.iana.org/assignments/uri-schemes/ - IANA URI Schemes
 */
import { Data, Effect, Option } from "effect";

/**
 * Error thrown when a URL fails validation
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

/**
 * Get the current SafeUrl configuration
 * @since 1.0.0
 */
export const getConfig = (): SafeUrlConfig => _config;

/**
 * Add custom schemes to the allowlist.
 *
 * Use this for:
 * - App-specific deep links (e.g., "myapp://")
 * - Browser extension protocols (e.g., "chrome-extension://")
 * - Custom protocols registered with the OS
 *
 * @example
 * ```ts
 * // Add custom deep link scheme
 * SafeUrl.allowSchemes(["myapp", "web+myapp"])
 *
 * // Now these URLs are valid:
 * // href="myapp://settings"
 * // href="web+myapp://page"
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

/**
 * Parse a URL and extract its scheme.
 * Handles both absolute and relative URLs.
 * @internal
 */
const parseUrlScheme = (url: string): Option.Option<string> => {
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

/**
 * Check if a URL has an allowed scheme.
 * @internal
 */
const isSchemeAllowed = (scheme: string, allowedSchemes: ReadonlyArray<string>): boolean => {
  return allowedSchemes.includes(scheme.toLowerCase());
};

/**
 * Validate a URL string against the current configuration.
 *
 * - Empty URLs are rejected
 * - Relative URLs (no scheme) are allowed
 * - Absolute URLs must use an allowed scheme
 * - javascript: and other dangerous schemes are blocked by default
 *
 * @example
 * ```ts
 * // These are valid:
 * SafeUrl.validate("/page")                    // relative
 * SafeUrl.validate("https://example.com")      // https
 * SafeUrl.validate("mailto:me@example.com")    // mailto
 *
 * // These fail with UnsafeUrlError:
 * SafeUrl.validate("javascript:alert(1)")      // unsafe scheme
 * SafeUrl.validate("")                         // empty
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
  const schemeOption = parseUrlScheme(url);

  if (Option.isNone(schemeOption)) {
    // Relative URL - always allowed
    return url;
  }

  const scheme = schemeOption.value;

  if (!isSchemeAllowed(scheme, config.allowedSchemes)) {
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
 * Validate a URL synchronously.
 * Returns Option.none() for invalid URLs, Option.some(url) for valid.
 * Use this when you need sync validation (e.g., in render paths).
 *
 * @since 1.0.0
 */
export const validateSync = (url: string): Option.Option<string> => {
  const config = getConfig();

  // Empty URL check
  if (url.trim() === "") {
    return Option.none();
  }

  // Parse and check scheme
  const schemeOption = parseUrlScheme(url);

  if (Option.isNone(schemeOption)) {
    // Relative URL - always allowed
    return Option.some(url);
  }

  const scheme = schemeOption.value;

  if (!isSchemeAllowed(scheme, config.allowedSchemes)) {
    return Option.none();
  }

  return Option.some(url);
};

/**
 * Validate a URL synchronously and throw UnsafeUrlError on failure.
 * Use validateOrWarn for graceful degradation with logging.
 *
 * @since 1.0.0
 */
export const validateOrThrow = (url: string): string => {
  const config = getConfig();

  // Empty URL check
  if (url.trim() === "") {
    throw new UnsafeUrlError({
      url,
      reason: "empty_url",
      allowedSchemes: config.allowedSchemes,
    });
  }

  // Parse and check scheme
  const schemeOption = parseUrlScheme(url);

  if (Option.isNone(schemeOption)) {
    // Relative URL - always allowed
    return url;
  }

  const scheme = schemeOption.value;

  if (!isSchemeAllowed(scheme, config.allowedSchemes)) {
    throw new UnsafeUrlError({
      url,
      reason: "unsafe_scheme",
      scheme,
      allowedSchemes: config.allowedSchemes,
    });
  }

  return url;
};

/**
 * Check if a URL is safe without throwing.
 * Use for conditional rendering or logging.
 *
 * @since 1.0.0
 */
export const isSafe = (url: string): boolean => {
  return Option.isSome(validateSync(url));
};
