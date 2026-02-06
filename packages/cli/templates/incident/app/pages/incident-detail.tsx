import { Effect } from "effect";
import { Component, Resource, Signal, type ComponentProps } from "trygg";
import * as Router from "trygg/router";
import { incidentResource, incidentsResource, type Incident } from "../resources/incidents";
import { IncidentNotFound } from "../errors/incidents";
import { ApiClient } from "../api";
import { TRANSITIONS } from "../services/incidents";
import { StatusBadge } from "../components/status-badge";
import { SeverityBadge } from "../components/severity-badge";
import { TimelineEntry } from "../components/timeline-entry";
import { IncidentSkeleton } from "../components/incident-skeleton";
import { ErrorView } from "../components/error-view";
import { formatRelative } from "../utils/date";

export default Component.gen(function* () {
  // Route schema validates via NumberFromString, but Router.params()
  // returns strings (toRouteParams stringifies decoded values).
  const { id } = yield* Router.params("/incidents/:id");
  const numericId = Number(id);
  const state = yield* Resource.fetch(incidentResource({ id: numericId }));

  return yield* Resource.match(state, {
    Pending: () => (
      <div className="incident-detail">
        <IncidentSkeleton />
      </div>
    ),

    Success: (incident, stale) => (
      <div className={`incident-detail${stale ? " opacity-60" : ""}`}>
        <nav className="incident-detail__breadcrumb" aria-label="Breadcrumb">
          <Router.Link to="/incidents" className="incident-detail__back">
            Incidents
          </Router.Link>
          <span className="incident-detail__breadcrumb-sep" aria-hidden="true">/</span>
          <span className="incident-detail__breadcrumb-current" aria-current="page">{incident.title}</span>
        </nav>

        <header className="incident-detail__header">
          <div>
            <h1 className="incident-detail__title">{incident.title}</h1>
            <time className="incident-detail__created">
              Created {formatRelative(incident.createdAt)}
            </time>
          </div>
          <div className="incident-detail__badges">
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
          </div>
        </header>

        <section className="incident-detail__timeline">
          <h2 className="incident-detail__section-title">Timeline</h2>
          <div className="incident-detail__timeline-list">
            {incident.timeline.map((entry, index) => (
              <div key={`${entry.timestamp}-${String(index)}`}>
                <TimelineEntry entry={entry} />
              </div>
            ))}
          </div>
        </section>

        <DetailActions incident={incident} />
      </div>
    ),

    Failure: (error) => {
      const retry =
        error instanceof IncidentNotFound
          ? undefined
          : Resource.refresh(incidentResource({ id: numericId }));

      return (
        <div className="incident-detail">
          <nav className="incident-detail__breadcrumb" aria-label="Breadcrumb">
            <Router.Link to="/incidents" className="incident-detail__back">
              Incidents
            </Router.Link>
          </nav>
          {retry === undefined ? (
            <ErrorView error={error} />
          ) : (
            <ErrorView error={error} onRetry={retry} />
          )}
        </div>
      );
    },
  });
});

const DetailActions = Component.gen(function* (
  Props: ComponentProps<{ incident: Incident }>,
) {
  const { incident } = yield* Props;
  const validTransitions = TRANSITIONS[incident.status];
  if (validTransitions.length === 0) return <></>;

  const [nextStatus] = validTransitions;
  if (nextStatus === undefined) return <></>;

  const transitioning = yield* Signal.make(false);
  const buttonText = yield* Signal.derive(transitioning, (isTransitioning) =>
    isTransitioning ? "Advancing..." : `Advance to ${nextStatus}`,
  );

  return (
    <section className="incident-detail__actions">
      <button
        className="incident-detail__advance-btn"
        disabled={transitioning}
        onClick={() =>
          Effect.gen(function* () {
            yield* Signal.set(transitioning, true);
            const client = yield* ApiClient;
            yield* client.incidents.transition({
              path: { id: incident.id },
              payload: { to: nextStatus },
            });
            yield* Resource.invalidate(incidentResource({ id: incident.id }));
            yield* Resource.invalidate(incidentsResource);
          }).pipe(
            Effect.catchAll((error) => Effect.logError("Transition failed", error)),
            Effect.ensuring(Signal.set(transitioning, false)),
          )
        }
      >
        {buttonText}
      </button>
    </section>
  );
});
