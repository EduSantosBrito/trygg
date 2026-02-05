import { Data } from "effect";

export type Status = "Detected" | "Investigating" | "Identified" | "Monitoring" | "Resolved";

export type Severity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";

export class InvalidTransition extends Data.TaggedError("InvalidTransition")<{
  readonly from: Status;
  readonly to: Status;
  readonly validNext: ReadonlyArray<Status>;
}> {}

export class IncidentNotFound extends Data.TaggedError("IncidentNotFound")<{
  readonly id: number;
}> {}
