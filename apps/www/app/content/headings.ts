import { Signal } from "trygg";

export interface HeadingEntry {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
}

// Shared signal for docs page headings (used by right rail "On this page")
export const docsHeadings = Signal.makeSync<ReadonlyArray<HeadingEntry>>([]);
