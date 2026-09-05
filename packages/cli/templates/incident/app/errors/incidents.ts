import { Schema } from "effect";

/** Bounded bearer credential syntax; validate without exposing rejected values in errors. */
export const MutationToken = Schema.String.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(512),
  Schema.isPattern(/^[A-Za-z0-9\-._~+/]+=*$/),
);

export const IncidentId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("IncidentId"),
);
export type IncidentId = Schema.Schema.Type<typeof IncidentId>;

export const IncidentIdFromString = Schema.FiniteFromString.pipe(Schema.decodeTo(IncidentId));

export const IncidentTitle = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120)).pipe(
  Schema.brand("IncidentTitle"),
);
export type IncidentTitle = Schema.Schema.Type<typeof IncidentTitle>;

/** Canonical timestamp codec for incident HTTP payloads. */
export const IncidentTimestamp = Schema.DateFromString;
export type IncidentTimestamp = Schema.Schema.Type<typeof IncidentTimestamp>;

export const Status = Schema.Union([
  Schema.Literal("Detected"),
  Schema.Literal("Investigating"),
  Schema.Literal("Identified"),
  Schema.Literal("Monitoring"),
  Schema.Literal("Resolved"),
]);
export type Status = Schema.Schema.Type<typeof Status>;

export const Severity = Schema.Union([
  Schema.Literal("SEV-1"),
  Schema.Literal("SEV-2"),
  Schema.Literal("SEV-3"),
  Schema.Literal("SEV-4"),
]);
export type Severity = Schema.Schema.Type<typeof Severity>;

export class InvalidTransition extends Schema.TaggedError<InvalidTransition>()(
  "InvalidTransition",
  {
    from: Status,
    to: Status,
    validNext: Schema.Array(Status),
  },
) {}

export class IncidentNotFound extends Schema.TaggedError<IncidentNotFound>()("IncidentNotFound", {
  id: IncidentId,
}) {}

export class MutationForbidden extends Schema.TaggedError<MutationForbidden>()(
  "MutationForbidden",
  { message: Schema.String },
) {}

export class MutationUnauthenticated extends Schema.TaggedError<MutationUnauthenticated>()(
  "MutationUnauthenticated",
  { message: Schema.String },
) {}

export class MutationAuthenticationUnavailable extends Schema.TaggedError<MutationAuthenticationUnavailable>()(
  "MutationAuthenticationUnavailable",
  { message: Schema.String },
) {}
