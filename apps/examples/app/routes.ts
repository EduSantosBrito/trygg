/**
 * Route Definitions
 *
 * All routes for the examples app defined in one file using Route.make().
 */
import { Schema } from "effect";
import { Route, Routes } from "trygg/router";

// Boundary components
import { ErrorFallback } from "./components/error-fallback";
import { LoadingFallback } from "./components/loading-fallback";

// Middleware
import { requireAuth } from "./resources/auth";

const HomePage = () => import("./pages/home");
const CounterPage = () => import("./pages/counter");
const SuspendPage = () => import("./pages/suspend");
const TodoPage = () => import("./pages/todo");
const ThemePage = () => import("./pages/theme");
const FormPage = () => import("./pages/form");
const ErrorBoundaryPage = () => import("./pages/error-boundary");
const ErrorDemoPage = () => import("./pages/error-demo");
const PortalPage = () => import("./pages/portal");
const NestedProvidePage = () => import("./pages/nested-provide");
const DashboardPage = () => import("./pages/dashboard");
const ResourcePage = () => import("./pages/resource");
const PrefetchPage = () => import("./pages/prefetch");
const LoginPage = () => import("./pages/login");
const ProtectedPage = () => import("./pages/protected");
const UsersListPage = () => import("./pages/users/list");
const UserDetailPage = () => import("./pages/users/detail");
const SettingsLayout = () => import("./pages/settings/layout");
const SettingsOverview = () => import("./pages/settings/overview");
const SettingsProfile = () => import("./pages/settings/profile");
const SettingsSecurity = () => import("./pages/settings/security");

// =============================================================================
// Route Definitions
// =============================================================================

export const routes = Routes.make()
  .add(Route.make("/").component(HomePage).loading(LoadingFallback))
  .add(Route.make("/counter").component(CounterPage).loading(LoadingFallback))
  .add(Route.make("/suspend").component(SuspendPage).loading(LoadingFallback))
  .add(Route.make("/todo").component(TodoPage).loading(LoadingFallback))
  .add(Route.make("/theme").component(ThemePage).loading(LoadingFallback))
  .add(Route.make("/form").component(FormPage).loading(LoadingFallback))
  .add(Route.make("/error-boundary").component(ErrorBoundaryPage).loading(LoadingFallback))
  .add(
    Route.make("/error-demo")
      .component(ErrorDemoPage)
      .loading(LoadingFallback)
      .error(ErrorFallback),
  )
  .add(Route.make("/nested-provide").component(NestedProvidePage).loading(LoadingFallback))
  .add(Route.make("/portal").component(PortalPage).loading(LoadingFallback))
  .add(Route.make("/dashboard").component(DashboardPage).loading(LoadingFallback))
  .add(Route.make("/resource").component(ResourcePage).loading(LoadingFallback))
  .add(Route.make("/prefetch").component(PrefetchPage).loading(LoadingFallback))
  .add(Route.make("/login").component(LoginPage).loading(LoadingFallback))
  .add(
    Route.make("/protected")
      .middleware(requireAuth)
      .component(ProtectedPage)
      .loading(LoadingFallback),
  )
  .add(Route.make("/users").component(UsersListPage).loading(LoadingFallback))
  .add(
    Route.make("/users/:id")
      .params(Schema.Struct({ id: Schema.String }))
      .component(UserDetailPage)
      .loading(LoadingFallback),
  )
  .add(
    Route.make("/settings")
      .layout(SettingsLayout)
      .children(
        Route.index(SettingsOverview),
        Route.make("/profile").component(SettingsProfile),
        Route.make("/security").component(SettingsSecurity),
      )
      .loading(LoadingFallback),
  )
  .notFound(ErrorFallback);
