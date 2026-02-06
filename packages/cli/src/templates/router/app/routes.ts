import { Routes, Route } from "trygg/router";
import Home from "./pages/home";
import AboutPage from "./pages/about";
import ResourcePage from "./pages/resource";
import IncidentsLayout from "./pages/incidents-layout";
import IncidentsPage from "./pages/incidents";
import { LoadingFallback } from "./components/loading-fallback";

export const routes = Routes.make()
  .add(Route.make("/").component(Home))
  .add(Route.make("/about").component(AboutPage).loading(LoadingFallback))
  .add(Route.make("/resource").component(ResourcePage).loading(LoadingFallback))
  .add(
    Route.make("/incidents")
      .layout(IncidentsLayout)
      .children(Route.index(IncidentsPage))
      .loading(LoadingFallback),
  );
