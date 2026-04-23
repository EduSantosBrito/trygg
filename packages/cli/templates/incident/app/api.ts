import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";
import { FetchHttpClient } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import { Status, Severity } from "./errors/incidents";
import { Incidents, IncidentsLive, type Incident as ServiceIncident } from "./services/incidents";

// =============================================================================
// API Schemas
// =============================================================================

export const TimelineEntry = Schema.Struct({
  timestamp: Schema.String,
  message: Schema.String,
});
export type TimelineEntry = Schema.Schema.Type<typeof TimelineEntry>;

export const Incident = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  severity: Severity,
  status: Status,
  timeline: Schema.Array(TimelineEntry),
  createdAt: Schema.String,
});
export type Incident = Schema.Schema.Type<typeof Incident>;

export const CreateIncident = Schema.Struct({
  title: Schema.String,
  severity: Severity,
});
export type CreateIncident = Schema.Schema.Type<typeof CreateIncident>;

const TransitionInput = Schema.Struct({
  to: Status,
});

const IncidentNotFoundSchema = Schema.TaggedStruct("IncidentNotFound", {
  id: Schema.Number,
});

const InvalidTransitionSchema = Schema.TaggedStruct("InvalidTransition", {
  from: Status,
  to: Status,
  validNext: Schema.Array(Status),
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
      params: Schema.Struct({ id: Schema.NumberFromString }),
      success: Incident,
      error: HttpApiSchema.status(404)(IncidentNotFoundSchema),
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/incidents", {
      payload: CreateIncident,
      success: HttpApiSchema.status(201)(Incident),
    }),
  )
  .add(
    HttpApiEndpoint.post("transition", "/incidents/:id/transition", {
      params: Schema.Struct({ id: Schema.NumberFromString }),
      payload: TransitionInput,
      success: Incident,
      error: [
        HttpApiSchema.status(422)(InvalidTransitionSchema),
        HttpApiSchema.status(404)(IncidentNotFoundSchema),
      ],
    }),
  )
  .prefix("/api");

const Api = HttpApi.make("app").add(HelloGroup).add(IncidentsGroup);

// =============================================================================
// Helpers
// =============================================================================

const toWire = (i: ServiceIncident): Incident => ({
  id: i.id,
  title: i.title,
  severity: i.severity,
  status: i.status,
  timeline: i.timeline.map((e) => ({
    timestamp: e.timestamp.toISOString(),
    message: e.message,
  })),
  createdAt: i.createdAt.toISOString(),
});

// =============================================================================
// Handlers
// =============================================================================

const HelloLive = HttpApiBuilder.group(Api, "hello", (handlers) =>
  handlers.handle("greet", () => Effect.succeed({ message: "Hello from trygg!" })),
);

const IncidentsHandlers = HttpApiBuilder.group(Api, "incidents", (handlers) =>
  handlers
    .handle("list", () =>
      Effect.gen(function* () {
        const svc = yield* Incidents;
        const list = yield* svc.list;
        return list.map(toWire);
      }),
    )
    .handle("get", ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* Incidents;
        return toWire(yield* svc.get(params.id));
      }),
    )
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* Incidents;
        return toWire(yield* svc.create(payload));
      }),
    )
    .handle("transition", ({ params, payload }) =>
      Effect.gen(function* () {
        const svc = yield* Incidents;
        return toWire(yield* svc.transition(params.id, payload.to));
      }),
    ),
);

// Default export: composed API layer — the framework reads this.
export default HttpApiBuilder.layer(Api).pipe(
  Layer.provide(HelloLive),
  Layer.provide(IncidentsHandlers),
  Layer.provide(IncidentsLive),
);

// =============================================================================
// Typed API Client
// =============================================================================

const _client = HttpApiClient.make(Api, { baseUrl: "" });
type ApiClientService = HttpApiClient.ForApi<typeof Api>;

/** Tag for the typed API client. Yield in effects to get the client. */
export class ApiClient extends Context.Service<ApiClient, ApiClientService>()("ApiClient") {}

/** Layer that creates the ApiClient using FetchHttpClient. */
export const ApiClientLive = Layer.effect(
  ApiClient,
  _client.pipe(Effect.provide(FetchHttpClient.layer)),
);
