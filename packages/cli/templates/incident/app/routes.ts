import { Schema } from "effect";
import { Component } from "trygg";
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
import { IncidentIdFromString } from "./errors/incidents";
import { ApiClientRoot } from "./services/app";
import { AppTheme } from "./services/theme";

const IncidentsIndexRoute = IncidentsIndex.pipe(Component.provide(ApiClientRoot.layer));
const IncidentDetailRoute = IncidentDetail.pipe(Component.provide(ApiClientRoot.layer));
const SettingsRoute = Settings.pipe(Component.provide(AppTheme.fromRoot));

export const routes = Routes.make()
  .add(Route.make("/").component(Home))
  .add(
    Route.make("/incidents")
      .layout(IncidentsLayout)
      .loading(LoadingFallback)
      .children(
        Route.index(IncidentsIndexRoute),
        Route.make("/:id")
          .params(Schema.Struct({ id: IncidentIdFromString }))
          .component(IncidentDetailRoute)
          .loading(IncidentSkeleton)
          .error(RouteErrorView),
      ),
  )
  .add(Route.make("/settings").component(SettingsRoute))
  .notFound(NotFoundView);
