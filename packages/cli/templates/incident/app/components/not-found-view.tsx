import { Component } from "trygg";
import * as Router from "trygg/router";

export const NotFoundView = Component.gen(function* () {
  const route = yield* Router.currentRoute;

  return (
    <>
      <header className="content-header">
        <div className="content-header__left">
          <div className="content-header__title">
            <h1 className="content-header__text">Page Not Found</h1>
          </div>
        </div>
      </header>
      <main className="content-body">
        <section className="route-state" role="status" aria-live="polite">
          <p className="route-state__eyebrow">404</p>
          <h2 className="route-state__title">Page not found</h2>
          <p className="route-state__message">
            No route matches <code className="route-state__path">{route.path}</code>.
          </p>
          <div className="route-state__actions">
            <Router.Link to="/incidents" className="btn btn--primary">
              Open Incidents
            </Router.Link>
            <Router.Link to="/" className="btn btn--secondary">
              Go Home
            </Router.Link>
          </div>
        </section>
      </main>
    </>
  );
});
