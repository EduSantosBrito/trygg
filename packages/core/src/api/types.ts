/**
 * @since 1.0.0
 * Type utilities for Effect HttpApi integration.
 *
 * These utilities provide compile-time type checking for API route handlers
 * without runtime overhead.
 *
 * @example
 * ```typescript
 * // Single endpoint (route.ts)
 * import { HttpApiEndpoint } from "effect/unstable/httpapi"
 * import type { Api } from "trygg"
 *
 * export const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id", {
 *   params: { id: Schema.String },
 *   success: UserSchema,
 * })
 *
 * export const handler: Api.Handler<typeof endpoint> = ({ path }) =>
 *   UserService.findById(path.id)
 * ```
 *
 * @example
 * ```typescript
 * // Multiple endpoints (group.ts)
 * import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
 * import type { Api } from "trygg"
 *
 * export const group = HttpApiGroup.make("users")
 *   .add(HttpApiEndpoint.get("listUsers", "/api/users"))
 *   .add(HttpApiEndpoint.post("createUser", "/api/users"))
 *
 * export const handlers: Api.GroupHandlers<typeof group> = {
 *   listUsers: () => UserService.list(),
 *   createUser: ({ payload }) => UserService.create(payload)
 * }
 * ```
 *
 * @module
 */
import type { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import type { Effect, Types } from "effect";

/**
 * Extract handler signature from an HttpApiEndpoint.
 * Provides compile-time type checking without runtime overhead.
 *
 * The handler receives the decoded request (path params, payload, headers, etc.)
 * and must return an Effect producing the success type or failing with the error type.
 *
 * @since 1.0.0
 * @category type utilities
 * @example
 * ```typescript
 * export const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id", {
 *   params: { id: Schema.String },
 *   success: UserSchema,
 *   error: NotFoundError,
 * })
 *
 * // Type annotation ensures handler matches endpoint signature
 * export const handler: Api.Handler<typeof endpoint> = ({ path }) =>
 *   UserService.findById(path.id)
 * ```
 */
export type Handler<E extends HttpApiEndpoint.Any> = (
  request: Types.Simplify<HttpApiEndpoint.Request<E>>,
) => Effect.Effect<
  HttpApiEndpoint.Success<E>["Type"],
  HttpApiEndpoint.Error<E>["Type"],
  // R is inferred from implementation - allows any dependencies
  any
>;

/**
 * Extract handlers map signature from an HttpApiGroup.
 * Keys are endpoint names, values are handler functions.
 *
 * @since 1.0.0
 * @category type utilities
 * @example
 * ```typescript
 * export const group = HttpApiGroup.make("users")
 *   .add(HttpApiEndpoint.get("listUsers", "/api/users"))
 *   .add(HttpApiEndpoint.post("createUser", "/api/users", { payload: CreateUser }))
 *
 * // All handlers must be provided - TypeScript will error on missing ones
 * export const handlers: Api.GroupHandlers<typeof group> = {
 *   listUsers: () => UserService.list(),
 *   createUser: ({ payload }) => UserService.create(payload)
 * }
 * ```
 */
export type GroupHandlers<G extends HttpApiGroup.Any> = {
  readonly [K in HttpApiEndpoint.Name<HttpApiGroup.Endpoints<G>>]: Handler<
    HttpApiEndpoint.WithName<HttpApiGroup.Endpoints<G>, K>
  >;
};

/**
 * Extract request type from an endpoint.
 * Includes params, query, payload, and headers as applicable.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Request<E extends HttpApiEndpoint.Any> = Types.Simplify<HttpApiEndpoint.Request<E>>;

/**
 * Extract success type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Success<E extends HttpApiEndpoint.Any> = HttpApiEndpoint.Success<E>["Type"];

/**
 * Extract error type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Error<E extends HttpApiEndpoint.Any> = HttpApiEndpoint.Error<E>["Type"];

/**
 * Extract the path type from an endpoint (the decoded path parameters).
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Path<E extends HttpApiEndpoint.Any> = HttpApiEndpoint.Params<E> extends {
  readonly Type: unknown;
}
  ? HttpApiEndpoint.Params<E>["Type"]
  : never;

/**
 * Extract the URL params type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type UrlParams<E extends HttpApiEndpoint.Any> = HttpApiEndpoint.Query<E> extends {
  readonly Type: unknown;
}
  ? HttpApiEndpoint.Query<E>["Type"]
  : never;

/**
 * Extract the payload type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Payload<E extends HttpApiEndpoint.Any> = HttpApiEndpoint.Payload<E> extends {
  readonly Type: unknown;
}
  ? HttpApiEndpoint.Payload<E>["Type"]
  : never;

/**
 * Extract the headers type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Headers<E extends HttpApiEndpoint.Any> = HttpApiEndpoint.Headers<E> extends {
  readonly Type: unknown;
}
  ? HttpApiEndpoint.Headers<E>["Type"]
  : never;
