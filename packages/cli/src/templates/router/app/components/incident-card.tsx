import { Effect } from "effect";
import { Component, Signal, type ComponentProps } from "trygg";
import type { Incident } from "../api";
import { TRANSITIONS } from "../services/incidents";
import { StatusBadge } from "./status-badge";
import { SeverityBadge } from "./severity-badge";
import { TimelineEntry } from "./timeline-entry";

export const IncidentCard = Component.gen(function* (
  Props: ComponentProps<{ incident: Incident }>,
) {
  const { incident } = yield* Props;
  const expanded = yield* Signal.make(false);
  const expandedValue = yield* Signal.get(expanded);
  const toggleExpanded = () => Signal.update(expanded, (v) => !v);

  const validTransitions = TRANSITIONS[incident.status];
  const hasNext = validTransitions.length > 0;

  return (
    <article className="incident-card">
      <button
        className="incident-card__header"
        onClick={toggleExpanded}
        aria-expanded={expandedValue ? "true" : "false"}
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
            {expandedValue ? "\u25B2" : "\u25BC"}
          </span>
        </div>
      </button>

      {expandedValue && (
        <div className="incident-card__body">
          <div className="incident-card__timeline">
            <h4 className="incident-card__section-title">Timeline</h4>
            {incident.timeline.map((entry, i) => (
              <TimelineEntry key={i} entry={entry} />
            ))}
          </div>

          {hasNext && (
            <div className="incident-card__actions">
              <button
                className="incident-card__advance-btn"
                onClick={() =>
                  Effect.gen(function* () {
                    yield* Effect.log(`Advance ${String(incident.id)} to ${validTransitions[0]}`);
                  })
                }
              >
                Advance to {validTransitions[0]}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
});

const formatRelative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
};
