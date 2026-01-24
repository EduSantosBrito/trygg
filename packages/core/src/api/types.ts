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
 * import { HttpApiEndpoint } from "@effect/platform"
 * import type { Api } from "trygg"
 *
 * export const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id")
 *   .setPath(Schema.Struct({ id: Schema.String }))
 *   .addSuccess(UserSchema)
 *
 * export const handler: Api.Handler<typeof endpoint> = ({ path }) =>
 *   UserService.findById(path.id)
 * ```
 *
 * @example
 * ```typescript
 * // Multiple endpoints (group.ts)
 * import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
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
import type { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
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
 * export const endpoint = HttpApiEndpoint.get("getUser", "/api/users/:id")
 *   .setPath(Schema.Struct({ id: Schema.String }))
 *   .addSuccess(UserSchema)
 *   .addError(NotFoundError)
 *
 * // Type annotation ensures handler matches endpoint signature
 * export const handler: Api.Handler<typeof endpoint> = ({ path }) =>
 *   UserService.findById(path.id)
 * ```
 */
export type Handler<E extends HttpApiEndpoint.HttpApiEndpoint.Any> = (
  request: Types.Simplify<HttpApiEndpoint.HttpApiEndpoint.Request<E>>,
) => Effect.Effect<
  HttpApiEndpoint.HttpApiEndpoint.Success<E>,
  HttpApiEndpoint.HttpApiEndpoint.Error<E>,
  // R is inferred from implementation - allows any dependencies
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 *   .add(HttpApiEndpoint.post("createUser", "/api/users").setPayload(CreateUser))
 *
 * // All handlers must be provided - TypeScript will error on missing ones
 * export const handlers: Api.GroupHandlers<typeof group> = {
 *   listUsers: () => UserService.list(),
 *   createUser: ({ payload }) => UserService.create(payload)
 * }
 * ```
 */
export type GroupHandlers<G extends HttpApiGroup.HttpApiGroup.Any> = {
  readonly [K in HttpApiEndpoint.HttpApiEndpoint.Name<
    HttpApiGroup.HttpApiGroup.Endpoints<G>
  >]: Handler<HttpApiEndpoint.HttpApiEndpoint.WithName<HttpApiGroup.HttpApiGroup.Endpoints<G>, K>>;
};

/**
 * Extract request type from an endpoint.
 * Includes path params, urlParams, payload, and headers as applicable.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Request<E extends HttpApiEndpoint.HttpApiEndpoint.Any> = Types.Simplify<
  HttpApiEndpoint.HttpApiEndpoint.Request<E>
>;

/**
 * Extract success type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Success<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  HttpApiEndpoint.HttpApiEndpoint.Success<E>;

/**
 * Extract error type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Error<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  HttpApiEndpoint.HttpApiEndpoint.Error<E>;

/**
 * Extract the path type from an endpoint (the decoded path parameters).
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Path<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  HttpApiEndpoint.HttpApiEndpoint.PathParsed<E>;

/**
 * Extract the URL params type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type UrlParams<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  HttpApiEndpoint.HttpApiEndpoint.UrlParams<E>;

/**
 * Extract the payload type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Payload<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  HttpApiEndpoint.HttpApiEndpoint.Payload<E>;

/**
 * Extract the headers type from an endpoint.
 *
 * @since 1.0.0
 * @category type utilities
 */
export type Headers<E extends HttpApiEndpoint.HttpApiEndpoint.Any> =
  HttpApiEndpoint.HttpApiEndpoint.Headers<E>;
