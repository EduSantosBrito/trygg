/**
 * Route Definitions — trygg.dev
 */
import { Schema } from "effect";
import { Route, Routes } from "trygg/router";

import { DocsLayout } from "./components/docs-layout";
import DocsGettingStartedPage from "./pages/docs/getting-started";
import DocsIndexPage from "./pages/docs/page";
import DocsTopicPage from "./pages/docs/topic";
import NotFoundPage from "./pages/not-found";

const HomePage = () => import("./pages/home");
const ChangelogPage = () => import("./pages/changelog");
const ChangelogDetailPage = () => import("./pages/changelog-detail");

export const routes = Routes.make()
  .add(Route.make("/").component(HomePage))
  .add(Route.make("/docs").component(DocsIndexPage))
  .add(
    Route.make("/docs")
      .layout(DocsLayout)
      .children(
        Route.make("/getting-started").component(DocsGettingStartedPage),
        Route.make("/:slug+")
          .params(Schema.Struct({ slug: Schema.String }))
          .component(DocsTopicPage),
      ),
  )
  .add(Route.make("/changelog").component(ChangelogPage))
  .add(
    Route.make("/changelog/:name")
      .params(Schema.Struct({ name: Schema.String }))
      .component(ChangelogDetailPage),
  )
  .notFound(NotFoundPage);
