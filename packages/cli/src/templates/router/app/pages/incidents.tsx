import { Effect } from "effect";
import { Component, Resource, Signal } from "trygg";
import { incidentsResource, type Incident } from "../resources/incidents";
import { IncidentCard } from "../components/incident-card";
import { IncidentSkeleton } from "../components/incident-skeleton";
import { ErrorView } from "../components/error-view";

export default Component.gen(function* () {
  const state = yield* Resource.fetch(incidentsResource);

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

    Success: (incidents, stale) => {
      const incidentsSignal = Signal.makeSync(incidents);

      const activeCount = incidents.filter(
        (i: Incident) => i.status !== "Resolved",
      ).length;
      const resolvedCount = incidents.filter(
        (i: Incident) => i.status === "Resolved",
      ).length;

      return (
        <div>
          <div className="incidents-header">
            <div>
              <h1 className="incidents-header__title">Incidents</h1>
              <p className="incidents-header__subtitle">
                <span className="incidents-count incidents-count--active">
                  {String(activeCount)} active
                </span>
                {" \u00B7 "}
                <span className="incidents-count incidents-count--resolved">
                  {String(resolvedCount)} resolved
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
              (incident) =>
                Effect.succeed(<IncidentCard incident={incident} />),
              { key: (incident: Incident) => incident.id },
            )}
          </div>
        </div>
      );
    },

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
