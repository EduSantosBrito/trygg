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
- Name events by domain and phase, for example `resource.fetch.success` or `router.navigate.stateApplied`.
- Include enough fields to explain the operation in one record: identifiers, trigger, outcome, counts, duration, and error details where relevant.
- Prefer stable, queryable field names like `signal_id`, `path`, `listener_count`, `reason`, `error`, `duration_ms`.
- Keep event ownership singular: one framework state transition should have one canonical emitter.

## How To Add A New Wide Event

1. Add the event name and metadata to `packages/core/src/trace/catalog.ts`.
2. Emit it at the operation boundary with `yield* Trace.emit("event.name", () => ({ ... }))`.
3. If the operation is long-running or nested, use `Trace.withAction(...)` or Effect spans where appropriate.
4. Verify the event through `Trace.makeRecorder` + `Trace.record` or `trygg/testing.withRecording`.
5. Add or update tests for the emitted event and its key fields.
6. Update source-owned trace/debug docs if the new event changes the debugging contract or recommended workflow.

## Implementation Notes

- `Trace.emit` is the main entry point for framework instrumentation.
- The catalog is the typed event vocabulary; do not invent ad-hoc strings outside it.
- `Debug.consoleLogger` / `Debug.layer` are human-facing Effect loggers over the trace stream.
- Tests should prefer scoped recorders over process-global state.
- Metrics complements wide events; it does not replace them.

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

- Trace catalog and recorder: `packages/core/src/trace/`
- Human console output: `packages/core/src/debug/debug.ts` and `packages/core/src/debug/debug.docs.md`
- Metrics public surface: `packages/core/src/debug/metrics.docs.md`
