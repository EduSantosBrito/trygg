/**
 * @since 1.0.0
 * Trygger — Effect-native typed API client factory.
 *
 * Collapses HttpApiClient boilerplate into a single call:
 *
 * @example
 * ```typescript
 * import { Trygger } from "trygg/api"
 * import { Api } from "@my-backend/effect"
 *
 * export const ApiClient = Trygger(Api, { baseUrl: "http://localhost:3000" })
 *
 * // Usage:
 * const client = yield* ApiClient
 * yield* client.UsersGroup.create({ payload: { name: "Alice" } })
 *
 * // Provide in parent:
 * myComponent.provide(ApiClient.Default)
 * ```
 *
 * @module
 */
import {
  FetchHttpClient,
  HttpApiClient,
  type HttpApi,
  type HttpApiGroup,
  type HttpApiMiddleware,
  type HttpClient,
} from "@effect/platform";
import { Context, Effect, Layer, type Types } from "effect";

// ---------------------------------------------------------------------------
// Type utilities
// ---------------------------------------------------------------------------

/**
 * Extract the Groups type parameter from an HttpApi.
 *
 * @since 1.0.0
 * @category type utilities
 */
type GroupsOf<A> =
  A extends HttpApi.HttpApi<infer _Id, infer Groups, infer _E, infer _R> ? Groups : never;

/**
 * Extract the Error type parameter from an HttpApi.
 *
 * @since 1.0.0
 * @category type utilities
 */
type ErrorOf<A> =
  A extends HttpApi.HttpApi<infer _Id, infer _Groups, infer E, infer _R> ? E : never;

/**
 * Derive the client shape from an HttpApi class.
 * Pure type-level computation — no runtime cost.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type ClientOf<A extends HttpApi.HttpApi.Any> = Types.Simplify<
  HttpApiClient.Client<GroupsOf<A>, ErrorOf<A>, never>
>;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Configuration for `Trygger`.
 * All fields pass through to `HttpApiClient.make`.
 *
 * @since 1.0.0
 * @category models
 */
export interface TryggerOptions {
  readonly baseUrl?: string | URL | undefined;
  readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined;
  readonly transformResponse?:
    | ((effect: Effect.Effect<unknown, unknown>) => Effect.Effect<unknown, unknown>)
    | undefined;
}

// ---------------------------------------------------------------------------
// Tag interface
// ---------------------------------------------------------------------------

/**
 * A `Context.Tag` with `.Default` and `.layer()` attached.
 *
 * - `yield* tag` — obtain the typed client
 * - `tag.Default` — layer with FetchHttpClient baked in (browser default)
 * - `tag.layer(opts?)` — layer requiring HttpClient (custom transport / SSR)
 *
 * Parameterized on the decomposed Api types to avoid conditional-type
 * reduction issues inside generic implementations.
 *
 * @since 1.0.0
 * @category models
 */
export interface TryggerTag<
  Client,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  ApiError,
  ApiR,
> extends Context.Tag<Client, Types.Simplify<HttpApiClient.Client<Groups, ApiError, never>>> {
  /**
   * Layer with FetchHttpClient auto-provided.
   * R = never for simple Apis without middleware context.
   */
  readonly Default: Layer.Layer<
    Client,
    never,
    HttpApiMiddleware.HttpApiMiddleware.Without<
      ApiR | HttpApiGroup.HttpApiGroup.ClientContext<Groups>
    >
  >;

  /**
   * Layer requiring HttpClient — for custom transport, SSR, or testing.
   */
  readonly layer: (
    opts?: TryggerOptions,
  ) => Layer.Layer<
    Client,
    never,
    | HttpApiMiddleware.HttpApiMiddleware.Without<
        ApiR | HttpApiGroup.HttpApiGroup.ClientContext<Groups>
      >
    | HttpClient.HttpClient
  >;
}

/**
 * Convenience alias: extract the TryggerTag type from an HttpApi.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type TryggerTagOf<A extends HttpApi.HttpApi.Any> = TryggerTag<
  ClientOf<A>,
  GroupsOf<A>,
  ErrorOf<A>,
  ContextOf<A>
>;

/**
 * Extract the R (context) type parameter from an HttpApi.
 * @internal
 */
type ContextOf<A> =
  A extends HttpApi.HttpApi<infer _Id, infer _Groups, infer _E, infer R> ? R : never;

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create a typed API client tag from an HttpApi class.
 *
 * @since 1.0.0
 * @category constructors
 *
 * @example
 * ```typescript
 * import { Trygger } from "trygg/api"
 * import { Api } from "@my-backend/effect"
 *
 * export const ApiClient = Trygger(Api, { baseUrl: "http://localhost:3000" })
 * ```
 */
export const Trygger = <
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  ApiError,
  ApiR,
>(
  api: HttpApi.HttpApi<Id, Groups, ApiError, ApiR>,
  options?: TryggerOptions,
): TryggerTag<
  Types.Simplify<HttpApiClient.Client<Groups, ApiError, never>>,
  Groups,
  ApiError,
  ApiR
> => {
  type Client = Types.Simplify<HttpApiClient.Client<Groups, ApiError, never>>;

  const groupKeys = Object.keys(api.groups).sort().join(",");
  const key = `@trygg/Trygger:${groupKeys}`;
  const tag = Context.GenericTag<Client>(key);

  const makeClientEffect = (opts: TryggerOptions | undefined) =>
    HttpApiClient.make(api, {
      baseUrl: opts?.baseUrl,
      transformClient: opts?.transformClient,
      transformResponse: opts?.transformResponse,
    });

  const layer = (overrideOpts?: TryggerOptions) =>
    Layer.effect(tag, makeClientEffect(overrideOpts ?? options));

  const defaultLayer = Layer.provide(layer(), FetchHttpClient.layer);

  return Object.assign(tag, {
    Default: defaultLayer,
    layer,
  }) satisfies TryggerTag<Client, Groups, ApiError, ApiR>;
};
