import { Component, type ComponentProps } from "trygg";
import type { Status } from "../errors/incidents";

const STATUS_CONFIG: Record<Status, { label: string; className: string }> = {
  Detected: { label: "Detected", className: "badge badge--status badge--investigating" },
  Investigating: { label: "Investigating", className: "badge badge--status badge--investigating" },
  Identified: { label: "Fixing", className: "badge badge--status badge--fixing" },
  Monitoring: { label: "Monitoring", className: "badge badge--status badge--monitoring" },
  Resolved: { label: "Closed", className: "badge badge--status badge--closed" },
};

export const StatusBadge = Component.gen(function* (Props: ComponentProps<{ status: Status }>) {
  const { status } = yield* Props;
  const config = STATUS_CONFIG[status];

  return (
    <span className={config.className}>
      <span className="badge__dot" aria-hidden="true" />
      {config.label}
    </span>
  );
});
