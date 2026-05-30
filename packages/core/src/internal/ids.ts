/**
 * Monotonic internal identifier generators.
 *
 * @remarks
 * These counters allocate stable, unique-per-run identifiers that framework
 * internals attach to trace payloads (signals, navigations, provider
 * boundaries). They are pure counters with no dependency on the trace or debug
 * subsystems, so hot paths can mint IDs without importing logging machinery.
 *
 * @internal
 */

let signalCounter = 0;
let traceCounter = 0;
let spanCounter = 0;
let providerCounter = 0;

/** Allocate a fresh signal identifier (`sig_N`). */
export const nextSignalId = (): string => `sig_${++signalCounter}`;

/** Allocate a fresh navigation-trace identifier (`trace_N`). */
export const nextTraceId = (): string => `trace_${++traceCounter}`;

/** Allocate a fresh span identifier (`span_N`). */
export const nextSpanId = (): string => `span_${++spanCounter}`;

/** Allocate a fresh provider-boundary identifier (`provider_N`). */
export const nextProviderId = (): string => `provider_${++providerCounter}`;
