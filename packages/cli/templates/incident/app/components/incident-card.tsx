import { Data, Effect } from "effect";
import { Component, Element, Resource, Signal, type ComponentProps } from "trygg";
import * as Router from "trygg/router";
import { ApiClient, type Incident } from "../api";
import { IncidentNotFound, InvalidTransition } from "../errors/incidents";
import { incidentResource, incidentsResource } from "../resources/incidents";
import { TRANSITIONS } from "../services/incidents";
import { StatusBadge } from "./status-badge";
import { SeverityBadge } from "./severity-badge";
import { TimelineEntry } from "./timeline-entry";
import { formatRelative } from "../utils/date";

class UnexpectedTransitionError extends Data.TaggedError("UnexpectedTransitionError")<{
  readonly cause: unknown;
}> {}

const toTransitionError = (
  error: unknown,
): InvalidTransition | IncidentNotFound | UnexpectedTransitionError => {
  if (error instanceof InvalidTransition || error instanceof IncidentNotFound) {
    return error;
  }
  return new UnexpectedTransitionError({ cause: error });
};

interface IncidentCardProps {
  readonly incident: Incident;
  readonly expandedIds: Signal.Signal<ReadonlySet<number>>;
  readonly onToggle: () => Effect.Effect<void>;
}

export const IncidentCard = Component.gen(function* (
  Props: ComponentProps<IncidentCardProps>,
) {
  const { incident, expandedIds, onToggle } = yield* Props;
  const validTransitions = TRANSITIONS[incident.status];
  const [nextTransition] = validTransitions;
  const hasNext = nextTransition !== undefined;
  const nextTransitionLabel = nextTransition === undefined ? "Advance" : `Advance to ${nextTransition}`;

  const transitionError = yield* Signal.make<
    InvalidTransition | IncidentNotFound | UnexpectedTransitionError | null
  >(null);
  const transitioning = yield* Signal.make(false);
  const advanceLabel = yield* Signal.derive(transitioning, (isTransitioning) =>
    isTransitioning ? "Advancing..." : nextTransitionLabel,
  );
  const nextError = yield* Signal.get(transitionError);
  if (nextError instanceof UnexpectedTransitionError) {
    return yield* nextError;
  }

  const refreshIncident = () =>
    Effect.gen(function* () {
      yield* Resource.invalidate(incidentResource({ id: incident.id }));
      yield* Resource.invalidate(incidentsResource);
      yield* Signal.set(transitionError, null);
    });

  const transitionAlert = yield* Signal.derive(transitionError, (error): Element => {
    if (error === null || error instanceof UnexpectedTransitionError) {
      return <></>;
    }

    if (error instanceof InvalidTransition) {
      const validNext =
        error.validNext.length === 0 ? "No valid next status" : error.validNext.join(", ");

      return (
        <div className="mt-3 rounded-md bg-[--warning]/10 px-3 py-2 text-sm text-[--warning]" role="alert">
          <p className="m-0 font-medium">
            Invalid transition: {error.from} -&gt; {error.to}
          </p>
          <p className="m-0 mt-1 opacity-90">Valid next: {validNext}</p>
          <div className="mt-2">
            <button type="button" className="incident-card__advance-btn" onClick={refreshIncident}>
              Refresh
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-3 rounded-md bg-[--warning]/10 px-3 py-2 text-sm text-[--warning]" role="alert">
        Incident #{error.id} no longer exists
        <div className="mt-2">
          <button type="button" className="incident-card__advance-btn" onClick={refreshIncident}>
            Refresh
          </button>
        </div>
      </div>
    );
  });

  const expanded = yield* Signal.derive(expandedIds, (set) => set.has(incident.id));
  const ariaExpanded = yield* Signal.derive(expanded, (v) => (v ? "true" : "false"));
  const chevron = yield* Signal.derive(expanded, (v) => (v ? "\u25B2" : "\u25BC"));

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
              type="button"
              className="incident-card__advance-btn"
              onClick={() =>
                Effect.gen(function* () {
                  const inFlight = yield* Signal.get(transitioning);
                  if (inFlight) {
                    return;
                  }
                  yield* Signal.set(transitionError, null);
                  yield* Signal.set(transitioning, true);
                  if (nextTransition === undefined) {
                    return;
                  }

                  const client = yield* ApiClient;
                  const transitioned = yield* client.incidents
                    .transition({
                      path: { id: incident.id },
                      payload: { to: nextTransition },
                    })
                    .pipe(
                      Effect.matchEffect({
                        onFailure: (error) =>
                          Signal.set(transitionError, toTransitionError(error)).pipe(Effect.as(false)),
                        onSuccess: () => Effect.succeed(true),
                      }),
                    );

                  if (!transitioned) {
                    return;
                  }

                  yield* Resource.invalidate(incidentResource({ id: incident.id }));
                  yield* Resource.invalidate(incidentsResource);
                }).pipe(
                  Effect.ensuring(Signal.set(transitioning, false)),
                )
              }
              disabled={transitioning}
            >
              {advanceLabel}
            </button>
          </div>
        )}

        {transitionAlert}
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
