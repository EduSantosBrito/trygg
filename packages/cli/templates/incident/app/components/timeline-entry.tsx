import { Component, type ComponentProps } from "trygg";
import type { TimelineEntry as TimelineEntryData } from "../api";
import { formatRelative } from "../utils/date";

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
