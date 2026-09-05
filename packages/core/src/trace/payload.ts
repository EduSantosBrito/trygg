import { Cause, Schema, type Exit } from "effect";
import type { TraceEventName } from "./catalog.js";

const Key = Schema.Union([Schema.String, Schema.Number]);
const Keys = Schema.Array(Key);
const OptionalString = Schema.optional(Schema.String);
const OptionalNumber = Schema.optional(Schema.Number);
const OptionalBoolean = Schema.optional(Schema.Boolean);
const ValueType = Schema.Literals([
  "null",
  "undefined",
  "boolean",
  "number",
  "bigint",
  "string",
  "symbol",
  "function",
  "object",
]);
const OptionalValueType = Schema.optional(ValueType);

export type TraceValueType = typeof ValueType.Type;

/** Trap-free opaque classification for live application values. */
export const valueType = (value: unknown): TraceValueType =>
  value === null ? "null" : typeof value;

/** Classify the first non-container value in a framework-owned Cause. */
export const causeValueType = <E>(cause: Cause.Cause<E>): TraceValueType => {
  const reason = cause.reasons[0];
  if (reason === undefined || Cause.isInterruptReason(reason)) return "undefined";
  return valueType(Cause.isFailReason(reason) ? reason.error : reason.defect);
};

/** Event-specific payload schemas. Events omitted from this table carry no payload. */
export const TRACE_PAYLOAD_SCHEMAS = {
  "contract.action.start": Schema.Struct({
    actionId: Schema.String,
    facts: Schema.JsonObject,
  }),
  "contract.action.end": Schema.Struct({
    actionId: Schema.String,
    status: Schema.Literals(["completed", "failed", "interrupted"]),
  }),

  "event.preventDefault": Schema.Struct({ eventType: Schema.String, target: Schema.String }),

  "router.navigate.request": Schema.Struct({
    fromPath: Schema.String,
    toPath: Schema.String,
    replace: Schema.Boolean,
  }),
  "router.navigate.commit": Schema.Struct({ path: Schema.String, query: Schema.String }),
  "router.navigate.stateApplied": Schema.Struct({ path: Schema.String }),
  "router.current.set": Schema.Struct({ fromPath: Schema.String, toPath: Schema.String }),
  "router.query.set": Schema.Struct({
    fromQuery: Schema.String,
    toQuery: Schema.String,
    changed: Schema.Boolean,
    notified: Schema.Boolean,
  }),
  "history.push": Schema.Struct({ path: Schema.String }),
  "history.replace": Schema.Struct({ path: Schema.String }),
  "history.back": Schema.Struct({ fromPath: Schema.String, toPath: Schema.String }),
  "history.forward": Schema.Struct({ fromPath: Schema.String, toPath: Schema.String }),

  "router.link.click": Schema.Struct({
    to_path: Schema.String,
    replace: OptionalBoolean,
    reason: OptionalString,
  }),
  "router.prefetch.trigger": Schema.Struct({ path: Schema.String, trigger: Schema.String }),
  "router.prefetch.start": Schema.Struct({ path: Schema.String }),
  "router.prefetch.complete": Schema.Struct({ path: Schema.String }),
  "router.prefetch.error": Schema.Struct({
    path: Schema.String,
    phase: Schema.String,
    error_type: ValueType,
  }),
  "router.prefetch.no_match": Schema.Struct({ path: Schema.String }),
  "router.prefetch.viewport": Schema.Struct({ path: Schema.String }),
  "router.outlet.error": Schema.Struct({
    phase: Schema.String,
    path: Schema.String,
    error_type: ValueType,
  }),
  "router.scroll.save": Schema.Struct({
    key: Schema.String,
    x: Schema.Number,
    y: Schema.Number,
  }),
  "router.scroll.save.error": Schema.Struct({ cause_type: ValueType }),
  "router.scroll.restore": Schema.Struct({
    key: Schema.String,
    x: Schema.Number,
    y: Schema.Number,
  }),
  "router.popstate.error": Schema.Struct({ cause_type: ValueType }),
  "router.error": Schema.Struct({
    operation: Schema.Literals(["publication"]),
    navigation_id: Schema.Number,
    cause_type: ValueType,
    interrupted: Schema.Boolean,
  }),
  "router.viewport.observer.error": Schema.Struct({
    operation: Schema.String,
    cause_type: ValueType,
  }),

  "outlet.process.start": Schema.Struct({
    activationId: Schema.String,
    path: Schema.String,
    query_type: ValueType,
    hasScrollIntent: Schema.Boolean,
  }),
  "outlet.process.commit": Schema.Struct({
    activationId: Schema.String,
    path: Schema.String,
    state: OptionalString,
  }),
  "outlet.process.dropStale": Schema.Struct({
    activationId: Schema.String,
    path: Schema.String,
    supersededBy: Schema.String,
  }),
  "outlet.lazyLeaf.load.start": Schema.Struct({
    activationId: Schema.String,
    path: Schema.String,
  }),
  "outlet.lazyLeaf.load.ready": Schema.Struct({
    activationId: Schema.String,
    path: Schema.String,
  }),
  "outlet.lazyLeaf.load.error": Schema.Struct({
    activationId: OptionalString,
    path: Schema.String,
    cause_type: ValueType,
  }),
  "outlet.match.found": Schema.Struct({
    activationId: Schema.String,
    path: Schema.String,
    routePattern: Schema.String,
  }),
  "outlet.match.notFound": Schema.Struct({
    activationId: Schema.String,
    path: Schema.String,
  }),
  "outlet.boundary.resolve": Schema.Struct({
    activationId: Schema.String,
    path: Schema.String,
    phase: Schema.String,
    outcome: Schema.String,
  }),
  "route.render.skipStale": Schema.Struct({ reason: OptionalString, expectedPath: OptionalString }),
  "route.layout.skipStale": Schema.Struct({ expectedPath: OptionalString }),
  "scroll.apply": Schema.Struct({
    activationId: Schema.String,
    path: Schema.String,
    result_type: ValueType,
  }),

  "asyncLoader.track": Schema.Struct({
    matchKey: Schema.String,
    previousMatchKey: OptionalString,
    epoch: OptionalNumber,
  }),
  "asyncLoader.dedup": Schema.Struct({ matchKey: Schema.String, epoch: OptionalNumber }),
  "asyncLoader.interrupt": Schema.Struct({
    fromMatchKey: OptionalString,
    toMatchKey: Schema.String,
    epoch: OptionalNumber,
  }),
  "asyncLoader.loading": Schema.Struct({ matchKey: Schema.String, epoch: OptionalNumber }),
  "asyncLoader.refreshing": Schema.Struct({
    matchKey: Schema.String,
    hasPrevious: Schema.Boolean,
    epoch: OptionalNumber,
  }),
  "asyncLoader.ready": Schema.Struct({ matchKey: Schema.String, epoch: OptionalNumber }),
  "asyncLoader.dropStale": Schema.Struct({
    matchKey: Schema.String,
    activeMatchKey: OptionalString,
    epoch: OptionalNumber,
  }),
  "asyncLoader.error": Schema.Struct({
    matchKey: Schema.String,
    epoch: OptionalNumber,
    cause_type: ValueType,
  }),

  "provider.acquire": Schema.Struct({
    provider_id: Schema.String,
    component: OptionalString,
    reason: Schema.Literal("mount"),
    duration_ms: Schema.Number,
  }),
  "provider.reuse": Schema.Struct({
    provider_id: Schema.String,
    component: OptionalString,
    reason: Schema.Literal("rerender"),
  }),
  "provider.failure": Schema.Struct({
    provider_id: Schema.String,
    component: OptionalString,
    reason: Schema.Literal("failure"),
    duration_ms: Schema.Number,
    cause_type: ValueType,
  }),
  "provider.replace": Schema.Struct({
    provider_id: Schema.String,
    component: OptionalString,
    reason: Schema.Literals(["key-change", "identity-change"]),
  }),
  "provider.finalize": Schema.Struct({
    provider_id: Schema.String,
    component: OptionalString,
    reason: Schema.Literal("unmount"),
    duration_ms: Schema.Number,
  }),

  "signal.create": Schema.Struct({
    signal_id: Schema.String,
    owner: Schema.String,
    value_type: ValueType,
    component: OptionalString,
  }),
  "signal.dispose": Schema.Struct({
    signal_id: Schema.String,
    owner: Schema.String,
    listener_count: Schema.Number,
  }),
  "signal.disposed_access": Schema.Struct({
    signal_id: Schema.String,
    owner: Schema.String,
    operation: Schema.String,
  }),
  "signal.subscribe": Schema.Struct({ signal_id: Schema.String, listener_count: Schema.Number }),
  "signal.unsubscribe": Schema.Struct({ signal_id: Schema.String, listener_count: Schema.Number }),
  "signal.get": Schema.Struct({ signal_id: Schema.String, trigger: OptionalString }),
  "signal.get.phase": Schema.Struct({ signal_id: Schema.String, has_phase: Schema.Boolean }),
  "signal.peek": Schema.Struct({ signal_id: Schema.String }),
  "signal.set": Schema.Struct({
    signal_id: Schema.String,
    prev_value_type: OptionalValueType,
    value_type: OptionalValueType,
    listener_count: OptionalNumber,
  }),
  "signal.set.skipped": Schema.Struct({
    signal_id: Schema.String,
    value_type: ValueType,
    reason: Schema.Literal("unchanged"),
  }),
  "signal.update": Schema.Struct({
    signal_id: Schema.String,
    prev_value_type: ValueType,
    value_type: ValueType,
    listener_count: Schema.Number,
  }),
  "signal.update.skipped": Schema.Struct({
    signal_id: Schema.String,
    value_type: ValueType,
    reason: Schema.Literal("unchanged"),
  }),
  "signal.notify": Schema.Struct({ signal_id: Schema.String, listener_count: Schema.Number }),
  "signal.listener.error": Schema.Struct({
    signal_id: Schema.String,
    cause_type: ValueType,
    listener_index: Schema.Number,
  }),
  "signal.derive.create": Schema.Struct({
    signal_id: Schema.String,
    source_id: Schema.String,
    value_type: ValueType,
  }),
  "signal.derive.cleanup": Schema.Struct({ signal_id: Schema.String, source_id: Schema.String }),
  "signal.deriveAll.create": Schema.Struct({
    signal_id: Schema.String,
    source_count: Schema.Number,
    value_type: ValueType,
  }),
  "signal.deriveAll.cleanup": Schema.Struct({
    signal_id: Schema.String,
    source_count: Schema.Number,
  }),

  "signalElement.insert": Schema.Struct({ signal_id: Schema.String }),
  "signalElement.reconcile": Schema.Struct({ signal_id: Schema.String }),
  "render.child.reconcile": Schema.Struct({ reconciled: Schema.Boolean }),
  "signalElement.swap.start": Schema.Struct({
    operation: Schema.Literals(["replace", "reconcile"]),
    hasPrevious: OptionalBoolean,
  }),
  "signalElement.swap.render": Schema.Struct({
    operation: Schema.Literals(["replace", "reconcile"]),
    reconciled: OptionalBoolean,
  }),
  "signalElement.swap.dropStale": Schema.Struct({ operation: Schema.String }),
  "signalElement.swap.failBeforeCommit": Schema.Struct({
    operation: Schema.Literals(["replace", "reconcile"]),
    phase: Schema.Literal("render"),
    cause_type: ValueType,
  }),
  "signalElement.swap.commit": Schema.Struct({
    operation: Schema.Literals(["replace", "reconcile"]),
  }),
  "signalElement.swap.error": Schema.Struct({
    signal_id: Schema.String,
    cause_type: ValueType,
  }),
  "signalElement.superseded": Schema.Struct({
    phase: Schema.Literals(["initial", "reconcile"]),
    signal_id: Schema.String,
    cause_type: ValueType,
  }),
  "signalElement.cleanup": Schema.Struct({ operation: Schema.String, reason: Schema.String }),
  "signalText.initial": Schema.Struct({
    signal_id: Schema.String,
    value_type: ValueType,
    element_tag: OptionalString,
    trigger: OptionalString,
  }),
  "signalText.update": Schema.Struct({
    signal_id: Schema.String,
    value_type: ValueType,
    element_tag: OptionalString,
    trigger: OptionalString,
  }),
  "document.render": Schema.Struct({ element_tag: Schema.String, target: Schema.String }),
  "document.signal.initial": Schema.Struct({
    signal_id: Schema.String,
    value_type: ValueType,
    element_tag: Schema.String,
    trigger: Schema.String,
  }),
  "document.signal.update": Schema.Struct({
    signal_id: Schema.String,
    value_type: ValueType,
    element_tag: Schema.String,
    trigger: Schema.String,
  }),
  "component.render": Schema.Struct({ component_type: ValueType }),
  "component.initial": Schema.Struct({
    accessed_signals: Schema.Number,
    duration_ms: Schema.Number,
  }),
  "component.rerender": Schema.Struct({ duration_ms: Schema.Number }),
  "component.rerender.error": Schema.Struct({ cause_type: ValueType }),
  "component.superseded": Schema.Struct({ cause_type: ValueType }),
  "intrinsic.render": Schema.Struct({ element_tag: Schema.String }),
  "safeUrl.blocked": Schema.Struct({
    attribute: Schema.String,
    url: Schema.String,
    allowed_schemes: Schema.Array(Schema.String),
  }),

  "keyedList.state": Schema.Struct({
    phase: Schema.String,
    key_order: Keys,
    new_keys: Schema.optional(Keys),
    move_count: OptionalNumber,
  }),
  "keyedList.update": Schema.Struct({ current_keys: Schema.Number }),
  "keyedList.update.error": Schema.Struct({ cause_type: ValueType }),
  "keyedList.reorder": Schema.Struct({
    total_items: Schema.Number,
    moves: Schema.Number,
    stable_nodes: Schema.Number,
    inserted: OptionalNumber,
    removed: OptionalNumber,
    reconciled: OptionalNumber,
    replaced: OptionalNumber,
  }),
  "keyedList.item.add": Schema.Struct({ key: Key }),
  "keyedList.item.remove": Schema.Struct({ key: Key }),
  "keyedList.item.rerender": Schema.Struct({ key: Key }),
  "keyedList.item.rerender.error": Schema.Struct({ key: Key, cause_type: ValueType }),
  "keyedList.subscription.add": Schema.Struct({ key: Key, signal_id: Schema.String }),
  "keyedList.subscription.remove": Schema.Struct({ key: Key, signal_id: Schema.String }),
  "errorBoundary.caught": Schema.Struct({ cause_type: ValueType }),

  "resource.fetch.start": Schema.Struct({ key: Schema.String }),
  "resource.fetch.starting": Schema.Struct({ key: Schema.String }),
  "resource.fetch.called": Schema.Struct({ key: Schema.String }),
  "resource.fetch.cached": Schema.Struct({ key: Schema.String, state: Schema.String }),
  "resource.fetch.dedupe_wait": Schema.Struct({ key: Schema.String }),
  "resource.fetch.fork_running": Schema.Struct({ key: Schema.String }),
  "resource.fetch.success": Schema.Struct({
    key: Schema.String,
    value_type: ValueType,
  }),
  "resource.fetch.set_success": Schema.Struct({ key: Schema.String }),
  "resource.fetch.error": Schema.Struct({
    key: Schema.String,
    error_type: ValueType,
  }),
  "resource.fetch.set_failure": Schema.Struct({
    key: Schema.String,
    error_type: ValueType,
  }),
  "resource.fetch.interrupted": Schema.Struct({ key: Schema.String }),
  "resource.fetch.defect": Schema.Struct({ key: Schema.String, defect_type: ValueType }),
  "resource.fetch.unhandled": Schema.Struct({
    key: Schema.String,
    error_type: ValueType,
  }),
  "resource.fetch.complete": Schema.Struct({ key: OptionalString }),
  "resource.registry.create_entry": Schema.Struct({ key: Schema.String }),
  "resource.registry.get_existing": Schema.Struct({ key: Schema.String }),

  "api.request.received": Schema.Struct({ method: Schema.String, pathname: Schema.String }),
  "api.handler.loading": Schema.Struct({ module_path: Schema.String }),
  "api.handler.loaded": Schema.Struct({
    module_path: Schema.String,
    module_type: ValueType,
  }),
  "api.middleware.mounted": Schema.Struct({ platform: Schema.String }),

  "effect.fork.scoped": Schema.Struct({ owner: Schema.String, scopeKind: OptionalString }),
  "effect.fiber.interrupt": Schema.Struct({ owner: Schema.String, reason: Schema.String }),
  "effect.scope.close": Schema.Struct({ owner: Schema.String }),
  "effect.error.ignored": Schema.Struct({
    owner: Schema.String,
    operation: Schema.String,
    path: OptionalString,
    cause_type: ValueType,
  }),
  "unsafe.buildContext": Schema.Struct({ layer_count: Schema.Number }),
  "unsafe.mergeLayers": Schema.Struct({ layer_count: Schema.Number }),
} satisfies Partial<Record<TraceEventName, Schema.ConstraintDecoder<unknown, never>>>;

export type TracePayloadEventName = keyof typeof TRACE_PAYLOAD_SCHEMAS;

export type EmptyTracePayload = Readonly<Record<string, never>>;

export type TraceEventPayload<Name extends TraceEventName> = Name extends TracePayloadEventName
  ? Schema.Schema.Type<(typeof TRACE_PAYLOAD_SCHEMAS)[Name]>
  : EmptyTracePayload;

const payloadSchemas: Partial<Record<TraceEventName, Schema.ConstraintDecoder<unknown, never>>> =
  TRACE_PAYLOAD_SCHEMAS;

const EmptyPayloadSchema = Schema.Struct({});

type PayloadDecoder = (input: unknown) => Exit.Exit<unknown, unknown>;

const payloadDecoders = new Map<Schema.ConstraintDecoder<unknown, never>, PayloadDecoder>();

export const tracePayloadSchema = (
  name: TraceEventName,
): Schema.ConstraintDecoder<unknown, never> => payloadSchemas[name] ?? EmptyPayloadSchema;

export const decodeTracePayload = (
  name: TraceEventName,
  input: unknown,
): Exit.Exit<unknown, unknown> => {
  const schema = tracePayloadSchema(name);
  const cached = payloadDecoders.get(schema);
  if (cached !== undefined) return cached(input);

  // oxlint-disable-next-line effect/no-inline-schema-compile -- Runtime-selected event schemas are compiled once and cached by schema identity.
  const decoder: PayloadDecoder = Schema.decodeUnknownExit(schema, {
    onExcessProperty: "error",
  });
  payloadDecoders.set(schema, decoder);
  return decoder(input);
};

export const traceEventRequiresPayload = (name: TraceEventName): boolean =>
  payloadSchemas[name] !== undefined;
