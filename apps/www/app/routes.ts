/**
 * Route Definitions — trygg.dev
 */
import { Route, Routes } from "trygg/router";

import HomePage from "./pages/home";
import NotFoundPage from "./pages/not-found";

export const routes = Routes.make()
  .add(Route.make("/").component(HomePage))
  .notFound(NotFoundPage);
