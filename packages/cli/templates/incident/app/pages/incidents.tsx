import { Effect } from "effect";
import { Component, Resource, Signal } from "trygg";
import { incidentsResource, type Incident } from "../resources/incidents";
import { IncidentCard } from "../components/incident-card";
import { IncidentSkeleton } from "../components/incident-skeleton";
import { ErrorView } from "../components/error-view";

export default Component.gen(function* () {
  const state = yield* Resource.fetch(incidentsResource);

  // Page-level expansion state: persists across resource refreshes
  // Set of expanded incident IDs
  const expandedIds = yield* Signal.make<ReadonlySet<number>>(new Set());

  // Toggle expansion for an incident
  const toggleExpanded = (id: number) =>
    Signal.update(expandedIds, (set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Derive incidents array from resource state (empty while pending/failed)
  const incidentsSignal = yield* Signal.derive(state, (s) =>
    s._tag === "Success" ? s.value : ([] as readonly Incident[]),
  );

  // Derive counts for header
  const activeCount = yield* Signal.derive(incidentsSignal, (incidents) =>
    incidents.filter((i) => i.status !== "Resolved").length,
  );
  const resolvedCount = yield* Signal.derive(incidentsSignal, (incidents) =>
    incidents.filter((i) => i.status === "Resolved").length,
  );

  return yield* Resource.match(state, {
    Pending: () => (
      <div>
        <div className="incidents-header">
          <div>
            <h1 className="incidents-header__title">Incidents</h1>
            <p className="incidents-header__subtitle">Loading incidents...</p>
          </div>
        </div>
        <IncidentSkeleton />
      </div>
    ),

    Success: (_incidents, stale) => (
      <div>
        <div className="incidents-header">
          <div>
            <h1 className="incidents-header__title">Incidents</h1>
            <p className="incidents-header__subtitle">
              <span className="incidents-count incidents-count--active">
                {activeCount} active
              </span>
              {" \u00B7 "}
              <span className="incidents-count incidents-count--resolved">
                {resolvedCount} resolved
              </span>
            </p>
          </div>
          <button
            className="incidents-header__refresh"
            onClick={Resource.invalidate(incidentsResource)}
            disabled={stale}
          >
            {stale ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className={stale ? "opacity-60" : ""}>
          {Signal.each(
            incidentsSignal,
            (incident) => (
              <IncidentCard
                incident={incident}
                expandedIds={expandedIds}
                onToggle={() => toggleExpanded(incident.id)}
              />
            ),
            { key: (incident: Incident) => incident.id },
          )}
        </div>
      </div>
    ),

    Failure: (error) => (
      <div>
        <div className="incidents-header">
          <div>
            <h1 className="incidents-header__title">Incidents</h1>
            <p className="incidents-header__subtitle">Failed to load incidents</p>
          </div>
        </div>
        <ErrorView error={error} onRetry={Resource.refresh(incidentsResource)} />
      </div>
    ),
  });
});
