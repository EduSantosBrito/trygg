/**
 * @since 1.0.0
 * Route module loader with memoization, timeout, and retry
 *
 * Provides parallel module loading with:
 * - In-flight deduplication (concurrent requests share one load)
 * - Resolved module cache with configurable TTL
 * - Per-load timeout with configurable duration
 * - Exponential backoff retry with jitter
 */
import { Duration, Effect, Schedule, Runtime } from "effect"
import * as Debug from "../debug/debug.js"
import { RouteLoadTimeoutError } from "./types.js"

/** Cache entry with expiration */
interface CacheEntry<A> {
  readonly module: A
  readonly expiresAt: number
}

/** Result of a load operation - either success or timeout error */
type LoadResult<A> =
  | { readonly _tag: "success"; readonly module: A }
  | { readonly _tag: "error"; readonly error: RouteLoadTimeoutError }

/** Module loader configuration */
export interface ModuleLoaderConfig {
  /** Cache TTL in ms (default: 30000) */
  readonly cacheTtlMs: number
  /** Load timeout in ms (default: 8000) */
  readonly timeoutMs: number
  /** Max retry attempts (default: 2) */
  readonly maxRetries: number
  /** Total retry window in ms (default: 15000) */
  readonly retryWindowMs: number
  /** Retry backoff base in ms (default: 200) */
  readonly retryBackoffMs: number
}

const defaultConfig: ModuleLoaderConfig = {
  cacheTtlMs: 30_000,
  timeoutMs: 8_000,
  maxRetries: 2,
  retryWindowMs: 15_000,
  retryBackoffMs: 200
}

/** Module kind for loading (component, layout, etc.) */
export type ModuleKind = "component" | "layout" | "guard" | "loading" | "error" | "not_found"

/**
 * Creates a memoized module loader with timeout and retry.
 *
 * Features:
 * - In-flight deduplication: concurrent loads to same path share one request
 * - Resolved cache with TTL: avoids redundant loads within cache window
 * - Timeout per load: fails fast with RouteLoadTimeoutError
 * - Exponential backoff retry: handles transient failures
 *
 * @example
 * ```ts
 * const loader = createModuleLoader()
 * const module = yield* loader.load(
 *   "/users",
 *   "component",
 *   false,
 *   () => import("./routes/users.js")
 * )
 * ```
 */
export const createModuleLoader = (config: Partial<ModuleLoaderConfig> = {}) => {
  const cfg = { ...defaultConfig, ...config }

  // Resolved module cache (path:kind -> module)
  const cache = new Map<string, CacheEntry<unknown>>()

  // In-flight requests (path:kind -> Promise<LoadResult>)
  // Stores promises that resolve to LoadResult (never reject)
  const inFlight = new Map<string, Promise<LoadResult<unknown>>>()

  const cacheKey = (path: string, kind: ModuleKind): string => `${path}:${kind}`

  const load = Effect.fn("router.module.load")(function* <A>(
    path: string,
    kind: ModuleKind,
    isPrefetch: boolean,
    loader: () => Promise<A>
  ) {
    const runtime = yield* Effect.runtime<never>()
    const key = cacheKey(path, kind)

    // Check resolved cache
    const cached = cache.get(key)
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      yield* Debug.log({
        event: "router.module.load.cache_hit",
        path,
        kind,
        is_prefetch: isPrefetch
      })
      return cached.module as A
    }

    // Check in-flight - await existing promise
    const existing = inFlight.get(key)
    if (existing !== undefined) {
      const result = yield* Effect.promise(() => existing)
      if (result._tag === "error") {
        // TaggedError extends Effect, so we can yield* it directly
        return yield* result.error
      }
      return result.module as A
    }

    // Create the load effect with timeout
    const loadWithTimeout = Effect.fn("router.module.loadWithTimeout")(function* (attempt: number) {
      const startTime = Date.now()

      yield* Debug.log({
        event: "router.module.load.start",
        path,
        kind,
        is_prefetch: isPrefetch,
        attempt
      })

      const module = yield* Effect.promise(loader).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(cfg.timeoutMs),
          onTimeout: () =>
            new RouteLoadTimeoutError({
              path,
              kind,
              timeout_ms: cfg.timeoutMs,
              attempt,
              is_prefetch: isPrefetch
            })
        })
      )

      const duration = Date.now() - startTime

      yield* Debug.log({
        event: "router.module.load.complete",
        path,
        kind,
        duration_ms: duration,
        is_prefetch: isPrefetch,
        attempt
      })

      return module
    })

    // Build retry schedule: exponential backoff with jitter, capped by time and count
    const retrySchedule = Schedule.exponential(Duration.millis(cfg.retryBackoffMs), 2).pipe(
      Schedule.jittered,
      Schedule.intersect(Schedule.recurs(cfg.maxRetries)),
      Schedule.upTo(Duration.millis(cfg.retryWindowMs))
    )

    // Track attempt number across retries
    let currentAttempt = 0

    const loadEffect: Effect.Effect<A, RouteLoadTimeoutError> = Effect.suspend(() => {
      currentAttempt += 1
      return loadWithTimeout(currentAttempt)
    }).pipe(
      Effect.retry({
        schedule: retrySchedule,
        while: (error) => {
          // Log timeout event before retry
          Runtime.runSync(runtime)(
            Debug.log({
              event: "router.module.load.timeout",
              path,
              kind,
              timeout_ms: cfg.timeoutMs,
              is_prefetch: isPrefetch,
              attempt: error.attempt
            })
          )
          // Only retry RouteLoadTimeoutError
          return error._tag === "RouteLoadTimeoutError"
        }
      })
    )

    // Convert effect to promise that captures result as LoadResult (never rejects)
    const loadPromise: Promise<LoadResult<A>> = Runtime.runPromise(runtime)(
      loadEffect.pipe(
        Effect.map((module): LoadResult<A> => ({ _tag: "success", module })),
        Effect.catchAll((error) =>
          Effect.succeed<LoadResult<A>>({ _tag: "error", error })
        )
      )
    ).finally(() => {
      // Remove from in-flight when done
      inFlight.delete(key)
    })

    // Store in-flight
    inFlight.set(key, loadPromise as Promise<LoadResult<unknown>>)

    // Await and handle result
    const result = yield* Effect.promise(() => loadPromise)

    if (result._tag === "error") {
      // TaggedError extends Effect, so we can yield* it directly
      return yield* result.error
    }

    // Cache on success
    cache.set(key, {
      module: result.module,
      expiresAt: Date.now() + cfg.cacheTtlMs
    })

    return result.module
  })

  const invalidate = (path: string, kind?: ModuleKind): void => {
    if (kind !== undefined) {
      cache.delete(cacheKey(path, kind))
    } else {
      // Invalidate all kinds for this path
      for (const key of cache.keys()) {
        if (key.startsWith(`${path}:`)) {
          cache.delete(key)
        }
      }
    }
  }

  const clear = (): void => {
    cache.clear()
  }

  return { load, invalidate, clear }
}

/** Singleton module loader instance */
export const moduleLoader = createModuleLoader()
