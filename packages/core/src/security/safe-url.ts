/**
 * SafeUrl validation for URL-bearing DOM attributes.
 *
 * @remarks
 * Owner module for the `SafeUrl` topic. Use this module when URLs can cross an
 * untrusted boundary before they reach URL-bearing DOM attributes.
 * The root `trygg` entrypoint publishes this topic as `SafeUrl.*` and
 * `UnsafeUrlError`.
 *
 * @see ./safe-url.docs.md - Source-owned topic guide
 * @see https://url.spec.whatwg.org/ - WHATWG URL Standard
 * @see https://www.iana.org/assignments/uri-schemes/ - IANA URI Schemes
 * @since 1.0.0
 * @module trygg/security/safe-url
 */
import { Effect, Exit, Layer, Match, Option, Result, Schema } from "effect";
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
export class UnsafeUrlError extends Schema.TaggedError<UnsafeUrlError>()("UnsafeUrlError", {
  url: Schema.String,
  reason: Schema.Literals(["invalid_url", "unsafe_scheme", "empty_url"]),
  scheme: Schema.optional(Schema.String),
  allowedSchemes: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return Match.value(this.reason).pipe(
      Match.when(
        "invalid_url",
        () => `Invalid URL: "${this.url}". URL must be a valid absolute or relative URL.`,
      ),
      Match.when(
        "unsafe_scheme",
        () =>
          `Unsafe URL scheme "${this.scheme}" in "${this.url}". ` +
          `Allowed schemes: ${this.allowedSchemes.join(", ")}. ` +
          `Provide SafeUrl.SafeUrlConfig.layer or a custom SafeUrlConfig layer to add custom schemes.`,
      ),
      Match.when("empty_url", () => `Empty URL is not allowed.`),
      Match.exhaustive,
    );
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
];

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
export class SafeUrlConfig extends Context.Service<
  SafeUrlConfig,
  { readonly allowedSchemes: ReadonlyArray<string> }
>()("@trygg/SafeUrlConfig") {
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

/**
 * URL-bearing DOM sink classes with distinct scheme policies.
 *
 * @remarks
 * Pass a sink to `allowedSchemesForSink` or `validateSyncForSink` so URL
 * validation follows the security contract of the target attribute.
 *
 * @example
 * ```ts
 * const sink: SafeUrl.UrlSink = "form"
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export type UrlSink = "navigation" | "form" | "resource" | "image" | "media";

const HTTP_SCHEMES: ReadonlyArray<string> = ["http", "https"];
const IMAGE_SCHEMES: ReadonlyArray<string> = ["http", "https", "blob", "data"];
const NAVIGATION_FORBIDDEN_SCHEMES: ReadonlyArray<string> = [
  "blob",
  "data",
  "javascript",
  "vbscript",
];

/**
 * Resolve the configured schemes that are safe for a concrete DOM sink.
 *
 * @remarks
 * Navigation supports configured custom schemes, while forms and executable
 * resources remain HTTP(S)-only. Blob and data URLs are limited to image and
 * media sinks.
 *
 * @example
 * ```ts
 * const schemes = SafeUrl.allowedSchemesForSink("image", SafeUrl.defaultConfig)
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const allowedSchemesForSink = (
  sink: UrlSink,
  config: SafeUrlConfigService,
): ReadonlyArray<string> => {
  const configured = Array.from(
    new Set(config.allowedSchemes.map((scheme) => scheme.toLowerCase())),
  );

  switch (sink) {
    case "navigation":
      return configured.filter((scheme) => !NAVIGATION_FORBIDDEN_SCHEMES.includes(scheme));
    case "form":
    case "resource":
      return configured.filter((scheme) => HTTP_SCHEMES.includes(scheme));
    case "image":
    case "media":
      return configured.filter((scheme) => IMAGE_SCHEMES.includes(scheme));
  }
};

// =============================================================================
// Internal helpers (pure sync)
// =============================================================================

const URL_PARSE_BASE = "https://trygg.invalid/";
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SPECIAL_SCHEMES: ReadonlyArray<string> = ["ftp", "file", "http", "https", "ws", "wss"];
const parseUrl = Option.liftThrowable((url: string) => new URL(url, URL_PARSE_BASE));
const parseAbsoluteUrl = Option.liftThrowable((url: string) => new URL(url));

type UrlInspectionFailure =
  | { readonly reason: "empty_url" | "invalid_url" }
  | { readonly reason: "unsafe_scheme"; readonly scheme: string };

const hasAmbiguousUrlControl = (url: string): boolean => {
  for (let index = 0; index < url.length; index++) {
    const code = url.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const inspectUrl = (
  url: string,
  allowedSchemes: ReadonlyArray<string>,
): Result.Result<string, UrlInspectionFailure> => {
  if (url.trim() === "") {
    return Result.fail({ reason: "empty_url" });
  }
  if (hasAmbiguousUrlControl(url)) {
    return Result.fail({ reason: "invalid_url" });
  }

  const parsed = parseUrl(url);
  if (Option.isNone(parsed)) {
    return Result.fail({ reason: "invalid_url" });
  }

  // Relative and scheme-relative references inherit the document's protocol.
  // Parsing still occurs first so browser-canonicalized scheme disguises cannot
  // be mistaken for a relative URL.
  const explicitUrl = url.replace(/^ +/, "");
  if (!EXPLICIT_SCHEME.test(explicitUrl)) {
    return Result.succeed(url);
  }

  const scheme = parsed.value.protocol.slice(0, -1).toLowerCase();
  if (!allowedSchemes.includes(scheme)) {
    return Result.fail({ reason: "unsafe_scheme", scheme });
  }

  const schemeEnd = explicitUrl.indexOf(":") + 1;
  if (SPECIAL_SCHEMES.includes(scheme) && !explicitUrl.startsWith("//", schemeEnd)) {
    return Result.succeed(url);
  }

  const absolute = parseAbsoluteUrl(url);
  return Result.succeed(
    Option.isSome(absolute) && absolute.value.href === parsed.value.href ? parsed.value.href : url,
  );
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
  return validateSyncForSink(url, "navigation", config);
};

/**
 * Validate a URL synchronously for a concrete DOM sink.
 *
 * @remarks
 * The WHATWG parser classifies the URL before the sink policy is applied.
 * Self-contained absolute URLs are canonicalized; references whose result
 * depends on the document base retain their original form.
 *
 * @example
 * ```ts
 * const safe = SafeUrl.validateSyncForSink(
 *   "data:image/png;base64,iVBORw0KGgo=",
 *   "image",
 *   SafeUrl.defaultConfig,
 * )
 * ```
 *
 * @category Security
 * @public
 * @since 1.0.0
 */
export const validateSyncForSink = (
  url: string,
  sink: UrlSink,
  config: SafeUrlConfigService,
): Option.Option<string> => {
  const result = inspectUrl(url, allowedSchemesForSink(sink, config));
  return Result.isSuccess(result) ? Option.some(result.success) : Option.none();
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
export const validate: (url: string) => Effect.Effect<string, UnsafeUrlError, SafeUrlConfig> =
  Effect.fn("SafeUrl.validate")(function* (url: string) {
    const config = yield* SafeUrlConfig;
    const allowedSchemes = allowedSchemesForSink("navigation", config);
    const result = inspectUrl(url, allowedSchemes);

    if (Result.isSuccess(result)) {
      return result.success;
    }

    if (result.failure.reason === "unsafe_scheme") {
      return yield* new UnsafeUrlError({
        url,
        reason: result.failure.reason,
        scheme: result.failure.scheme,
        allowedSchemes,
      });
    }

    return yield* new UnsafeUrlError({
      url,
      reason: result.failure.reason,
      allowedSchemes,
    });
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
export const validateOption: (
  url: string,
) => Effect.Effect<Option.Option<string>, never, SafeUrlConfig> = Effect.fn(
  "SafeUrl.validateOption",
)(function* (url: string) {
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
export const isSafe: (url: string) => Effect.Effect<boolean, never, SafeUrlConfig> = Effect.fn(
  "SafeUrl.isSafe",
)(function* (url: string) {
  const result = yield* validateOption(url);
  return Option.isSome(result);
});
