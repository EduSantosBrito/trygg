import { Schema } from "effect";

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

export class InvalidTransition extends Schema.TaggedErrorClass<InvalidTransition>()(
  "InvalidTransition",
  {
    from: Status,
    to: Status,
    validNext: Schema.Array(Status),
  },
) {}

export class IncidentNotFound extends Schema.TaggedErrorClass<IncidentNotFound>()(
  "IncidentNotFound",
  {
    id: Schema.Number,
  },
) {}
