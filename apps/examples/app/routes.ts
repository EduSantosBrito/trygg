/**
 * Route Definitions
 *
 * All routes for the examples app defined in one file using Route.make().
 */
import { Schema } from "effect";
import { Route, Routes } from "trygg/router";

// Pages
import HomePage from "./pages/home";
import CounterPage from "./pages/counter";
import SuspendPage from "./pages/suspend";
import TodoPage from "./pages/todo";
import ThemePage from "./pages/theme";
import FormPage from "./pages/form";
import ErrorBoundaryPage from "./pages/error-boundary";
import ErrorDemoPage from "./pages/error-demo";
import PortalPage from "./pages/portal";
import DashboardPage from "./pages/dashboard";
import ResourcePage from "./pages/resource";
import LoginPage from "./pages/login";
import ProtectedPage from "./pages/protected";
import UsersListPage from "./pages/users/list";
import UserDetailPage from "./pages/users/detail";
import SettingsLayout from "./pages/settings/layout";
import SettingsOverview from "./pages/settings/overview";
import SettingsProfile from "./pages/settings/profile";
import SettingsSecurity from "./pages/settings/security";

// Boundary components
import { ErrorFallback } from "./components/error-fallback";
import { LoadingFallback } from "./components/loading-fallback";

// Middleware
import { requireAuth } from "./resources/auth";

// =============================================================================
// Route Definitions
// =============================================================================

export const routes = Routes.make()
  .add(Route.make("/").component(HomePage))
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
  .add(Route.make("/portal").component(PortalPage).loading(LoadingFallback))
  .add(Route.make("/dashboard").component(DashboardPage).loading(LoadingFallback))
  .add(Route.make("/resource").component(ResourcePage).loading(LoadingFallback))
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
