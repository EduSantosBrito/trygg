import { Component } from "trygg";
import * as Router from "trygg/router";

export const NotFoundView = Component.gen(function* () {
  const route = yield* Router.currentRoute;

  return (
    <section className="route-state" role="status" aria-live="polite">
      <p className="route-state__eyebrow">404</p>
      <h1 className="route-state__title">Page not found</h1>
      <p className="route-state__message">
        No route matches <code className="route-state__path">{route.path}</code>.
      </p>
      <div className="route-state__actions">
        <Router.Link to="/incidents" className="route-state__action route-state__action--primary">
          Open incidents
        </Router.Link>
        <Router.Link to="/" className="route-state__action">
          Go home
        </Router.Link>
      </div>
    </section>
  );
});
