import { Component, type ComponentProps } from "trygg";
import type { Status } from "../errors/incidents";

const STATUS_LABEL: Record<Status, string> = {
  Detected: "Detected",
  Investigating: "Investigating",
  Identified: "Identified",
  Monitoring: "Monitoring",
  Resolved: "Resolved",
};

export const StatusBadge = Component.gen(function* (
  Props: ComponentProps<{ status: Status }>,
) {
  const { status } = yield* Props;

  return (
    <span className={`status-badge status-badge--${status.toLowerCase()}`}>
      {STATUS_LABEL[status]}
    </span>
  );
});
