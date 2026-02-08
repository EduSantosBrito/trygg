import { Effect } from "effect";
import { Component, Resource, Signal, type ComponentProps } from "trygg";
import * as Router from "trygg/router";
import { incidentsResource, type Incident } from "../resources/incidents";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Command {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly action: () => Effect.Effect<void, unknown, unknown>;
}

interface CommandPaletteProps {
  readonly open: Signal.Signal<boolean>;
  readonly onClose: () => Effect.Effect<void>;
}

const DIALOG_ID = "cmdk-dialog";

// ---------------------------------------------------------------------------
// Command Palette Component
// ---------------------------------------------------------------------------

export const CommandPalette = Component.gen(function* (
  Props: ComponentProps<CommandPaletteProps>,
) {
  const { open, onClose } = yield* Props;

  // Search query state
  const query = yield* Signal.make("");

  // Active selection index for keyboard navigation
  const activeIndex = yield* Signal.make(0);

  // Load incidents for search
  const incidentsState = yield* Resource.fetch(incidentsResource);

  // Derive all incidents from resource
  const allIncidents = yield* Signal.derive(
    incidentsState,
    (s): ReadonlyArray<Incident> => (s._tag === "Success" ? s.value : []),
  );

  // Commands list
  const commands: ReadonlyArray<Command> = [
    {
      id: "create-incident",
      label: "Declare incident",
      action: () =>
        Effect.gen(function* () {
          yield* onClose();
          yield* Router.navigate("/incidents?declare=true");
        }),
    },
    {
      id: "go-home",
      label: "Go to Home",
      action: () =>
        Effect.gen(function* () {
          yield* onClose();
          yield* Router.navigate("/");
        }),
    },
    {
      id: "go-incidents",
      label: "Go to Incidents",
      action: () =>
        Effect.gen(function* () {
          yield* onClose();
          yield* Router.navigate("/incidents");
        }),
    },
    {
      id: "go-settings",
      label: "Go to Settings",
      action: () =>
        Effect.gen(function* () {
          yield* onClose();
          yield* Router.navigate("/settings");
        }),
    },
  ];

  // Filter commands based on query
  const filteredCommands = yield* Signal.derive(query, (q) => {
    const lower = q.toLowerCase().trim();
    if (lower === "") return commands;
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(lower));
  });

  // Filter incidents based on query
  const filteredIncidents = yield* Signal.deriveAll(
    [query, allIncidents],
    (q, incidents) => {
      const lower = q.toLowerCase().trim();
      if (lower === "") return incidents.slice(0, 5);
      return incidents.filter(
        (inc) =>
          inc.title.toLowerCase().includes(lower) ||
          `inc-${inc.id}`.includes(lower),
      );
    },
  );

  // Total result count for keyboard navigation bounds
  const totalResults = yield* Signal.deriveAll(
    [filteredCommands, filteredIncidents],
    (cmds, incs) => cmds.length + incs.length,
  );

  // Subscribe to open state and sync with dialog
  yield* Signal.subscribe(open, () =>
    Effect.sync(() => {
      const dialog = document.getElementById(DIALOG_ID) as HTMLDialogElement | null;
      if (!dialog) return;

      Effect.runSync(Signal.get(open).pipe(
        Effect.tap((isOpen) =>
          Effect.sync(() => {
            if (isOpen && !dialog.open) {
              Effect.runFork(
                Effect.gen(function* () {
                  yield* Signal.set(query, "");
                  yield* Signal.set(activeIndex, 0);
                }),
              );
              dialog.showModal();
            } else if (!isOpen && dialog.open) {
              dialog.close();
            }
          }),
        ),
      ));
    }),
  );

  // Event handlers
  const onQueryInput = (event: Event) =>
    Effect.gen(function* () {
      const target = event.target;
      if (target instanceof HTMLInputElement) {
        yield* Signal.set(query, target.value);
        yield* Signal.set(activeIndex, 0);
      }
    });

  const onKeyDown = (event: KeyboardEvent) =>
    Effect.gen(function* () {
      const total = yield* Signal.get(totalResults);
      const current = yield* Signal.get(activeIndex);
      const cmds = yield* Signal.get(filteredCommands);
      const incs = yield* Signal.get(filteredIncidents);

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          yield* Signal.set(activeIndex, Math.min(current + 1, total - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          yield* Signal.set(activeIndex, Math.max(current - 1, 0));
          break;
        case "Enter":
          event.preventDefault();
          if (current < cmds.length) {
            yield* cmds[current].action();
          } else {
            const incIndex = current - cmds.length;
            if (incIndex < incs.length) {
              yield* onClose();
              yield* Router.navigate("/incidents/:id", { params: { id: String(incs[incIndex].id) } });
            }
          }
          break;
      }
    });

  // Handle native dialog cancel (Escape key)
  const onCancel = (event: Event) => {
    event.preventDefault();
    return onClose();
  };

  // Handle backdrop click
  const onBackdropClick = (event: MouseEvent) => {
    const dialog = event.currentTarget as HTMLDialogElement;
    const rect = dialog.getBoundingClientRect();
    const clickedInDialog =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!clickedInDialog) {
      return onClose();
    }
    return Effect.void;
  };

  const selectIncident = (incident: Incident) => () =>
    Effect.gen(function* () {
      yield* onClose();
      yield* Router.navigate("/incidents/:id", { params: { id: String(incident.id) } });
    });

  return (
    <dialog
      id={DIALOG_ID}
      className="cmdk-dialog"
      onCancel={onCancel}
      onClick={onBackdropClick}
    >
      <div className="cmdk" onKeyDown={onKeyDown}>
        <div className="cmdk-input-wrapper">
          <span className="cmdk-input-icon" aria-hidden="true" />
          <input
            type="text"
            className="cmdk-input"
            placeholder="Search commands and incidents…"
            value={query}
            onInput={onQueryInput}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmdk-input-kbd">esc</kbd>
        </div>

        <div className="cmdk-list">
          <CommandsSection
            commands={filteredCommands}
            activeIndex={activeIndex}
            baseIndex={0}
          />

          <IncidentsSection
            incidents={filteredIncidents}
            activeIndex={activeIndex}
            baseIndex={yield* Signal.derive(filteredCommands, (cmds) => cmds.length)}
            onSelect={selectIncident}
          />

          <EmptyState
            show={yield* Signal.deriveAll(
              [filteredCommands, filteredIncidents],
              (cmds, incs) => cmds.length === 0 && incs.length === 0,
            )}
          />
        </div>
      </div>
    </dialog>
  );
});

// ---------------------------------------------------------------------------
// Commands Section
// ---------------------------------------------------------------------------

interface CommandsSectionProps {
  readonly commands: Signal.Signal<ReadonlyArray<Command>>;
  readonly activeIndex: Signal.Signal<number>;
  readonly baseIndex: number;
}

const CommandsSection = Component.gen(function* (
  Props: ComponentProps<CommandsSectionProps>,
) {
  const { commands, activeIndex, baseIndex } = yield* Props;
  const cmds = yield* Signal.get(commands);

  if (cmds.length === 0) {
    return <></>;
  }

  return (
    <div className="cmdk-group">
      <div className="cmdk-group-heading">Commands</div>
      {cmds.map((cmd, i) => (
        <CommandItem
          key={cmd.id}
          command={cmd}
          index={baseIndex + i}
          activeIndex={activeIndex}
        />
      ))}
    </div>
  );
});

interface CommandItemProps {
  readonly key?: string;
  readonly command: Command;
  readonly index: number;
  readonly activeIndex: Signal.Signal<number>;
}

const CommandItem = Component.gen(function* (
  Props: ComponentProps<CommandItemProps>,
) {
  const { command, index, activeIndex } = yield* Props;

  const className = yield* Signal.derive(activeIndex, (active) =>
    active === index ? "cmdk-item cmdk-item--active" : "cmdk-item",
  );

  return (
    <button type="button" className={className} onClick={command.action}>
      <span className="cmdk-item-icon cmdk-item-icon--command" aria-hidden="true" />
      <span className="cmdk-item-label">{command.label}</span>
      {command.shortcut && <kbd className="cmdk-item-kbd">{command.shortcut}</kbd>}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Incidents Section
// ---------------------------------------------------------------------------

interface IncidentsSectionProps {
  readonly incidents: Signal.Signal<Incident[]>;
  readonly activeIndex: Signal.Signal<number>;
  readonly baseIndex: Signal.Signal<number>;
  readonly onSelect: (inc: Incident) => () => Effect.Effect<void, unknown, unknown>;
}

const IncidentsSection = Component.gen(function* (
  Props: ComponentProps<IncidentsSectionProps>,
) {
  const { incidents, activeIndex, baseIndex, onSelect } = yield* Props;
  const incs = yield* Signal.get(incidents);

  if (incs.length === 0) {
    return <></>;
  }

  return (
    <div className="cmdk-group">
      <div className="cmdk-group-heading">Incidents</div>
      {incs.map((inc, i) => (
        <IncidentItem
          key={inc.id}
          incident={inc}
          index={i}
          baseIndex={baseIndex}
          activeIndex={activeIndex}
          onSelect={onSelect(inc)}
        />
      ))}
    </div>
  );
});

interface IncidentItemProps {
  readonly key?: number;
  readonly incident: Incident;
  readonly index: number;
  readonly baseIndex: Signal.Signal<number>;
  readonly activeIndex: Signal.Signal<number>;
  readonly onSelect: () => Effect.Effect<void, unknown, unknown>;
}

const IncidentItem = Component.gen(function* (
  Props: ComponentProps<IncidentItemProps>,
) {
  const { incident, index, baseIndex, activeIndex, onSelect } = yield* Props;

  const className = yield* Signal.deriveAll(
    [activeIndex, baseIndex],
    (active, base) =>
      active === base + index ? "cmdk-item cmdk-item--active" : "cmdk-item",
  );

  return (
    <button type="button" className={className} onClick={onSelect}>
      <span className="cmdk-item-icon cmdk-item-icon--incident" aria-hidden="true" />
      <span className="cmdk-item-label">
        <span className="cmdk-item-id">INC-{incident.id}</span>
        {incident.title}
      </span>
      <span className="cmdk-item-meta">{incident.status}</span>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  readonly show: Signal.Signal<boolean>;
}

const EmptyState = Component.gen(function* (Props: ComponentProps<EmptyStateProps>) {
  const { show } = yield* Props;
  const visible = yield* Signal.get(show);

  if (!visible) {
    return <></>;
  }

  return <div className="cmdk-empty">No results found</div>;
});
