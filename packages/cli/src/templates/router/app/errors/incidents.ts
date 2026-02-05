import { Schema } from "effect";

export const Status = Schema.Literal("Detected", "Investigating", "Identified", "Monitoring", "Resolved");
export type Status = typeof Status.Type;

export const Severity = Schema.Literal("SEV-1", "SEV-2", "SEV-3", "SEV-4");
export type Severity = typeof Severity.Type;

export class InvalidTransition extends Schema.TaggedError<InvalidTransition>()(
  "InvalidTransition",
  {
    from: Status,
    to: Status,
    validNext: Schema.Array(Status),
  },
) {}

export class IncidentNotFound extends Schema.TaggedError<IncidentNotFound>()(
  "IncidentNotFound",
  { id: Schema.Number },
) {}
