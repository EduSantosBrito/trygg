# Tutorial: build an incident tracker

This tutorial builds a small but real feature end to end: a list of incidents, a detail page for each one, a service that owns the data, a resource that fetches it, and a typed error boundary when an id does not exist. By the end you will have seen how routing, services, resources, signals, and error handling fit together — the whole trygg model on one page.

We build from the blank starter. Scaffold it and start the dev server:

```bash
bunx create-trygg@canary incident-tracker
cd incident-tracker
bun install
bun run dev
```

> Want the finished, full-stack version with an HTTP API instead of an in-memory service? Run the scaffolder again and choose the **incident** template. This tutorial builds the same shape by hand so each layer is visible.

## Step 1 — Model the domain

Start with the data. Severity and status are closed sets, so model them as schema unions and derive the TypeScript types from them. A missing incident is a typed, tagged error — not a thrown exception.

```ts
// app/domain/incidents.ts
import { Schema } from "effect";

export const Severity = Schema.Union([
  Schema.Literal("SEV-1"),
  Schema.Literal("SEV-2"),
  Schema.Literal("SEV-3"),
]);
export type Severity = Schema.Schema.Type<typeof Severity>;

export const Status = Schema.Union([
  Schema.Literal("Investigating"),
  Schema.Literal("Resolved"),
]);
export type Status = Schema.Schema.Type<typeof Status>;

export interface Incident {
  readonly id: number;
  readonly title: string;
  readonly severity: Severity;
  readonly status: Status;
}

export class IncidentNotFound extends Schema.TaggedErrorClass<IncidentNotFound>()(
  "IncidentNotFound",
  { id: Schema.Number },
) {}
```

## Step 2 — A service owns the data

The data lives behind a service, not in a component. The service is an ordinary Effect `Context.Service`: its interface exposes `list` (an Effect that yields all incidents) and `get` (which can fail with `IncidentNotFound`). The live implementation seeds an in-memory store; swapping it for a database or an HTTP client later changes nothing about the components.

```ts
// app/services/incidents.ts
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { type Incident, IncidentNotFound } from "../domain/incidents";

export interface IncidentService {
  readonly list: Effect.Effect<ReadonlyArray<Incident>>;
  readonly get: (id: number) => Effect.Effect<Incident, IncidentNotFound>;
}

export class Incidents extends Context.Service<
  Incidents,
  {
    readonly list: Effect.Effect<ReadonlyArray<Incident>>;
    readonly get: (id: number) => Effect.Effect<Incident, IncidentNotFound>;
  }
>()("app/Incidents") {}

const seed: ReadonlyArray<Incident> = [
  { id: 1, title: "API latency spike", severity: "SEV-2", status: "Investigating" },
  { id: 2, title: "Auth service 503", severity: "SEV-1", status: "Resolved" },
];

const makeIncidents = (): IncidentService => {
  const store = new Map<number, Incident>(seed.map((incident) => [incident.id, incident]));

  return {
    list: Effect.sync(() => [...store.values()]),
    get: (id) => {
      const incident = store.get(id);
      return incident !== undefined
        ? Effect.succeed(incident)
        : Effect.fail(new IncidentNotFound({ id }));
    },
  };
};

export const IncidentsLive = Layer.succeed(Incidents, makeIncidents());
```

## Step 3 — A resource fetches it

A `Resource` is async data with a cache key. The fetcher reads the `Incidents` service from context — so the resource *requires* `Incidents`, and that requirement will propagate to any component that fetches it. The list resource is static; the detail resource is a factory keyed by id, so each id caches independently.

```ts
// app/resources/incidents.ts
import { Effect } from "effect";
import { Resource } from "trygg";
import { Incidents } from "../services/incidents";

export const incidentsResource = Resource.make(
  () =>
    Effect.gen(function* () {
      const incidents = yield* Incidents;
      return yield* incidents.list;
    }),
  { key: "incidents.list" },
);

export const incidentResource = Resource.make(
  (params: { id: number }) =>
    Effect.gen(function* () {
      const incidents = yield* Incidents;
      return yield* incidents.get(params.id);
    }),
  { key: (params) => Resource.hash("incidents.get", params) },
);
```

## Step 4 — The list page

`Resource.fetch` returns a Signal of the resource's state. Derive the array out of it for the success case, then render with `Resource.match`: one branch per state, `Resource.exhaustive` to force you to handle all three. `Signal.each` renders the keyed list, patching only the rows that change.

```tsx
// app/pages/incidents.tsx
import { Component, Resource, Signal, type ComponentProps } from "trygg";
import * as Router from "trygg/router";
import { incidentsResource } from "../resources/incidents";
import { type Incident } from "../domain/incidents";

const EMPTY: ReadonlyArray<Incident> = [];

export default Component.gen(function* () {
  const state = yield* Resource.fetch(incidentsResource);
  const incidents = yield* Signal.derive(state, (s) => (Resource.isSuccess(s) ? s.value : EMPTY));

  return yield* Resource.match(state).pipe(
    Resource.on("Pending", () => <p>Loading incidents…</p>),
    Resource.on("Success", () => (
      <ul>
        {Signal.each(incidents, (incident) => <IncidentRow incident={incident} />, {
          key: (incident: Incident) => incident.id,
        })}
      </ul>
    )),
    Resource.on("Failure", () => (
      <p role="alert">
        Could not load incidents.{" "}
        <button onClick={() => Resource.refresh(incidentsResource)}>Retry</button>
      </p>
    )),
    Resource.exhaustive,
  );
});

const IncidentRow = Component.gen(function* (Props: ComponentProps<{ incident: Incident }>) {
  const { incident } = yield* Props;

  return (
    <li>
      <Router.Link to="/incidents/:id" params={{ id: String(incident.id) }}>
        INC-{incident.id} — {incident.title} ({incident.severity}, {incident.status})
      </Router.Link>
    </li>
  );
});
```

## Step 5 — The detail page

`Router.params` reads the typed route params. Fetch the detail resource for that id and match again — this time the `Failure` branch receives the typed `IncidentNotFound`, so you can read `error.id` directly with no casting.

```tsx
// app/pages/incident-detail.tsx
import { Component, Resource } from "trygg";
import * as Router from "trygg/router";
import { incidentResource } from "../resources/incidents";
import { type Incident } from "../domain/incidents";

export default Component.gen(function* () {
  const { id } = yield* Router.params("/incidents/:id");
  const numericId = Number(id);
  const state = yield* Resource.fetch(incidentResource({ id: numericId }));

  return yield* Resource.match(state).pipe(
    Resource.on("Pending", () => <p>Loading…</p>),
    Resource.on("Success", ({ value: incident }: { value: Incident; stale: boolean }) => (
      <article>
        <Router.Link to="/incidents">← Incidents</Router.Link>
        <h1>
          INC-{incident.id} — {incident.title}
        </h1>
        <p>Severity: {incident.severity}</p>
        <p>Status: {incident.status}</p>
      </article>
    )),
    Resource.on("Failure", ({ error }) => (
      <article role="alert">
        <Router.Link to="/incidents">← Incidents</Router.Link>
        <h1>Incident not found</h1>
        <p>No incident with id {error.id}.</p>
      </article>
    )),
    Resource.exhaustive,
  );
});
```

## Step 6 — A loading and error boundary

Two small components round out the route states. `LoadingFallback` shows while a route's resources resolve; `RouteErrorView` renders when a route fails to resolve — for example, when the path param fails to decode. It reads the failure from `Router.currentError` and squashes the `Cause` into a single value.

```tsx
// app/components/loading-fallback.tsx
import { Component } from "trygg";

export const LoadingFallback = Component.gen(function* () {
  return <p>Loading…</p>;
});
```

```tsx
// app/components/route-error-view.tsx
import { Cause } from "effect";
import { Component } from "trygg";
import * as Router from "trygg/router";

export const RouteErrorView = Component.gen(function* () {
  const { cause } = yield* Router.currentError;
  const error = Cause.squash(cause);
  const message =
    error instanceof Error ? error.message : "Something failed while loading this route.";

  return (
    <article role="alert">
      <h1>Could not load this page</h1>
      <p>{message}</p>
      <Router.Link to="/incidents">← Back to incidents</Router.Link>
    </article>
  );
});
```

## Step 7 — Wire the routes

Declare the routes with the fluent builder. The detail route decodes `:id` with a schema, so a non-numeric URL is a decode failure that `RouteErrorView` catches instead of a runtime crash.

```ts
// app/routes.ts
import { Schema } from "effect";
import { Route, Routes } from "trygg/router";
import Home from "./pages/home";
import IncidentsList from "./pages/incidents";
import IncidentDetail from "./pages/incident-detail";
import { LoadingFallback } from "./components/loading-fallback";
import { RouteErrorView } from "./components/route-error-view";

export const routes = Routes.make()
  .add(Route.make("/").component(Home))
  .add(Route.make("/incidents").component(IncidentsList).loading(LoadingFallback))
  .add(
    Route.make("/incidents/:id")
      .params(Schema.Struct({ id: Schema.NumberFromString }))
      .component(IncidentDetail)
      .loading(LoadingFallback)
      .error(RouteErrorView),
  );
```

## Step 8 — Provide the service once, at the root

Here is the step that ties it together. The resources require `Incidents`; `Resource.fetch` carries that requirement into every page that fetches. Provide the `IncidentsLive` Layer once on the root layout, and the requirement is satisfied for the whole subtree — so the tree mounts with `R = never`. Forget it and the `mount` boundary is a **type error**, not a runtime surprise.

```tsx
// app/layout.tsx
import "../styles.css";
import { Component } from "trygg";
import * as Router from "trygg/router";
import { IncidentsLive } from "./services/incidents";

export default Component.gen(function* () {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Incident tracker</title>
      </head>
      <body>
        <Router.Outlet />
      </body>
    </html>
  );
}).pipe(Component.provide(IncidentsLive));
```

`Component.provide` owns the Layer's scope: the service is created when the layout mounts and disposed when it unmounts, so the in-memory store persists across every navigation between the list and detail pages.

## Run it

With the dev server still running, open `http://localhost:5173`. Visit `/incidents` to see the list, click a row to open its detail page, and try `/incidents/99` to watch the typed `IncidentNotFound` branch render — then `/incidents/not-a-number` to see `RouteErrorView` catch the decode failure.

## Where to go next

- [Resources](/docs/resources) — cache keys, invalidation, refresh, and stale-while-revalidate.
- [Error boundaries](/docs/error-boundary) — typed recovery beyond the route `.error` hook.
- [Defining routes](/docs/router/routes) and [Layouts](/docs/router/layouts) — nested routes and shared chrome through the outlet.
- [Forms and inputs](/docs/patterns/forms) — add a "declare incident" form that calls a service method.
- [API types](/docs/api-types) — promote the in-memory service to a real HTTP API with a generated, same-origin client (this is what the **incident** template does).
