import { Schema } from "effect";
import { Routes, Route } from "trygg/router";
import Home from "./pages/home";
import IncidentsLayout from "./pages/incidents-layout";
import IncidentsIndex from "./pages/incidents";
import IncidentDetail from "./pages/incident-detail";
import Settings from "./pages/settings";
import { LoadingFallback } from "./components/loading-fallback";
import { IncidentSkeleton } from "./components/incident-skeleton";
import { NotFoundView } from "./components/not-found-view";
import { RouteErrorView } from "./components/route-error-view";

export const routes = Routes.make()
  .add(Route.make("/").component(Home))
  .add(
    Route.make("/incidents")
      .layout(IncidentsLayout)
      .loading(LoadingFallback)
      .children(
        Route.index(IncidentsIndex),
        Route.make("/:id")
          .params(Schema.Struct({ id: Schema.NumberFromString }))
          .component(IncidentDetail)
          .loading(IncidentSkeleton)
          .error(RouteErrorView),
      ),
  )
  .add(Route.make("/settings").component(Settings))
  .notFound(NotFoundView);
