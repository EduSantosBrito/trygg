# Observability

## Why

- Follow the wide-event model from `loggingsucks.com`: do not scatter debugging context across many tiny log lines.
- In trygg, debugging usually needs operation context, not step-by-step narration. A signal update, render pass, router navigation, or resource fetch is only useful when emitted with enough fields to explain what happened.
- Wide events fit this repo because the framework is reactive and effectful. One operation can cross signals, renders, router state, spans, and async boundaries. Narrow logs lose that context fast.
- Prefer one structured event that answers the debugging question over many string logs that require reconstruction later.

## When To Add A New Wide Event

- Add an event when a meaningful operation boundary exists and the current event set cannot explain it.
- Add an event when a failure, cancellation, retry, cleanup, or state transition would otherwise be opaque.
- Add an event when callers will need to correlate behavior across reactive or async boundaries.
- Add an event when a metric alone is not enough because you also need per-occurrence context.
- Do not add an event for every internal step. If two events only narrate implementation details and do not improve diagnosis, do not add them.

## Event Shape Rules

- Emit structured events, never free-form debug strings.
- Name events by domain and phase, for example `resource.fetch.success` or `router.navigate.complete`.
- Include enough fields to explain the operation in one record: identifiers, trigger, outcome, counts, duration, and error details where relevant.
- Prefer stable, queryable field names like `signal_id`, `path`, `listener_count`, `reason`, `error`, `duration_ms`.
- Include business or framework context that would matter during diagnosis, not incidental implementation trivia.
- Reuse existing trace context instead of inventing parallel correlation fields when `traceId` / `spanId` already solve it.

## How To Add A New Wide Event

1. Define the event shape in `packages/core/src/debug/debug.ts`.
2. Add the new event type to the `DebugEvent` union so it becomes part of the typed public surface.
3. Emit it at the operation boundary with `yield* Debug.log({ ... })`.
4. If the operation is long-running or nested, wrap the work in `Debug.withSpan(...)` or attach it to an existing trace flow.
5. Verify the event is visible through existing consumers like `DevMode`, custom plugins, or collector plugins.
6. Add or update tests for the emitted event and its key fields.
7. Update source-owned debug docs if the new event changes the public debugging contract or recommended workflow.

## Implementation Notes

- `Debug.log` is the main entry point for custom instrumentation.
- `Debug.log` only accepts known `EventType` values, so adding a new event starts in `packages/core/src/debug/debug.ts`.
- `Debug.withSpan` and `Debug.setTraceId` are the preferred trace helpers.
- `DevMode` is the simplest way to inspect events during app development.
- `Metrics` complements wide events; it does not replace them.

## Good Candidates

- State transitions with user-visible consequences.
- Retries, interruptions, timeouts, and fallbacks.
- Cache hits vs misses when behavior diverges.
- Cleanup paths where leaks or stale subscriptions are plausible.
- Expensive operations where `duration_ms` changes debugging value.

## Bad Candidates

- Temporary implementation breadcrumbs.
- Repeating logs that only say a function was entered.
- Events that duplicate an existing event without adding new context.
- Low-value chatter that can be derived from surrounding events.

## Source Of Truth

- Philosophy and public debug surface: `packages/core/src/debug/debug.docs.md`
- Metrics public surface: `packages/core/src/debug/metrics.docs.md`
- Event union, `EventType`, `LogInput`, spans, plugins: `packages/core/src/debug/debug.ts`
- `DevMode` API: `packages/core/src/components/dev-mode.ts`
- Metrics exports and sinks: `packages/core/src/debug/metrics.ts`
