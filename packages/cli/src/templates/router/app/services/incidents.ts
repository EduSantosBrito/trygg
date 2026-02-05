import { Context, Effect, Layer } from "effect";
import type { Severity } from "../errors/incidents";
import { type Status, IncidentNotFound, InvalidTransition } from "../errors/incidents";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export const TRANSITIONS: Record<Status, ReadonlyArray<Status>> = {
  Detected: ["Investigating"],
  Investigating: ["Identified"],
  Identified: ["Monitoring"],
  Monitoring: ["Resolved"],
  Resolved: [],
};

export interface TimelineEntry {
  readonly timestamp: Date;
  readonly message: string;
}

export interface Incident {
  readonly id: number;
  readonly title: string;
  readonly severity: Severity;
  readonly status: Status;
  readonly timeline: ReadonlyArray<TimelineEntry>;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export interface IncidentService {
  readonly list: Effect.Effect<ReadonlyArray<Incident>>;
  readonly get: (id: number) => Effect.Effect<Incident, IncidentNotFound>;
  readonly create: (params: {
    readonly title: string;
    readonly severity: Severity;
  }) => Effect.Effect<Incident>;
  readonly transition: (
    id: number,
    to: Status,
  ) => Effect.Effect<Incident, InvalidTransition | IncidentNotFound>;
  readonly addTimelineEntry: (id: number, message: string) => Effect.Effect<void, IncidentNotFound>;
}

export class Incidents extends Context.Tag("Incidents")<Incidents, IncidentService>() {}

// ---------------------------------------------------------------------------
// Mock implementation (in-memory)
// ---------------------------------------------------------------------------

const now = () => new Date();

const seed: ReadonlyArray<Incident> = [
  {
    id: 1,
    title: "API latency spike",
    severity: "SEV-2",
    status: "Investigating",
    timeline: [
      { timestamp: new Date("2026-01-15T14:02:00Z"), message: "Incident created" },
      { timestamp: new Date("2026-01-15T14:03:00Z"), message: "→ Investigating" },
    ],
    createdAt: new Date("2026-01-15T14:02:00Z"),
  },
  {
    id: 2,
    title: "DB connection pool exhaustion",
    severity: "SEV-1",
    status: "Detected",
    timeline: [{ timestamp: new Date("2026-01-15T14:05:00Z"), message: "Incident created" }],
    createdAt: new Date("2026-01-15T14:05:00Z"),
  },
  {
    id: 3,
    title: "Auth service 503",
    severity: "SEV-3",
    status: "Resolved",
    timeline: [
      { timestamp: new Date("2026-01-15T13:50:00Z"), message: "Incident created" },
      { timestamp: new Date("2026-01-15T13:52:00Z"), message: "→ Investigating" },
      { timestamp: new Date("2026-01-15T13:55:00Z"), message: "→ Identified" },
      { timestamp: new Date("2026-01-15T13:58:00Z"), message: "→ Monitoring" },
      { timestamp: new Date("2026-01-15T14:00:00Z"), message: "→ Resolved" },
    ],
    createdAt: new Date("2026-01-15T13:50:00Z"),
  },
];

const makeIncidentService = (): IncidentService => {
  const store = new Map<number, Incident>(seed.map((i) => [i.id, i]));
  let nextId = 4;

  const lookup = (id: number): Effect.Effect<Incident, IncidentNotFound> => {
    const incident = store.get(id);
    return incident !== undefined
      ? Effect.succeed(incident)
      : Effect.fail(new IncidentNotFound({ id }));
  };

  return {
    list: Effect.sync(() => [...store.values()]),

    get: lookup,

    create: ({ title, severity }) =>
      Effect.sync(() => {
        const id = nextId++;
        const ts = now();
        const incident: Incident = {
          id,
          title,
          severity,
          status: "Detected",
          timeline: [{ timestamp: ts, message: "Incident created" }],
          createdAt: ts,
        };
        store.set(id, incident);
        return incident;
      }),

    transition: (id, to) =>
      Effect.gen(function* () {
        const incident = yield* lookup(id);
        const valid = TRANSITIONS[incident.status];
        if (!valid.includes(to)) {
          return yield* new InvalidTransition({
            from: incident.status,
            to,
            validNext: valid,
          });
        }
        const ts = now();
        const updated: Incident = {
          ...incident,
          status: to,
          timeline: [...incident.timeline, { timestamp: ts, message: `→ ${to}` }],
        };
        store.set(id, updated);
        return updated;
      }),

    addTimelineEntry: (id, message) =>
      Effect.gen(function* () {
        const incident = yield* lookup(id);
        const updated: Incident = {
          ...incident,
          timeline: [...incident.timeline, { timestamp: now(), message }],
        };
        store.set(id, updated);
      }),
  };
};

export const IncidentsLive = Layer.succeed(Incidents, makeIncidentService());
