import { Component, type ComponentProps } from "trygg";
import type { Severity } from "../errors/incidents";

const SEVERITY_CONFIG: Record<Severity, { label: string; className: string }> = {
  "SEV-1": { label: "Critical", className: "badge badge--critical" },
  "SEV-2": { label: "Major", className: "badge badge--major" },
  "SEV-3": { label: "Minor", className: "badge badge--minor" },
  "SEV-4": { label: "Low", className: "badge badge--low" },
};

export const SeverityBadge = Component.gen(function* (
  Props: ComponentProps<{ severity: Severity }>,
) {
  const { severity } = yield* Props;
  const config = SEVERITY_CONFIG[severity];

  return <span className={config.className}>{config.label}</span>;
});
