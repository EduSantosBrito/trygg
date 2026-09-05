import { Effect, Layer, Option } from "effect";
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

export class DocsHeadings extends Context.Service<
  DocsHeadings,
  {
    readonly entries: Signal.Signal<ReadonlyArray<HeadingEntry>>;
    readonly set: (entries: ReadonlyArray<HeadingEntry>) => Effect.Effect<void>;
  }
>()("www/DocsHeadings") {}

export const DocsHeadingsLive = Layer.effect(
  DocsHeadings,
  Effect.gen(function* () {
    // oxlint-disable-next-line effect/no-service-option -- Route providers reuse the root-owned headings state when present.
    const inherited = yield* Effect.serviceOption(DocsHeadings);
    if (Option.isSome(inherited)) {
      return inherited.value;
    }

    const entries = yield* Signal.make<ReadonlyArray<HeadingEntry>>([]);
    return {
      entries,
      set: (nextEntries) => Signal.set(entries, nextEntries),
    } satisfies DocsHeadingsService;
  }).pipe(Effect.annotateLogs({ service: "DocsHeadings" })),
);

export const setDocsHeadings = (
  entries: ReadonlyArray<HeadingEntry>,
): Effect.Effect<void, never, DocsHeadings> =>
  Effect.service(DocsHeadings).pipe(Effect.flatMap((headings) => headings.set(entries)));
