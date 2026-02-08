import { Cause, Predicate } from "effect";
import { Component } from "trygg";
import * as Router from "trygg/router";

const errorCopy = (error: unknown): { title: string; message: string } => {
  if (Predicate.isTagged(error, "ParamsDecodeError")) {
    return {
      title: "Invalid Incident URL",
      message: "Incident ID must be numeric, e.g. /incidents/1.",
    };
  }

  return {
    title: "Could Not Load Page",
    message: "Something failed while resolving this route.",
  };
};

export const RouteErrorView = Component.gen(function* () {
  const { cause } = yield* Router.currentError;
  const error = Cause.squash(cause);
  const { title, message } = errorCopy(error);

  return (
    <>
      <header className="content-header">
        <div className="content-header__left">
          <div className="content-header__title">
            <h1 className="content-header__text">Error</h1>
          </div>
        </div>
      </header>
      <main className="content-body">
        <section className="route-state" role="alert">
          <p className="route-state__eyebrow">Route Error</p>
          <h2 className="route-state__title">{title}</h2>
          <p className="route-state__message">{message}</p>
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
