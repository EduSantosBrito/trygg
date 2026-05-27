/**
 * Type utilities for the `trygg/api` entrypoint.
 *
 * @remarks
 * Owner module for the API typing surface used by `app/api.ts`. The same
 * symbols are also reachable from the root `trygg.Api` namespace.
 *
 * When the Vite plugin is active and `app/api.ts` exports `const Api`, the
 * `trygg/api` virtual module additionally provides runtime exports
 * (`ApiClient`, `ApiClientLive`) generated from that `Api` definition.
 *
 * @see ./api.docs.md - Source-owned topic guide
 * @since 1.0.0
 * @module trygg/api
 */
import type { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import type { Effect, Types } from "effect";

/**
 * Extract handler signature from an HttpApiEndpoint.
 *
 * @remarks
 * Use `Handler` when a route module wants the exact request, success, and
 * error types derived from an endpoint definition without repeating them by
 * hand.
 *
 * @example
 * ```ts
 * import type { Handler } from "trygg/api"
 *
 * export const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id", {
 *   params: { id: Schema.String },
 *   success: UserSchema,
 *   error: NotFoundError,
 * })
 *
 * export const handler: Handler<typeof endpoint> = ({ path }) =>
 *   UserService.findById(path.id)
 * ```
 *
 * @category API Types
 * @public
 * @since 1.0.0
 */
export type Handler<E extends HttpApiEndpoint.Any, R = never> = (
  request: Types.Simplify<HttpApiEndpoint.Request<E>>,
) => Effect.Effect<
  HttpApiEndpoint.Success<E>["Type"],
  HttpApiEndpoint.Error<E>["Type"],
  // R is configurable by callers when handlers require services.
  R
>;

/**
 * Extract handlers map signature from an HttpApiGroup.
 *
 * @remarks
 * `GroupHandlers` turns an HttpApi group definition into the exact object shape
 * expected by a handler module, so missing or misspelled handlers fail in the
 * type checker.
 *
 * @example
 * ```ts
 * import type { GroupHandlers } from "trygg/api"
 *
 * export const group = HttpApiGroup.make("users")
 *   .add(HttpApiEndpoint.get("listUsers", "/api/users"))
 *   .add(HttpApiEndpoint.post("createUser", "/api/users", { payload: CreateUser }))
 *
 * export const handlers: GroupHandlers<typeof group> = {
 *   listUsers: () => UserService.list(),
 *   createUser: ({ payload }) => UserService.create(payload)
 * }
 * ```
 *
 * @category API Types
 * @public
 * @since 1.0.0
 */
export type GroupHandlers<G extends HttpApiGroup.Any> = {
  readonly [K in HttpApiEndpoint.Name<HttpApiGroup.Endpoints<G>>]: Handler<
    HttpApiEndpoint.WithName<HttpApiGroup.Endpoints<G>, K>
  >;
};

/**
 * Extract request type from an endpoint.
 *
 * @remarks
 * `Request` is useful when helpers need the same decoded request shape as the
 * handler itself, including path params, query, payload, and headers.
 *
 * @example
 * ```ts
 * type GetUserRequest = Request<typeof endpoint>
 * ```
 *
 * @category API Types
 * @public
 * @since 1.0.0
 */
export type Request<E extends HttpApiEndpoint.Any> = Types.Simplify<HttpApiEndpoint.Request<E>>;

/**
 * Extract success type from an endpoint.
 *
 * @remarks
 * Use `Success` when code needs the value produced by a successful handler
 * without re-reading the endpoint schema.
 *
 * @example
 * ```ts
 * type GetUserSuccess = Success<typeof endpoint>
 * ```
 *
 * @category API Types
 * @public
 * @since 1.0.0
 */
export type Success<E extends HttpApiEndpoint.Any> = HttpApiEndpoint.Success<E>["Type"];

/**
 * Extract error type from an endpoint.
 *
 * @remarks
 * `Error` mirrors the endpoint error schema so shared helpers can describe the
 * failure channel exactly.
 *
 * @example
 * ```ts
 * type GetUserError = Error<typeof endpoint>
 * ```
 *
 * @category API Types
 * @public
 * @since 1.0.0
 */
export type Error<E extends HttpApiEndpoint.Any> = HttpApiEndpoint.Error<E>["Type"];

/**
 * Extract the path type from an endpoint (the decoded path parameters).
 *
 * @remarks
 * `Path` gives helpers the decoded params shape after HttpApi parsing, not the
 * raw URL string segments.
 *
 * @example
 * ```ts
 * type GetUserPath = Path<typeof endpoint>
 * ```
 *
 * @category API Types
 * @public
 * @since 1.0.0
 */
export type Path<E extends HttpApiEndpoint.Any> =
  HttpApiEndpoint.Params<E> extends {
    readonly Type: unknown;
  }
    ? HttpApiEndpoint.Params<E>["Type"]
    : never;

/**
 * Extract the URL params type from an endpoint.
 *
 * @remarks
 * `UrlParams` mirrors the decoded query-string schema for helpers that work on
 * pagination, filters, or other query inputs.
 *
 * @example
 * ```ts
 * type ListUsersQuery = UrlParams<typeof endpoint>
 * ```
 *
 * @category API Types
 * @public
 * @since 1.0.0
 */
export type UrlParams<E extends HttpApiEndpoint.Any> =
  HttpApiEndpoint.Query<E> extends {
    readonly Type: unknown;
  }
    ? HttpApiEndpoint.Query<E>["Type"]
    : never;

/**
 * Extract the payload type from an endpoint.
 *
 * @remarks
 * `Payload` is the typed request body shape after schema decoding.
 *
 * @example
 * ```ts
 * type CreateUserPayload = Payload<typeof endpoint>
 * ```
 *
 * @category API Types
 * @public
 * @since 1.0.0
 */
export type Payload<E extends HttpApiEndpoint.Any> =
  HttpApiEndpoint.Payload<E> extends {
    readonly Type: unknown;
  }
    ? HttpApiEndpoint.Payload<E>["Type"]
    : never;

/**
 * Extract the headers type from an endpoint.
 *
 * @remarks
 * `Headers` reflects the decoded headers schema when an endpoint requires
 * typed auth or metadata headers.
 *
 * @example
 * ```ts
 * type AuthHeaders = Headers<typeof endpoint>
 * ```
 *
 * @category API Types
 * @public
 * @since 1.0.0
 */
export type Headers<E extends HttpApiEndpoint.Any> =
  HttpApiEndpoint.Headers<E> extends {
    readonly Type: unknown;
  }
    ? HttpApiEndpoint.Headers<E>["Type"]
    : never;
