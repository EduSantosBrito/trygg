import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { Signal } from "trygg";

export interface HeadingEntry {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
}

export interface DocsHeadingsService {
  readonly entries: Signal.Signal<ReadonlyArray<HeadingEntry>>;
  readonly set: (entries: ReadonlyArray<HeadingEntry>) => Effect.Effect<void>;
}

export class DocsHeadings extends Context.Service<DocsHeadings, DocsHeadingsService>()(
  "www/DocsHeadings",
) {}

export const DocsHeadingsLive = Layer.effect(
  DocsHeadings,
  Signal.make<ReadonlyArray<HeadingEntry>>([]).pipe(
    Effect.orDie,
    Effect.map(
      (entries): DocsHeadingsService => ({
        entries,
        set: (nextEntries) => Signal.set(entries, nextEntries),
      }),
    ),
  ),
);

export const setDocsHeadings = (
  entries: ReadonlyArray<HeadingEntry>,
): Effect.Effect<void, never, DocsHeadings> =>
  Effect.service(DocsHeadings).pipe(Effect.flatMap((headings) => headings.set(entries)));
