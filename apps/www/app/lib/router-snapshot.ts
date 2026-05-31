import * as Router from "trygg/router";

// `Router.currentRoute` is the public one-step helper (Router service access +
// Signal.get) for code that only needs the latest Route snapshot. It replaced the
// old `router.current._ref` SubscriptionRef access removed in the trace flight
// recorder change, where `router.current` became a `Signal<Route>`.
export const currentRouteSnapshot = Router.currentRoute;
