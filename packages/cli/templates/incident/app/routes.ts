import { Schema } from "effect";
import { Routes, Route } from "trygg/router";
import Home from "./pages/home";
import AboutPage from "./pages/about";
import ResourcePage from "./pages/resource";
import IncidentsPage from "./pages/incidents";
import IncidentDetailPage from "./pages/incident-detail";
import SettingsPage from "./pages/settings";
import { LoadingFallback } from "./components/loading-fallback";
import { IncidentSkeleton } from "./components/incident-skeleton";

export const routes = Routes.make()
  .add(Route.make("/").component(Home))
  .add(Route.make("/about").component(AboutPage).loading(LoadingFallback))
  .add(Route.make("/resource").component(ResourcePage).loading(LoadingFallback))
  .add(Route.make("/settings").component(SettingsPage).loading(LoadingFallback))
  .add(
    Route.make("/incidents")
      .children(
        Route.index(IncidentsPage),
        Route.make("/:id")
          .params(Schema.Struct({ id: Schema.NumberFromString }))
          .component(IncidentDetailPage)
          .loading(IncidentSkeleton),
      )
      .loading(LoadingFallback),
  );
