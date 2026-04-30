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
import { Data, Effect, Exit, Layer, Option } from "effect";
import * as Context from "effect/Context";

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
          `Provide SafeUrl.SafeUrlConfig.layer or a custom SafeUrlConfig layer to add custom schemes.`
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
 * This list seeds the default SafeUrl service configuration.
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
 * `SafeUrlConfig` captures the allowlist used by `validate` and the
 * renderer's attribute sanitization path.
 *
 * @example
 * ```ts
 * const layer = Layer.succeed(SafeUrl.SafeUrlConfig, {
 *   allowedSchemes: ["https", "mailto"],
 * })
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export interface SafeUrlConfigService {
  readonly allowedSchemes: ReadonlyArray<string>;
}

/**
 * SafeUrl configuration service.
 *
 * @remarks
 * Provide this service to scope URL scheme allowlists to the current Effect
 * fiber. Use `SafeUrlConfig.layer` for framework defaults, or `Layer.succeed`
 * with a custom `allowedSchemes` list for tests and applications that need
 * additional schemes.
 *
 * @example
 * ```ts
 * const layer = Layer.succeed(SafeUrl.SafeUrlConfig, {
 *   allowedSchemes: ["https", "myapp"],
 * })
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export class SafeUrlConfig extends Context.Service<SafeUrlConfig, SafeUrlConfigService>()(
  "@trygg/SafeUrlConfig",
) {
  static readonly layer: Layer.Layer<SafeUrlConfig> = Layer.succeed(SafeUrlConfig, {
    allowedSchemes: DEFAULT_ALLOWED_SCHEMES,
  });
}

/**
 * Default SafeUrl configuration value.
 *
 * @remarks
 * Used by sync validation and renderer fallback paths when no `SafeUrlConfig`
 * service is present. Prefer `SafeUrlConfig.layer` for Effect-scoped code.
 *
 * @example
 * ```ts
 * const schemes = SafeUrl.defaultConfig.allowedSchemes
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const defaultConfig: SafeUrlConfigService = {
  allowedSchemes: DEFAULT_ALLOWED_SCHEMES,
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
export const validateSyncWithConfig = (
  url: string,
  config: SafeUrlConfigService,
): Option.Option<string> => {
  if (url.trim() === "") {
    return Option.none();
  }

  const schemeOption = extractScheme(url);

  if (Option.isNone(schemeOption)) {
    // Relative URL - always allowed
    return Option.some(url);
  }

  const scheme = schemeOption.value;
  if (config.allowedSchemes.includes(scheme.toLowerCase())) {
    return Option.some(url);
  }

  return Option.none();
};

/**
 * Validate a URL synchronously with the default allowlist.
 *
 * @remarks
 * This helper is for sync call sites that cannot read Effect context. Use
 * `validateSyncWithConfig` when a cached service config is already available.
 *
 * @example
 * ```ts
 * const safe = SafeUrl.validateSync("https://example.com")
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const validateSync = (url: string): Option.Option<string> =>
  validateSyncWithConfig(url, defaultConfig);

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
export const validate: (
  url: string,
) => Effect.Effect<string, UnsafeUrlError, SafeUrlConfig> = Effect.fn(
  "SafeUrl.validate",
)(function* (url: string) {
  const config = yield* SafeUrlConfig;

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
export const validateOption = (url: string): Effect.Effect<Option.Option<string>, never, SafeUrlConfig> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(validate(url));
    return Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none();
  });

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
export const isSafe = (url: string): Effect.Effect<boolean, never, SafeUrlConfig> =>
  Effect.gen(function* () {
    const result = yield* validateOption(url);
    return Option.isSome(result);
  });
