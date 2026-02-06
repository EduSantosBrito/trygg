import { Component, type ComponentProps } from "trygg";
import type { TimelineEntry as TimelineEntryData } from "../api";

export const TimelineEntry = Component.gen(function* (
  Props: ComponentProps<{ entry: TimelineEntryData }>,
) {
  const { entry } = yield* Props;

  return (
    <div className="timeline-entry">
      <span className="timeline-entry__dot" />
      <div className="timeline-entry__content">
        <span className="timeline-entry__message">{entry.message}</span>
        <time className="timeline-entry__time">{formatRelative(entry.timestamp)}</time>
      </div>
    </div>
  );
});

const formatRelative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
};
