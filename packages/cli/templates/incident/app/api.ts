import { Effect, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import {
  IncidentId,
  IncidentIdFromString,
  IncidentTimestamp,
  IncidentTitle,
  IncidentNotFound,
  InvalidTransition,
  Status,
  Severity,
} from "./errors/incidents";
import {
  TokenMutationPolicyLive,
  MutationAuthorization,
  MutationPrincipal,
} from "./services/authorization";
import { Incidents, type Incident as ServiceIncident } from "./services/incidents";

// =============================================================================
// API Schemas
// =============================================================================

export const TimelineEntry = Schema.Struct({
  timestamp: IncidentTimestamp,
  message: Schema.String,
});
export type TimelineEntry = Schema.Schema.Type<typeof TimelineEntry>;

export const Incident = Schema.Struct({
  id: IncidentId,
  title: IncidentTitle,
  severity: Severity,
  status: Status,
  timeline: Schema.Array(TimelineEntry),
  createdAt: IncidentTimestamp,
});
export type Incident = Schema.Schema.Type<typeof Incident>;

export const CreateIncident = Schema.Struct({
  title: IncidentTitle,
  severity: Severity,
});
export type CreateIncident = Schema.Schema.Type<typeof CreateIncident>;

const TransitionInput = Schema.Struct({
  to: Status,
});

// =============================================================================
// API Groups
// =============================================================================

const Hello = Schema.Struct({ message: Schema.String });

const HelloGroup = HttpApiGroup.make("hello")
  .add(HttpApiEndpoint.get("greet", "/hello", { success: Hello }))
  .prefix("/api");

const IncidentsGroup = HttpApiGroup.make("incidents")
  .add(HttpApiEndpoint.get("list", "/incidents", { success: Schema.Array(Incident) }))
  .add(
    HttpApiEndpoint.get("get", "/incidents/:id", {
      params: Schema.Struct({ id: IncidentIdFromString }),
      success: Incident,
      error: HttpApiSchema.status(404)(IncidentNotFound),
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/incidents", {
      payload: CreateIncident,
      success: HttpApiSchema.status(201)(Incident),
    }).middleware(MutationAuthorization),
  )
  .add(
    HttpApiEndpoint.post("transition", "/incidents/:id/transition", {
      params: Schema.Struct({ id: IncidentIdFromString }),
      payload: TransitionInput,
      success: Incident,
      error: [
        HttpApiSchema.status(422)(InvalidTransition),
        HttpApiSchema.status(404)(IncidentNotFound),
      ],
    }).middleware(MutationAuthorization),
  )
  .prefix("/api");

export const Api = HttpApi.make("app").add(HelloGroup).add(IncidentsGroup);

// =============================================================================
// Helpers
// =============================================================================

const toWire = (i: ServiceIncident): Incident => ({
  id: i.id,
  title: i.title,
  severity: i.severity,
  status: i.status,
  timeline: i.timeline.map(({ timestamp, message }) => ({
    timestamp: new Date(timestamp.getTime()),
    message,
  })),
  createdAt: new Date(i.createdAt.getTime()),
});

// =============================================================================
// Handlers
// =============================================================================

const helloHttpLayer = HttpApiBuilder.group(Api, "hello", (handlers) =>
  handlers.handle("greet", () => Effect.succeed({ message: "Hello from trygg!" })),
);

export namespace IncidentsHttp {
  export const layer = HttpApiBuilder.group(
    Api,
    "incidents",
    Effect.fn("IncidentsHttp")(function* (handlers) {
      const incidents = yield* Incidents;

      return handlers
        .handle("list", () =>
          incidents.acquire.pipe(
            Effect.flatMap((service) => service.list),
            Effect.map((items) => items.map(toWire)),
          ),
        )
        .handle("get", ({ params }) =>
          incidents.acquire.pipe(
            Effect.flatMap((service) => service.get(params.id)),
            Effect.map(toWire),
          ),
        )
        .handle("create", ({ payload }) =>
          Effect.gen(function* () {
            yield* MutationPrincipal;
            const svc = yield* incidents.acquire;
            return toWire(yield* svc.create(payload));
          }),
        )
        .handle("transition", ({ params, payload }) =>
          Effect.gen(function* () {
            yield* MutationPrincipal;
            const svc = yield* incidents.acquire;
            return toWire(yield* svc.transition(params.id, payload.to));
          }),
        );
    }),
  );
}

// Default export: composed API layer — the framework reads this.
export default HttpApiBuilder.layer(Api).pipe(
  Layer.provide(helloHttpLayer),
  Layer.provide(IncidentsHttp.layer),
  Layer.provide(MutationAuthorization.layer),
  Layer.provide(TokenMutationPolicyLive),
  Layer.provide(Incidents.layer),
);
