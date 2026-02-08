import { Component, type ComponentProps } from "trygg";
import type { TimelineEntry as TimelineEntryData } from "../api";
import { formatRelative } from "../utils/date";

export const TimelineEntry = Component.gen(function* (
  Props: ComponentProps<{ entry: TimelineEntryData }>,
) {
  const { entry } = yield* Props;

  return (
    <div className="timeline-entry">
      <div className="timeline-entry__avatar">U</div>
      <div className="timeline-entry__content">
        <div className="timeline-entry__header">
          <span className="timeline-entry__author">System</span>
          <time className="timeline-entry__time">{formatRelative(entry.timestamp)}</time>
        </div>
        <div className="timeline-entry__body">
          <p className="timeline-entry__message">{entry.message}</p>
        </div>
      </div>
    </div>
  );
});
