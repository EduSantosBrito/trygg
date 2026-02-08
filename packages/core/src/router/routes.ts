/**
 * @since 1.0.0
 * Routes Collection
 *
 * Collects route definitions and enforces R = never (all requirements satisfied).
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
 */
import { FiberRef, Option } from "effect";
import type { RouteComponent, ComponentInput } from "./types.js";
import type { RouteBuilder, RouteDefinition } from "./route.js";

// =============================================================================
// Routes Manifest (Internal)
// =============================================================================

/**
 * Internal manifest produced by the Routes collection.
 * Used by the Outlet to render matched routes.
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

/** @internal */
const makeCollection = (manifest: RoutesManifest): RoutesCollection => ({
  _tag: "RoutesCollection",

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
 * @example
 * ```tsx
 * const routes = Routes.make()
 *   .add(homeRoute)
 *   .add(usersRoute)
 *   .notFound(NotFoundPage)
 * ```
 *
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
 * @since 1.0.0
 */
export const CurrentRoutesManifest: FiberRef.FiberRef<Option.Option<RoutesManifest>> =
  FiberRef.unsafeMake<Option.Option<RoutesManifest>>(Option.none());
