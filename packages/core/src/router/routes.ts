/**
 * Routes collection primitives for `trygg/router`.
 *
 * @remarks
 * Owner module for the root route-manifest builder. This module owns the
 * collection surface behind `Routes.make()` and the manifest shape consumed by
 * `Outlet`.
 *
 * @example
 * ```tsx
 * import { Routes, Route } from "trygg/router"
 *
 * export const routes = Routes.make()
 *   .add(Route.make("/").component(HomePage))
 *   .add(Route.make("/users").component(UsersList))
 *   .notFound(NotFoundPage)
 *   .error(ErrorPage)  // Root error boundary
 * ```
 * @since 1.0.0
 * @module trygg/router/routes
 */
import { Data, Option } from "effect";
import * as Context from "effect/Context";
import type { RouteComponent, ComponentInput } from "./types.js";
import type { RouteBuilder, RouteDefinition } from "./route.js";

// =============================================================================
// Routes Manifest (Internal)
// =============================================================================

/**
 * Internal manifest produced by the Routes collection.
 * Used by the Outlet to render matched routes.
 *
 * @remarks
 * `RoutesManifest` is the normalized tree read by route matching and outlet
 * rendering after the collection is finalized.
 *
 * @internal
 * @since 1.0.0
 */
export interface RoutesManifest {
  readonly routes: ReadonlyArray<RouteDefinition>;
  readonly notFound: ComponentInput | undefined;
  readonly forbidden: ComponentInput | undefined;
  readonly error: ComponentInput | undefined;
}

// =============================================================================
// Routes Collection Type
// =============================================================================

/**
 * Routes collection that accumulates route definitions.
 * `.add()` enforces R = never at type level.
 *
 * @remarks
 * `RoutesCollection` is the fluent root builder used to gather top-level routes
 * and root-level boundaries before passing `.manifest` to `Outlet`.
 *
 * @example
 * ```tsx
 * const routes = Routes.make()
 *   .add(Route.make("/").component(HomePage))
 *   .error(AppError)
 * ```
 *
 * @category Route Collections
 * @public
 * @since 1.0.0
 */
export interface RoutesCollection {
  readonly _tag: "RoutesCollection";

  /**
   * Add a route to the collection.
   * Route must have R = never (all service requirements satisfied).
   */
  readonly add: <
    Path extends string,
    HasComponent extends boolean,
    HasChildren extends boolean,
    NeedsCoverage extends boolean,
    HasErrorBoundary extends boolean,
  >(
    route: RouteBuilder<Path, never, HasComponent, HasChildren, NeedsCoverage, HasErrorBoundary>,
  ) => RoutesCollection;

  /**
   * Set root 404 handler.
   */
  readonly notFound: (component: RouteComponent) => RoutesCollection;

  /**
   * Set root 403 handler.
   */
  readonly forbidden: (component: RouteComponent) => RoutesCollection;

  /**
   * Set root error boundary.
   */
  readonly error: (component: RouteComponent) => RoutesCollection;

  /**
   * Get the internal manifest for Outlet consumption.
   * Used by Outlet to render matched routes.
   */
  readonly manifest: RoutesManifest;
}

// =============================================================================
// Implementation
// =============================================================================

const RoutesCollectionData = Data.TaggedClass("RoutesCollection");

/** @internal */
const makeCollection = (manifest: RoutesManifest): RoutesCollection =>
  new RoutesCollectionData({
    add: (route) =>
      makeCollection({
        ...manifest,
        routes: [...manifest.routes, route.definition],
      }),

    notFound: (component) =>
      makeCollection({
        ...manifest,
        notFound: component,
      }),

    forbidden: (component) =>
      makeCollection({
        ...manifest,
        forbidden: component,
      }),

    error: (component) =>
      makeCollection({
        ...manifest,
        error: component,
      }),

    manifest,
  });

// =============================================================================
// Public API
// =============================================================================

/**
 * Create an empty routes collection.
 *
 * @remarks
 * Start with `make` once all route definitions already have their required
 * services provided and are ready to join the root manifest.
 *
 * @example
 * ```tsx
 * const routes = Routes.make()
 *   .add(homeRoute)
 *   .add(usersRoute)
 *   .notFound(NotFoundPage)
 * ```
 *
 * @category Route Collections
 * @public
 * @since 1.0.0
 */
export const make = (): RoutesCollection =>
  makeCollection({
    routes: [],
    notFound: undefined,
    forbidden: undefined,
    error: undefined,
  });

// =============================================================================
// RoutesManifest FiberRef — Implicit manifest for Outlet
// =============================================================================

/**
 * FiberRef holding the app's RoutesManifest.
 * Set by the generated entry module — read by `<Router.Outlet />` when
 * no explicit `routes` prop is provided.
 *
 * This enables `<Router.Outlet />` without props.
 *
 * @remarks
 * Router internals use this FiberRef to thread the generated app manifest to
 * nested outlets without requiring every render site to pass props manually.
 *
 * @internal
 * @since 1.0.0
 */
export const CurrentRoutesManifest = Context.Reference<Option.Option<RoutesManifest>>(
  "trygg/Router/CurrentRoutesManifest",
  {
    defaultValue: Option.none,
  },
);
