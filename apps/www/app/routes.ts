/**
 * Route Definitions — trygg.dev
 */
import { Schema } from "effect";
import { Route, Routes } from "trygg/router";

import NotFoundPage from "./pages/not-found";

const HomePage = () => import("./pages/home");
const ChangelogPage = () => import("./pages/changelog");
const ChangelogDetailPage = () => import("./pages/changelog-detail");

export const routes = Routes.make()
  .add(Route.make("/").component(HomePage))
  .add(Route.make("/changelog").component(ChangelogPage))
  .add(
    Route.make("/changelog/:name")
      .params(Schema.Struct({ name: Schema.String }))
      .component(ChangelogDetailPage),
  )
  .notFound(NotFoundPage);
