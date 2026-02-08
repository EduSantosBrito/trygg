import { Effect } from "effect";
import { Component, ErrorBoundary, Resource, Signal, type ComponentProps } from "trygg";
import * as Router from "trygg/router";
import { type Severity } from "../errors/incidents";
import { incidentsResource, type Incident } from "../resources/incidents";
import { IncidentSkeleton } from "../components/incident-skeleton";
import { ErrorView } from "../components/error-view";
import { ReportForm } from "../components/report-form";
import { StatusBadge } from "../components/status-badge";
import { SeverityBadge } from "../components/severity-badge";
import { formatRelative } from "../utils/date";

type Filter = "all" | Severity;
const FILTERS: ReadonlyArray<Filter> = ["all", "SEV-1", "SEV-2", "SEV-3", "SEV-4"];
const EMPTY_INCIDENTS: ReadonlyArray<Incident> = [];

const UnexpectedErrorView = Component.gen(function* (
  Props: ComponentProps<{ error: unknown }>,
) {
  yield* Props;
  return (
    <div className="error-view" role="alert">
      <h3 className="error-view__title">Unexpected Error</h3>
      <p className="error-view__message">Something went wrong while loading this incident.</p>
    </div>
  );
});

export default Component.gen(function* () {
  const state = yield* Resource.fetch(incidentsResource);

  // Modal open state
  const modalOpen = yield* Signal.make(false);
  const openModal = () => Signal.set(modalOpen, true);
  const closeModal = () => Signal.set(modalOpen, false);
  const closeModalAndClearQuery = () =>
    Effect.gen(function* () {
      yield* Signal.set(modalOpen, false);
      yield* Router.navigate("/incidents", { replace: true });
    });

  // Check for ?declare=true query param to auto-open modal
  const querySignal = yield* Router.querySignal;
  const query = yield* Signal.get(querySignal);
  if (query.get("declare") === "true") {
    yield* Signal.set(modalOpen, true);
  }

  // Severity filter state
  const filter = yield* Signal.make<Filter>("all");

  // Derive incidents array from resource state
  const incidentsSignal = yield* Signal.derive(state, (s) =>
    s._tag === "Success" ? s.value : EMPTY_INCIDENTS,
  );

  // Derive filtered incidents based on severity filter
  const filteredIncidents = yield* Signal.deriveAll(
    [incidentsSignal, filter],
    (incidents, f) => (f === "all" ? incidents : incidents.filter((i) => i.severity === f)),
  );

  // Derive counts for summary
  const activeCount = yield* Signal.derive(incidentsSignal, (incidents) =>
    incidents.filter((i) => i.status !== "Resolved").length,
  );

  // Derive filter button active states
  const filterButtons = yield* Effect.forEach(FILTERS, (value) =>
    Signal.derive(filter, (current): string => (current === value ? "true" : "false")).pipe(
      Effect.map((active) => ({ value, active })),
    ),
  );

  // Modal visibility derived
  const modalVisible = yield* Signal.derive(modalOpen, (open) => (open ? "true" : "false"));

  const listContent = yield* Resource.match(state, {
    Pending: () => <IncidentSkeleton />,
    Success: () => (
      <div className="incidents-list">
        {Signal.each(
          filteredIncidents,
          (incident) => <IncidentRow incident={incident} />,
          { key: (incident: Incident) => incident.id },
        )}
      </div>
    ),
    Failure: (error) => <ErrorView error={error} onRetry={Resource.refresh(incidentsResource)} />,
  });

  return (
    <>
      {/* Page header */}
      <header className="content-header">
        <div className="content-header__left">
          <div className="content-header__title">
            <div className="content-header__icon" aria-hidden="true" />
            <h1 className="content-header__text">Incidents</h1>
          </div>
        </div>
        <div className="content-header__actions">
          <button type="button" className="btn btn--primary" onClick={openModal}>
            Declare Incident
          </button>
        </div>
      </header>

      {/* Page body */}
      <main className="content-body">
        {/* Toolbar */}
        <div className="incidents-toolbar">
          <div className="incidents-search">
            <span className="incidents-search__icon" aria-hidden="true" />
            <input
              type="search"
              className="incidents-search__input"
              placeholder="Search incidents…"
              name="search"
              autoComplete="off"
            />
          </div>

          <div className="incidents-toolbar__actions">
            {filterButtons.map((button) => (
              <button
                key={button.value}
                type="button"
                className="btn btn--secondary btn--sm"
                data-active={button.active}
                aria-pressed={button.active}
                onClick={Signal.set(filter, button.value)}
              >
                {button.value === "all" ? "All" : button.value}
              </button>
            ))}
          </div>
        </div>

        {/* Summary stats */}
        <p className="text-sm text-[var(--text-3)] mb-4">
          <span className="font-medium text-[var(--text-1)]">{activeCount}</span> active incidents
        </p>

        {/* List */}
        {listContent}
      </main>

      {/* Declare incident modal */}
      <DeclareModal open={modalOpen} onClose={closeModalAndClearQuery} />
    </>
  );
});

// ---------------------------------------------------------------------------
// Incident row component
// ---------------------------------------------------------------------------

const IncidentRow = Component.gen(function* (Props: ComponentProps<{ incident: Incident }>) {
  const { incident } = yield* Props;

  return (
    <Router.Link
      to="/incidents/:id"
      params={{ id: String(incident.id) }}
      className="incident-row"
    >
      <div className="incident-row__content">
        <div className="incident-row__header">
          <span className="incident-row__id">INC-{incident.id}</span>
          <span className="incident-row__title">{incident.title}</span>
        </div>
        <div className="incident-row__meta">
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
          <span className="incident-row__meta-item">
            <span className="incident-row__meta-icon" aria-hidden="true" />
            Reported {formatRelative(incident.createdAt)}
          </span>
        </div>
      </div>
      <span className="incident-row__chevron" aria-hidden="true" />
    </Router.Link>
  );
});

// ---------------------------------------------------------------------------
// Declare incident modal
// ---------------------------------------------------------------------------

interface DeclareModalProps {
  readonly open: Signal.Signal<boolean>;
  readonly onClose: () => Effect.Effect<void, unknown, unknown>;
}

const DeclareModal = Component.gen(function* (Props: ComponentProps<DeclareModalProps>) {
  const { open, onClose } = yield* Props;
  const isOpen = yield* Signal.get(open);

  if (!isOpen) {
    return <></>;
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e: MouseEvent) => {
        if (e.target === e.currentTarget) {
          return onClose();
        }
        return Effect.void;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="declare-modal-title"
    >
      <div className="modal">
        <div className="modal__header">
          <h2 id="declare-modal-title" className="modal__title">Declare Incident</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <span className="modal__close-icon" aria-hidden="true" />
          </button>
        </div>



        <div className="modal__body">
          <ReportForm onSuccess={onClose} />
        </div>
      </div>
    </div>
  );
});
