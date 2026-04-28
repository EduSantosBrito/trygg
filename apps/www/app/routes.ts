/**
 * Route Definitions — trygg.dev
 */
import { Schema } from "effect";
import { Route, Routes } from "trygg/router";

import HomePage from "./pages/home";
import ChangelogDetailPage from "./pages/changelog-detail";
import NotFoundPage from "./pages/not-found";

export const routes = Routes.make()
  .add(Route.make("/").component(HomePage))
  .add(
    Route.make("/changelog/:name")
      .params(Schema.Struct({ name: Schema.String }))
      .component(ChangelogDetailPage),
  )
  .notFound(NotFoundPage);
