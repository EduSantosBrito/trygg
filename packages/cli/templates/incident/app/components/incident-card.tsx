import { Effect } from "effect";
import { Component, Element, Resource, Signal, type ComponentProps } from "trygg";
import * as Router from "trygg/router";
import { ApiClient, type Incident } from "../api";
import { incidentResource, incidentsResource } from "../resources/incidents";
import { TRANSITIONS } from "../services/incidents";
import { StatusBadge } from "./status-badge";
import { SeverityBadge } from "./severity-badge";
import { TimelineEntry } from "./timeline-entry";
import { formatRelative } from "../utils/date";

interface IncidentCardProps {
  readonly incident: Incident;
  readonly expandedIds: Signal.Signal<ReadonlySet<number>>;
  readonly onToggle: () => Effect.Effect<void>;
}

export const IncidentCard = Component.gen(function* (
  Props: ComponentProps<IncidentCardProps>,
) {
  const { incident, expandedIds, onToggle } = yield* Props;

  // Derive per-item expanded signal for fine-grained reactivity.
  // Only DOM nodes depending on this signal update when expansion changes.
  const expanded = yield* Signal.derive(expandedIds, (set) => set.has(incident.id));
  const ariaExpanded = yield* Signal.derive(expanded, (v) => (v ? "true" : "false"));
  const chevron = yield* Signal.derive(expanded, (v) => (v ? "\u25B2" : "\u25BC"));

  const validTransitions = TRANSITIONS[incident.status];
  const [nextTransition] = validTransitions;
  const hasNext = nextTransition !== undefined;

  // Conditional body via Signal<Element> for fine-grained DOM updates.
  // When expanded changes, only the body swaps — no component re-render.
  const body = yield* Signal.derive(expanded, (isExpanded): Element =>
    isExpanded ? (
      <div className="incident-card__body">
        <div className="incident-card__timeline">
          <h4 className="incident-card__section-title">Timeline</h4>
          {incident.timeline.map((entry, index) => (
            <div key={`${entry.timestamp}-${String(index)}`}>
              <TimelineEntry entry={entry} />
            </div>
          ))}
        </div>

        {hasNext && (
          <div className="incident-card__actions">
            <button
              className="incident-card__advance-btn"
              onClick={() =>
                Effect.gen(function* () {
                  const client = yield* ApiClient;
                  yield* client.incidents.transition({
                    path: { id: incident.id },
                    payload: { to: nextTransition },
                  });
                  yield* Resource.invalidate(incidentResource({ id: incident.id }));
                  yield* Resource.invalidate(incidentsResource);
                }).pipe(
                  Effect.catchAll((error) => Effect.logError("Transition failed", error)),
                )
              }
            >
              Advance to {nextTransition}
            </button>
          </div>
        )}
      </div>
    ) : (
      <></>
    ),
  );

  return (
    <article className="incident-card">
      <div className="incident-card__header">
        <button
          className="incident-card__toggle"
          onClick={onToggle}
          aria-expanded={ariaExpanded}
        >
          <div className="incident-card__title-row">
            <h3 className="incident-card__title">{incident.title}</h3>
            <div className="incident-card__badges">
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
            </div>
          </div>
          <div className="incident-card__meta">
            <time className="incident-card__time">{formatRelative(incident.createdAt)}</time>
            <span className="incident-card__chevron" aria-hidden="true">
              {chevron}
            </span>
          </div>
        </button>
        <Router.Link
          to="/incidents/:id"
          params={{ id: String(incident.id) }}
          className="incident-card__detail-link"
        >
          View details
        </Router.Link>
      </div>

      {body}
    </article>
  );
});
