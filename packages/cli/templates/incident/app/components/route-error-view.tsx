import { Cause, Predicate } from "effect";
import { Component } from "trygg";
import * as Router from "trygg/router";

const errorCopy = (error: unknown): { title: string; message: string } => {
  if (Predicate.isTagged(error, "ParamsDecodeError")) {
    return {
      title: "Invalid incident URL",
      message: "Incident id must be numeric, ex /incidents/1.",
    };
  }

  return {
    title: "Could not load page",
    message: "Something failed while resolving this route.",
  };
};

export const RouteErrorView = Component.gen(function* () {
  const { cause } = yield* Router.currentError;
  const error = Cause.squash(cause);
  const { title, message } = errorCopy(error);

  return (
    <section className="route-state" role="alert">
      <p className="route-state__eyebrow">Route error</p>
      <h1 className="route-state__title">{title}</h1>
      <p className="route-state__message">{message}</p>
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
