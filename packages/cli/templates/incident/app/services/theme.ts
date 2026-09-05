import { Cause, Effect, Layer, Option, Predicate, Schema, Scope } from "effect";
import * as Context from "effect/Context";
import { Signal } from "trygg";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export const ThemeMode = Schema.Union([Schema.Literal("dark"), Schema.Literal("light")]);
export type ThemeMode = Schema.Schema.Type<typeof ThemeMode>;

export const ThemePreference = Schema.Union([
  Schema.Literal("dark"),
  Schema.Literal("light"),
  Schema.Literal("system"),
]);
export type ThemePreference = Schema.Schema.Type<typeof ThemePreference>;

export class ThemeBrowserError extends Schema.TaggedError<ThemeBrowserError>()(
  "ThemeBrowserError",
  {
    operation: Schema.Union([
      Schema.Literal("readCookie"),
      Schema.Literal("writeCookie"),
      Schema.Literal("matchMedia"),
      Schema.Literal("addListener"),
      Schema.Literal("removeListener"),
    ]),
    cause: Schema.Unknown,
  },
) {}

export class ThemeCookieError extends Schema.TaggedError<ThemeCookieError>()("ThemeCookieError", {
  operation: Schema.Union([Schema.Literal("decodeCookie"), Schema.Literal("encodeCookie")]),
  cause: Schema.Unknown,
}) {}

export class ThemePreferenceError extends Schema.TaggedError<ThemePreferenceError>()(
  "ThemePreferenceError",
  {
    value: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export type AppThemeError = ThemeBrowserError | ThemeCookieError | ThemePreferenceError;

// ---------------------------------------------------------------------------
// Browser boundary
// ---------------------------------------------------------------------------

export interface ThemeMediaQuery {
  readonly matches: boolean;
  readonly addChangeListener: (listener: () => void) => void;
  readonly removeChangeListener: (listener: () => void) => void;
}

export interface ThemeBrowserHost {
  readonly readCookies: () => string | undefined;
  readonly writeCookie: (cookie: string) => void;
  /** undefined means SSR; null means the browser lacks matchMedia. */
  readonly matchMedia: () => ThemeMediaQuery | null | undefined;
}

export class ThemeBrowser extends Context.Service<
  ThemeBrowser,
  {
    readonly readCookies: Effect.Effect<string | undefined, ThemeBrowserError>;
    readonly writeCookie: (cookie: string) => Effect.Effect<void, ThemeBrowserError>;
    readonly systemDark: Effect.Effect<Option.Option<boolean>, ThemeBrowserError>;
    readonly subscribeSystemTheme: (
      onChange: () => void,
    ) => Effect.Effect<void, ThemeBrowserError, Scope.Scope>;
  }
>()("trygg/ThemeBrowser") {}

export type ThemeBrowserService = typeof ThemeBrowser.Service;

const makeBrowser = (host: ThemeBrowserHost): ThemeBrowserService => {
  const mediaQuery: Effect.Effect<ThemeMediaQuery | undefined, ThemeBrowserError> = Effect.try({
    try: host.matchMedia,
    catch: (cause) => new ThemeBrowserError({ operation: "matchMedia", cause }),
  }).pipe(
    Effect.flatMap((query) =>
      query === null
        ? Effect.fail(
            new ThemeBrowserError({
              operation: "matchMedia",
              cause: "window.matchMedia is unavailable",
            }),
          )
        : Effect.succeed(query),
    ),
  );

  return {
    readCookies: Effect.try({
      try: host.readCookies,
      catch: (cause) => new ThemeBrowserError({ operation: "readCookie", cause }),
    }),

    writeCookie: (cookie) =>
      Effect.try({
        try: () => host.writeCookie(cookie),
        catch: (cause) => new ThemeBrowserError({ operation: "writeCookie", cause }),
      }),

    systemDark: mediaQuery.pipe(
      Effect.flatMap((query) =>
        query === undefined
          ? Effect.succeed(Option.none<boolean>())
          : Effect.try({
              try: () => query.matches,
              catch: (cause) => new ThemeBrowserError({ operation: "matchMedia", cause }),
            }).pipe(Effect.map(Option.some)),
      ),
    ),

    subscribeSystemTheme: (onChange) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const query = yield* mediaQuery;
          if (query === undefined) {
            return undefined;
          }

          yield* Effect.try({
            try: () => query.addChangeListener(onChange),
            catch: (cause) => new ThemeBrowserError({ operation: "addListener", cause }),
          });
          return query;
        }),
        (query) =>
          query === undefined
            ? Effect.void
            : Effect.try({
                try: () => query.removeChangeListener(onChange),
                catch: (cause) => new ThemeBrowserError({ operation: "removeListener", cause }),
              }).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Theme listener cleanup failed").pipe(
                    Effect.annotateLogs("error", error),
                    Effect.asVoid,
                  ),
                ),
              ),
      ).pipe(Effect.asVoid),
  };
};

const liveHost: ThemeBrowserHost = {
  readCookies: () => (typeof document === "undefined" ? undefined : document.cookie),
  writeCookie: (cookie) => {
    if (typeof document !== "undefined") {
      document.cookie = cookie;
    }
  },
  matchMedia: () => {
    if (typeof window === "undefined") {
      return undefined;
    }
    if (typeof window.matchMedia !== "function") {
      return null;
    }

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    return {
      get matches() {
        return query.matches;
      },
      addChangeListener: (listener) => query.addEventListener("change", listener),
      removeChangeListener: (listener) => query.removeEventListener("change", listener),
    };
  },
};

export namespace ThemeBrowser {
  export const make = makeBrowser;

  export const layer = (host: ThemeBrowserHost): Layer.Layer<ThemeBrowser> =>
    Layer.succeed(ThemeBrowser, make(host));

  export const live = layer(liveHost);
}

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

/**
 * Manages the active theme mode. The layer owns both signals, the media-query
 * listener, and all callback fibers started by that listener.
 */
export class AppTheme extends Context.Service<
  AppTheme,
  {
    /** Reactive theme mode - pass to JSX attributes for fine-grained updates. */
    readonly mode: Signal.Signal<ThemeMode>;
    /** User preference - explicit theme or system. */
    readonly preference: Signal.Signal<ThemePreference>;
    readonly setPreference: (preference: ThemePreference) => Effect.Effect<void, AppThemeError>;
    readonly toggle: Effect.Effect<void, AppThemeError>;
  }
>()("trygg/AppTheme") {}

export type AppThemeService = typeof AppTheme.Service;

export class AppThemeUnavailable extends Schema.TaggedError<AppThemeUnavailable>()(
  "AppThemeUnavailable",
  {},
) {}

/** Re-exports the exact document-root theme instance to a route component. */
export namespace AppTheme {
  export const fromRoot = Layer.effect(
    AppTheme,
    // oxlint-disable-next-line effect/no-service-option -- Route providers must close the static requirement without constructing a second theme service.
    Effect.serviceOption(AppTheme).pipe(
      Effect.flatMap((service) =>
        Option.isSome(service)
          ? Effect.succeed(service.value)
          : Effect.fail(new AppThemeUnavailable()),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Layers - same Tag, different initial configuration
// ---------------------------------------------------------------------------

const STORAGE_KEY = "theme";

const readCookie = Effect.fn("ThemeBrowser.readCookie")(function* (
  browser: ThemeBrowserService,
  key: string,
) {
  const cookies = yield* browser.readCookies;
  if (cookies === undefined) {
    return null;
  }

  const prefix = `${key}=`;
  const entry = cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix));
  if (entry === undefined) {
    return null;
  }

  return yield* Effect.try({
    try: () => decodeURIComponent(entry.slice(prefix.length)),
    catch: (cause) => new ThemeCookieError({ operation: "decodeCookie", cause }),
  });
});

const writeCookie = Effect.fn("ThemeBrowser.writeCookie")(function* (
  browser: ThemeBrowserService,
  key: string,
  value: string,
) {
  const encoded = yield* Effect.try({
    try: () => encodeURIComponent(value),
    catch: (cause) => new ThemeCookieError({ operation: "encodeCookie", cause }),
  });
  yield* browser.writeCookie(`${key}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax`);
});

const decodeThemePreference = Schema.decodeUnknownEffect(ThemePreference);

const readStoredPreference = (
  browser: ThemeBrowserService,
): Effect.Effect<ThemePreference, AppThemeError> =>
  readCookie(browser, STORAGE_KEY).pipe(
    Effect.flatMap((stored) =>
      stored === null
        ? Effect.succeed<ThemePreference>("system")
        : decodeThemePreference(stored).pipe(
            Effect.mapError((cause) => new ThemePreferenceError({ value: stored, cause })),
          ),
    ),
  );

const resolveMode = (
  browser: ThemeBrowserService,
  preference: ThemePreference,
  fallback: ThemeMode,
): Effect.Effect<ThemeMode, ThemeBrowserError> =>
  preference === "system"
    ? browser.systemDark.pipe(
        Effect.map(
          Option.match({
            onNone: () => fallback,
            onSome: (dark): ThemeMode => (dark ? "dark" : "light"),
          }),
        ),
      )
    : Effect.succeed(preference);

const reportThemeCallbackCause = (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.interrupt
    : Effect.logError("System theme callback failed").pipe(
        Effect.annotateLogs("cause", Cause.pretty(cause)),
        Effect.asVoid,
      );

const subscribeToSystemTheme = Effect.fn("AppTheme.subscribeToSystemTheme")(function* (
  browser: ThemeBrowserService,
  fallback: ThemeMode,
  preference: Signal.Signal<ThemePreference>,
  mode: Signal.Signal<ThemeMode>,
) {
  const owner = yield* Effect.scope;
  const callbacks = yield* Scope.fork(owner);
  const services = yield* Effect.context();
  const runCallback = (effect: Effect.Effect<void>): void => {
    if (Predicate.isTagged(owner.state, "Closed")) return;
    // Own the fiber before browser calls can reenter shutdown. Restore the
    // captured Scheduler inside the child of the synchronous launcher.
    Effect.runSyncWith(services)(Effect.forkIn(effect.pipe(Effect.provide(services)), callbacks));
  };

  yield* browser.subscribeSystemTheme(() => {
    runCallback(
      Effect.suspend(() =>
        Effect.gen(function* () {
          const currentPreference = yield* Signal.peek(preference);
          if (currentPreference !== "system") {
            return;
          }

          const nextMode = yield* resolveMode(browser, currentPreference, fallback);
          yield* Signal.set(mode, nextMode);
        }),
      ).pipe(Effect.catchCause(reportThemeCallbackCause)),
    );
  });
});

const appThemeLayer = (
  fallback: ThemeMode,
): Layer.Layer<AppTheme, AppThemeError | Signal.SignalScopeError, ThemeBrowser> =>
  Layer.effect(
    AppTheme,
    Effect.gen(function* () {
      const browser = yield* ThemeBrowser;
      const initialPreference = yield* readStoredPreference(browser);
      const preference = yield* Signal.make<ThemePreference>(initialPreference);
      const initialMode = yield* resolveMode(browser, initialPreference, fallback);
      const mode = yield* Signal.make<ThemeMode>(initialMode);

      const setPreference = Effect.fn("AppTheme.setPreference")(function* (next: ThemePreference) {
        const nextMode = yield* resolveMode(browser, next, fallback);
        yield* writeCookie(browser, STORAGE_KEY, next);
        yield* Signal.set(preference, next);
        yield* Signal.set(mode, nextMode);
      });

      yield* subscribeToSystemTheme(browser, fallback, preference, mode);

      const toggle = Effect.gen(function* () {
        const next: ThemeMode = (yield* Signal.peek(mode)) === "dark" ? "light" : "dark";
        yield* setPreference(next);
      }).pipe(Effect.withSpan("AppTheme.toggle"));

      return AppTheme.of({ mode, preference, setPreference, toggle });
    }).pipe(Effect.annotateLogs({ service: "AppTheme" })),
  );

export namespace AppTheme {
  export const layer = appThemeLayer;

  /** Dark fallback for non-browser environments. */
  export const dark = layer("dark").pipe(Layer.provide(ThemeBrowser.live));

  /** Light fallback for non-browser environments. */
  export const light = layer("light").pipe(Layer.provide(ThemeBrowser.live));
}
