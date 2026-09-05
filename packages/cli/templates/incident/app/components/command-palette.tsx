import { Effect, Predicate } from "effect";
import { Component, Resource, Signal, type ComponentProps } from "trygg";
import * as Router from "trygg/router";
import { subscribeCommandPaletteOpen } from "../command-palette-lifecycle";
import { incidentsResource, type Incident } from "../resources/incidents";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Command {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly action: (event?: Event) => Effect.Effect<void, never, Router.Router>;
}

interface CommandPaletteProps {
  readonly open: Signal.Signal<boolean>;
  readonly onClose: () => Effect.Effect<void>;
}

const DIALOG_ID = "cmdk-dialog";

// ---------------------------------------------------------------------------
// Command Palette Component
// ---------------------------------------------------------------------------

export const CommandPalette = Component.gen(function* (Props: ComponentProps<CommandPaletteProps>) {
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
    (s): ReadonlyArray<Incident> => (Predicate.isTagged(s, "Success") ? s.value : []),
  );

  const handleNavigationError = (error: unknown) =>
    Effect.logWarning("Command palette navigation failed").pipe(
      Effect.annotateLogs("error", error),
      Effect.asVoid,
    );

  // Commands list
  const commands: ReadonlyArray<Command> = [
    {
      id: "create-incident",
      label: "Declare incident",
      action: Effect.fnUntraced(function* (_event?: Event) {
        yield* onClose();
        yield* Router.navigate("/incidents?declare=true").pipe(Effect.catch(handleNavigationError));
      }),
    },
    {
      id: "go-home",
      label: "Go to Home",
      action: Effect.fnUntraced(function* (_event?: Event) {
        yield* onClose();
        yield* Router.navigate("/").pipe(Effect.catch(handleNavigationError));
      }),
    },
    {
      id: "go-incidents",
      label: "Go to Incidents",
      action: Effect.fnUntraced(function* (_event?: Event) {
        yield* onClose();
        yield* Router.navigate("/incidents").pipe(Effect.catch(handleNavigationError));
      }),
    },
    {
      id: "go-settings",
      label: "Go to Settings",
      action: Effect.fnUntraced(function* (_event?: Event) {
        yield* onClose();
        yield* Router.navigate("/settings").pipe(Effect.catch(handleNavigationError));
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
  const filteredIncidents = yield* Signal.deriveAll([query, allIncidents], (q, incidents) => {
    const lower = q.toLowerCase().trim();
    if (lower === "") return incidents.slice(0, 5);
    return incidents.filter(
      (inc) => inc.title.toLowerCase().includes(lower) || `inc-${inc.id}`.includes(lower),
    );
  });

  // Total result count for keyboard navigation bounds
  const totalResults = yield* Signal.deriveAll(
    [filteredCommands, filteredIncidents],
    (cmds, incs) => cmds.length + incs.length,
  );

  // Subscribe to open state and sync with dialog
  yield* subscribeCommandPaletteOpen(open, () =>
    Effect.gen(function* () {
      const node = document.getElementById(DIALOG_ID);
      if (!(node instanceof HTMLDialogElement)) {
        return;
      }

      const dialog = node;
      const isOpen = yield* Signal.peek(open);

      if (isOpen && !dialog.open) {
        yield* Signal.set(query, "");
        yield* Signal.set(activeIndex, 0);
        yield* Effect.sync(() => dialog.showModal());
        return;
      }

      if (!isOpen && dialog.open) {
        yield* Effect.sync(() => dialog.close());
      }
    }),
  );

  // Event handlers
  const onQueryInput = Effect.fnUntraced(function* (event: Event) {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      yield* Signal.set(query, target.value);
      yield* Signal.set(activeIndex, 0);
    }
  });

  const onKeyDown = Effect.fnUntraced(function* (event: Event) {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }

    const total = yield* Signal.peek(totalResults);
    const current = yield* Signal.peek(activeIndex);
    const cmds = yield* Signal.peek(filteredCommands);
    const incs = yield* Signal.peek(filteredIncidents);

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
          const selectedCommand = cmds[current];
          if (selectedCommand !== undefined) {
            yield* selectedCommand.action();
          }
        } else {
          const incIndex = current - cmds.length;
          const selectedIncident = incs[incIndex];
          if (selectedIncident !== undefined) {
            yield* onClose();
            yield* Router.navigate("/incidents/:id", {
              params: { id: String(selectedIncident.id) },
            }).pipe(Effect.catch(handleNavigationError));
          }
        }
        break;
      case "Escape":
        event.preventDefault();
        yield* onClose();
        break;
    }
  });

  // Handle backdrop click
  const onBackdropClick = (event: Event) => {
    if (!(event instanceof MouseEvent)) {
      return Effect.void;
    }

    if (!(event.currentTarget instanceof HTMLDialogElement)) {
      return Effect.void;
    }

    const dialog = event.currentTarget;
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

  const selectIncident = (incident: Incident) =>
    Effect.fnUntraced(function* (_event?: Event) {
      yield* onClose();
      yield* Router.navigate("/incidents/:id", { params: { id: String(incident.id) } }).pipe(
        Effect.catch(handleNavigationError),
      );
    });

  return (
    <dialog id={DIALOG_ID} className="cmdk-dialog" onClick={onBackdropClick}>
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
          <CommandsSection commands={filteredCommands} activeIndex={activeIndex} baseIndex={0} />

          <IncidentsSection
            incidents={filteredIncidents}
            activeIndex={activeIndex}
            baseIndex={yield* Signal.derive(filteredCommands, (cmds) => cmds.length)}
            onSelect={selectIncident}
          />

          <EmptyState
            show={
              yield* Signal.deriveAll(
                [filteredCommands, filteredIncidents],
                (cmds, incs) => cmds.length === 0 && incs.length === 0,
              )
            }
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

const CommandsSection = Component.gen(function* (Props: ComponentProps<CommandsSectionProps>) {
  const { commands, activeIndex, baseIndex } = yield* Props;
  const cmds = yield* Signal.get(commands);

  if (cmds.length === 0) {
    return <></>;
  }

  return (
    <div className="cmdk-group">
      <div className="cmdk-group-heading">Commands</div>
      {cmds.map((cmd, i) => (
        <CommandItem key={cmd.id} command={cmd} index={baseIndex + i} activeIndex={activeIndex} />
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

const CommandItem = Component.gen(function* (Props: ComponentProps<CommandItemProps>) {
  const { command, index, activeIndex } = yield* Props;

  const className = yield* Signal.derive(activeIndex, (active): string =>
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
  readonly onSelect: (
    inc: Incident,
  ) => (event?: Event) => Effect.Effect<void, never, Router.Router>;
}

const IncidentsSection = Component.gen(function* (Props: ComponentProps<IncidentsSectionProps>) {
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
  readonly onSelect: (event?: Event) => Effect.Effect<void, never, Router.Router>;
}

const IncidentItem = Component.gen(function* (Props: ComponentProps<IncidentItemProps>) {
  const { incident, index, baseIndex, activeIndex, onSelect } = yield* Props;

  const className = yield* Signal.deriveAll([activeIndex, baseIndex], (active, base): string =>
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
