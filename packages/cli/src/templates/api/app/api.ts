import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiBuilder,
  HttpApiClient,
  FetchHttpClient,
} from "@effect/platform";
import { Context, Effect, Layer, Schema } from "effect";
import { Status, Severity, IncidentNotFound, InvalidTransition } from "./errors/incidents";
import { Incidents, IncidentsLive, type Incident as ServiceIncident } from "./services/incidents";

// =============================================================================
// API Schemas
// =============================================================================

export const TimelineEntry = Schema.Struct({
  timestamp: Schema.String,
  message: Schema.String,
});
export type TimelineEntry = typeof TimelineEntry.Type;

export const Incident = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  severity: Severity,
  status: Status,
  timeline: Schema.Array(TimelineEntry),
  createdAt: Schema.String,
});
export type Incident = typeof Incident.Type;

export const CreateIncident = Schema.Struct({
  title: Schema.String,
  severity: Severity,
});
export type CreateIncident = typeof CreateIncident.Type;

const TransitionInput = Schema.Struct({
  to: Status,
});

// =============================================================================
// API Groups
// =============================================================================

const Hello = Schema.Struct({ message: Schema.String });

class HelloGroup extends HttpApiGroup.make("hello")
  .add(HttpApiEndpoint.get("greet", "/hello").addSuccess(Hello))
  .prefix("/api") {}

class IncidentsGroup extends HttpApiGroup.make("incidents")
  .add(HttpApiEndpoint.get("list", "/incidents").addSuccess(Schema.Array(Incident)))
  .add(
    HttpApiEndpoint.get("get", "/incidents/:id")
      .setPath(Schema.Struct({ id: Schema.NumberFromString }))
      .addSuccess(Incident)
      .addError(IncidentNotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post("create", "/incidents")
      .setPayload(CreateIncident)
      .addSuccess(Incident, { status: 201 }),
  )
  .add(
    HttpApiEndpoint.post("transition", "/incidents/:id/transition")
      .setPath(Schema.Struct({ id: Schema.NumberFromString }))
      .setPayload(TransitionInput)
      .addSuccess(Incident)
      .addError(InvalidTransition, { status: 422 })
      .addError(IncidentNotFound, { status: 404 }),
  )
  .prefix("/api") {}

class Api extends HttpApi.make("app").add(HelloGroup).add(IncidentsGroup) {}

// =============================================================================
// Helpers
// =============================================================================

const toWire = (i: ServiceIncident): typeof Incident.Type => ({
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
    .handle("get", ({ path }) =>
      Effect.gen(function* () {
        const svc = yield* Incidents;
        return toWire(yield* svc.get(path.id));
      }),
    )
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* Incidents;
        return toWire(yield* svc.create(payload));
      }),
    )
    .handle("transition", ({ path, payload }) =>
      Effect.gen(function* () {
        const svc = yield* Incidents;
        return toWire(yield* svc.transition(path.id, payload.to));
      }),
    ),
);

// Default export: composed Layer<HttpApi.Api> — the framework reads this.
export default HttpApiBuilder.api(Api).pipe(
  Layer.provide(HelloLive),
  Layer.provide(IncidentsHandlers),
  Layer.provide(IncidentsLive),
);

// =============================================================================
// Typed API Client
// =============================================================================

const _client = HttpApiClient.make(Api, { baseUrl: "" });
type ApiClientService = Effect.Effect.Success<typeof _client>;

/** Tag for the typed API client. Yield in effects to get the client. */
export class ApiClient extends Context.Tag("ApiClient")<ApiClient, ApiClientService>() {}

/** Layer that creates the ApiClient using FetchHttpClient. */
export const ApiClientLive = Layer.effect(
  ApiClient,
  _client.pipe(Effect.provide(FetchHttpClient.layer)),
);
