import { Effect } from "effect";
import { Component, Resource, Signal, type ComponentProps } from "trygg";
import * as Router from "trygg/router";
import { incidentResource, incidentsResource, type Incident } from "../resources/incidents";
import { IncidentNotFound, type Status } from "../errors/incidents";
import { ApiClient } from "../api";
import { TRANSITIONS } from "../services/incidents";
import { StatusBadge } from "../components/status-badge";
import { SeverityBadge } from "../components/severity-badge";
import { IncidentSkeleton } from "../components/incident-skeleton";
import { ErrorView } from "../components/error-view";
import { formatRelative } from "../utils/date";

const STATUS_JOURNEY: ReadonlyArray<Status> = [
  "Investigating",
  "Identified",
  "Monitoring",
  "Resolved",
];

export default Component.gen(function* () {
  const { id } = yield* Router.params("/incidents/:id");
  const numericId = Number(id);
  const state = yield* Resource.fetch(incidentResource({ id: numericId }));

  return yield* Resource.match(state, {
    Pending: () => (
      <>
        <header className="content-header">
          <div className="content-header__left">
            <div className="content-header__title">
              <div className="content-header__icon" aria-hidden="true" />
              <h1 className="content-header__text">Loading…</h1>
            </div>
          </div>
        </header>
        <main className="content-body">
          <IncidentSkeleton />
        </main>
      </>
    ),

    Success: (incident, stale) => (
      <>
        <header className="content-header">
          <div className="content-header__left">
            <div className="content-header__title">
              <div className="content-header__icon" aria-hidden="true" />
              <h1 className="content-header__text">INC-{incident.id} {incident.title}</h1>
            </div>
          </div>

        </header>

        <main className={`content-body${stale ? " opacity-60" : ""}`}>
          <div className="incident-detail">
            {/* Main content */}
            <div className="incident-detail__main">
              {/* Breadcrumb */}
              <nav className="incident-detail__breadcrumb" aria-label="Breadcrumb">
                <Router.Link to="/incidents" className="incident-detail__breadcrumb-link">
                  Incidents
                </Router.Link>
                <span className="incident-detail__breadcrumb-sep" aria-hidden="true">&gt;</span>
                <span aria-current="page">INC-{incident.id}</span>
              </nav>

              {/* Status journey */}
              <div className="status-journey">
                {STATUS_JOURNEY.map((status, index) => {
                  const isActive = incident.status === status;
                  const isPast = STATUS_JOURNEY.indexOf(incident.status) > index;
                  const className = isActive
                    ? "status-journey__step status-journey__step--active"
                    : isPast
                      ? "status-journey__step status-journey__step--completed"
                      : "status-journey__step";

                  return (
                    <span key={status} className={className}>
                      {isActive && <span className="badge__dot" />}
                      {status}
                    </span>
                  );
                })}
              </div>

              {/* Summary card */}
              <div className="summary-card">
                <em>"{incident.title}"</em> — reported {formatRelative(incident.createdAt)}.
              </div>

              {/* Section header */}
              <h2
                className="text-sm font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-3)", marginTop: "24px", marginBottom: "16px", letterSpacing: "0.05em" }}
              >
                Updates
              </h2>

              {/* Timeline entries as updates */}
              <div className="timeline">
                {incident.timeline.slice().reverse().map((entry, index) => (
                  <div key={`${entry.timestamp}-${String(index)}`} className="timeline-entry">
                    <div className="timeline-entry__avatar">U</div>
                    <div className="timeline-entry__content">
                      <div className="timeline-entry__header">
                        <span className="timeline-entry__author">System</span>
                        <span className="timeline-entry__time">{formatRelative(entry.timestamp)}</span>
                      </div>
                      <div className="timeline-entry__body">
                        <p className="timeline-entry__message">{entry.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Advance action */}
              <DetailActions incident={incident} />
            </div>

            {/* Sidebar */}
            <aside className="incident-detail__sidebar">
              <div className="card" style={{ padding: "16px" }}>
                <div className="sidebar-section">
                  <h3 className="sidebar-section__title">Status</h3>
                  <StatusBadge status={incident.status} />
                </div>

                <div className="sidebar-section">
                  <h3 className="sidebar-section__title">Severity</h3>
                  <SeverityBadge severity={incident.severity} />
                </div>

                <div className="sidebar-section">
                  <h3 className="sidebar-section__title">Incident Lead</h3>
                  <div className="sidebar-section__item">
                    <span className="sidebar-section__value">Not assigned</span>
                  </div>
                </div>

                <div className="sidebar-section">
                  <h3 className="sidebar-section__title">Timestamps</h3>
                  <div className="sidebar-section__item">
                    <span className="sidebar-section__label">Declared at</span>
                    <span className="sidebar-section__value">
                      {new Intl.DateTimeFormat("en-US", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(incident.createdAt))}
                    </span>
                  </div>
                </div>

                <div className="sidebar-section">
                  <h3 className="sidebar-section__title">Duration</h3>
                  <div className="sidebar-section__item">
                    <span className="sidebar-section__value">
                      {incident.status === "Resolved" ? "Resolved" : "Ongoing"}
                    </span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </main>
      </>
    ),

    Failure: (error) => {
      const retry =
        error instanceof IncidentNotFound
          ? undefined
          : Resource.refresh(incidentResource({ id: numericId }));

      return (
        <>
          <header className="content-header">
            <div className="content-header__left">
              <div className="content-header__title">
                <div className="content-header__icon" aria-hidden="true" />
                <h1 className="content-header__text">Incident</h1>
              </div>
            </div>
          </header>
          <main className="content-body">
            <nav className="incident-detail__breadcrumb" aria-label="Breadcrumb">
              <Router.Link to="/incidents" className="incident-detail__breadcrumb-link">
                Incidents
              </Router.Link>
            </nav>
            {retry === undefined ? (
              <ErrorView error={error} />
            ) : (
              <ErrorView error={error} onRetry={retry} />
            )}
          </main>
        </>
      );
    },
  });
});

// ---------------------------------------------------------------------------
// Detail actions component
// ---------------------------------------------------------------------------

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
    isTransitioning ? "Advancing…" : `Advance to ${nextStatus}`,
  );

  return (
    <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
      <button
        type="button"
        className="btn btn--primary"
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
    </div>
  );
});
