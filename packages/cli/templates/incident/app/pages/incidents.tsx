import { Effect } from "effect";
import { Component, Resource, Signal } from "trygg";
import { type Severity } from "../errors/incidents";
import { incidentsResource, type Incident } from "../resources/incidents";
import { IncidentCard } from "../components/incident-card";
import { IncidentSkeleton } from "../components/incident-skeleton";
import { ErrorView } from "../components/error-view";
import { ReportForm } from "../components/report-form";

type Filter = "all" | Severity;
const FILTERS: ReadonlyArray<Filter> = ["all", "SEV-1", "SEV-2", "SEV-3", "SEV-4"];
const EMPTY_INCIDENTS: ReadonlyArray<Incident> = [];

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

  // Severity filter state
  const filter = yield* Signal.make<Filter>("all");

  const refreshDisabled = yield* Signal.derive(state, (s) => s._tag !== "Success" || s.stale);
  const refreshText = yield* Signal.derive(state, (s) =>
    s._tag === "Success" && s.stale ? "Refreshing..." : "Refresh",
  );

  // Derive incidents array from resource state (empty while pending/failed)
  const incidentsSignal = yield* Signal.derive(state, (s) =>
    s._tag === "Success" ? s.value : EMPTY_INCIDENTS,
  );

  // Derive filtered incidents based on severity filter
  const filteredIncidents = yield* Signal.deriveAll(
    [incidentsSignal, filter],
    (incidents, f) => (f === "all" ? incidents : incidents.filter((i) => i.severity === f)),
  );

  // Derive counts for header
  const activeCount = yield* Signal.derive(incidentsSignal, (incidents) =>
    incidents.filter((i) => i.status !== "Resolved").length,
  );
  const resolvedCount = yield* Signal.derive(incidentsSignal, (incidents) =>
    incidents.filter((i) => i.status === "Resolved").length,
  );

  // Derive active state for each filter button
  const filterButtons = yield* Effect.forEach(FILTERS, (value) =>
    Signal.derive(filter, (current): string => (current === value ? "true" : "false")).pipe(
      Effect.map((active) => ({ value, active })),
    ),
  );

  const dataRegion = yield* Resource.match(state, {
    Pending: () => <IncidentSkeleton />,
    Success: () => (
      <>
        <div className="incidents-filter">
          {filterButtons.map((button) => (
            <button
              key={button.value}
              className="incidents-filter__btn"
              data-active={button.active}
              aria-pressed={button.active}
              onClick={Signal.set(filter, button.value)}
            >
              {button.value === "all" ? "All" : button.value}
            </button>
          ))}
        </div>

        {Signal.each(
          filteredIncidents,
          (incident) => (
            <IncidentCard
              incident={incident}
              expandedIds={expandedIds}
              onToggle={() => toggleExpanded(incident.id)}
            />
          ),
          { key: (incident: Incident) => incident.id },
        )}
      </>
    ),
    Failure: (error) => <ErrorView error={error} onRetry={Resource.refresh(incidentsResource)} />,
  });

  // Stable shell: header + form always mounted, only data region swaps
  return (
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
          disabled={refreshDisabled}
        >
          {refreshText}
        </button>
      </div>

      <ReportForm />

      {dataRegion}
    </div>
  );
});
