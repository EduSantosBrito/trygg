import { DateTime, Effect, Layer } from "effect";
import * as Context from "effect/Context";
import {
  IncidentId,
  type IncidentId as IncidentIdType,
  IncidentTitle,
  type IncidentTitle as IncidentTitleType,
  type Severity,
  type Status,
  IncidentNotFound,
  InvalidTransition,
} from "../errors/incidents";

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
  readonly id: IncidentIdType;
  readonly title: IncidentTitleType;
  readonly severity: Severity;
  readonly status: Status;
  readonly timeline: ReadonlyArray<TimelineEntry>;
  readonly createdAt: Date;
}

export interface IncidentService {
  readonly list: Effect.Effect<ReadonlyArray<Incident>>;
  readonly get: (id: IncidentIdType) => Effect.Effect<Incident, IncidentNotFound>;
  readonly create: (params: {
    readonly title: IncidentTitleType;
    readonly severity: Severity;
  }) => Effect.Effect<Incident>;
  readonly transition: (
    id: IncidentIdType,
    to: Status,
  ) => Effect.Effect<Incident, InvalidTransition | IncidentNotFound>;
  readonly addTimelineEntry: (
    id: IncidentIdType,
    message: string,
  ) => Effect.Effect<void, IncidentNotFound>;
}

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export class Incidents extends Context.Service<
  Incidents,
  {
    /** Initializes the repository on first request and reuses it for this Layer acquisition. */
    readonly acquire: Effect.Effect<IncidentService>;
  }
>()("incident/Incidents") {}

// ---------------------------------------------------------------------------
// Mock implementation (in-memory)
// ---------------------------------------------------------------------------

const now: Effect.Effect<Date> = DateTime.nowAsDate;

const seed: ReadonlyArray<Incident> = [
  {
    id: IncidentId.make(1),
    title: IncidentTitle.make("API latency spike"),
    severity: "SEV-2",
    status: "Investigating",
    timeline: [
      { timestamp: new Date("2026-01-15T14:02:00Z"), message: "Incident created" },
      { timestamp: new Date("2026-01-15T14:03:00Z"), message: "Investigating" },
    ],
    createdAt: new Date("2026-01-15T14:02:00Z"),
  },
  {
    id: IncidentId.make(2),
    title: IncidentTitle.make("DB connection pool exhaustion"),
    severity: "SEV-1",
    status: "Detected",
    timeline: [{ timestamp: new Date("2026-01-15T14:05:00Z"), message: "Incident created" }],
    createdAt: new Date("2026-01-15T14:05:00Z"),
  },
  {
    id: IncidentId.make(3),
    title: IncidentTitle.make("Auth service 503"),
    severity: "SEV-3",
    status: "Resolved",
    timeline: [
      { timestamp: new Date("2026-01-15T13:50:00Z"), message: "Incident created" },
      { timestamp: new Date("2026-01-15T13:52:00Z"), message: "Investigating" },
      { timestamp: new Date("2026-01-15T13:55:00Z"), message: "Identified" },
      { timestamp: new Date("2026-01-15T13:58:00Z"), message: "Monitoring" },
      { timestamp: new Date("2026-01-15T14:00:00Z"), message: "Resolved" },
    ],
    createdAt: new Date("2026-01-15T13:50:00Z"),
  },
];

const cloneIncident = (incident: Incident): Incident => ({
  ...incident,
  timeline: incident.timeline.map(({ timestamp, message }) => ({
    timestamp: new Date(timestamp.getTime()),
    message,
  })),
  createdAt: new Date(incident.createdAt.getTime()),
});

const makeMemory = (): IncidentService => {
  const store = new Map<IncidentIdType, Incident>(
    seed.map((incident) => {
      const copy = cloneIncident(incident);
      return [copy.id, copy];
    }),
  );
  let nextId = 4;

  const lookup = (id: IncidentIdType): Effect.Effect<Incident, IncidentNotFound> =>
    Effect.suspend(() => {
      const incident = store.get(id);
      return incident !== undefined
        ? Effect.succeed(incident)
        : Effect.fail(new IncidentNotFound({ id }));
    });

  return {
    list: Effect.sync(() => [...store.values()]),

    get: lookup,

    create: ({ title, severity }) =>
      Effect.gen(function* () {
        const ts = yield* now;
        const id = IncidentId.make(nextId++);
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
        const ts = yield* now;
        // Read, validate, and publish in one synchronous turn. Clock acquisition
        // may suspend; no stale repository snapshot may cross that boundary.
        return yield* Effect.suspend(
          (): Effect.Effect<Incident, IncidentNotFound | InvalidTransition> => {
            const incident = store.get(id);
            if (incident === undefined) return Effect.fail(new IncidentNotFound({ id }));
            const valid = TRANSITIONS[incident.status];
            if (!valid.includes(to))
              return Effect.fail(
                new InvalidTransition({ from: incident.status, to, validNext: valid }),
              );
            const updated: Incident = {
              ...incident,
              status: to,
              timeline: [...incident.timeline, { timestamp: ts, message: to }],
            };
            store.set(id, updated);
            return Effect.succeed(updated);
          },
        );
      }),

    addTimelineEntry: (id, message) =>
      Effect.gen(function* () {
        const ts = yield* now;
        return yield* Effect.suspend(() => {
          const incident = store.get(id);
          if (incident === undefined) return Effect.fail(new IncidentNotFound({ id }));
          const updated: Incident = {
            ...incident,
            timeline: [...incident.timeline, { timestamp: ts, message }],
          };
          store.set(id, updated);
          return Effect.void;
        });
      }),
  };
};

export namespace Incidents {
  export const make = makeMemory;

  export const layer = Layer.effect(
    Incidents,
    Effect.cached(Effect.sync(make)).pipe(Effect.map((acquire) => Incidents.of({ acquire }))),
  );
}
