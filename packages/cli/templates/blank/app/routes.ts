import { Route, Routes } from "trygg/router";
import Home from "./pages/home";

export const routes = Routes.make().add(Route.make("/").component(Home));
