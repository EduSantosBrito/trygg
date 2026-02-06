import { Component, type ComponentProps } from "trygg";
import type { Severity } from "../errors/incidents";

export const SeverityBadge = Component.gen(function* (
  Props: ComponentProps<{ severity: Severity }>,
) {
  const { severity } = yield* Props;

  return <span className={`severity-badge severity-badge--${severity.toLowerCase()}`}>{severity}</span>;
});
