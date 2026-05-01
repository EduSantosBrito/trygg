import { Effect } from "effect";
import { Component, Signal, type ComponentProps } from "trygg";

import { sidebarGroups } from "../content/sidebar";

interface SearchResult {
  readonly label: string;
  readonly href: string;
  readonly group: string;
  readonly description?: string;
}

const searchIndex: ReadonlyArray<SearchResult> = sidebarGroups.flatMap((group) =>
  group.links.map((link) => ({
    label: link.label,
    href: link.href,
    group: group.label,
    description: link.description,
  })),
);

interface SearchDialogProps {
  readonly open: Signal.Signal<boolean>;
}

const filterResults = (q: string): ReadonlyArray<SearchResult> => {
  if (q.trim() === "") return searchIndex;
  const lower = q.toLowerCase();
  return searchIndex.filter(
    (item) =>
      item.label.toLowerCase().includes(lower) ||
      item.group.toLowerCase().includes(lower) ||
      (item.description !== undefined && item.description.toLowerCase().includes(lower)),
  );
};

export const SearchDialog = Component.gen(function* (Props: ComponentProps<SearchDialogProps>) {
  const { open } = yield* Props;
  const query = yield* Signal.make("");
  const activeIndex = yield* Signal.make(0);

  const results = yield* Signal.derive(query, filterResults);

  const dialogClass = yield* Signal.derive(open, (o): string =>
    o ? "search-dialog search-dialog--open" : "search-dialog",
  );

  const close = Effect.gen(function* () {
    yield* Signal.set(open, false);
    yield* Signal.set(query, "");
    yield* Signal.set(activeIndex, 0);
  });

  const selectAndClose = (href: string) =>
    Effect.gen(function* () {
      yield* close;
      yield* Effect.sync(() => {
        window.location.href = href;
      });
    });

  const handleKeyDown = (e: Event): Effect.Effect<void> =>
    Effect.gen(function* () {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") {
        yield* close;
        return;
      }
      const idx = yield* Signal.peek(activeIndex);
      const items = yield* Signal.peek(results);
      if (ke.key === "ArrowDown") {
        ke.preventDefault();
        yield* Signal.set(activeIndex, Math.min(idx + 1, items.length - 1));
        return;
      }
      if (ke.key === "ArrowUp") {
        ke.preventDefault();
        yield* Signal.set(activeIndex, Math.max(idx - 1, 0));
        return;
      }
      if (ke.key === "Enter") {
        ke.preventDefault();
        const item = items[idx];
        if (item) yield* selectAndClose(item.href);
      }
    });

  const handleInput = (e: Event): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Signal.set(query, (e.target as HTMLInputElement).value);
      yield* Signal.set(activeIndex, 0);
    });

  // Results list derived from both results and activeIndex
  const resultsList = yield* Signal.deriveAll([results, activeIndex] as const, (items, ai) =>
    items.length === 0 ? (
      <p className="search-dialog__empty">No results</p>
    ) : (
      <>
        {items.map((item, index) => (
          <button
            key={item.href}
            type="button"
            className={
              index === ai
                ? "search-dialog__result search-dialog__result--active"
                : "search-dialog__result"
            }
            onClick={() => selectAndClose(item.href)}
          >
            <span>{item.label}</span>
            <span className="search-dialog__result-group">{item.group}</span>
          </button>
        ))}
      </>
    ),
  );

  return (
    <div className={dialogClass} role="dialog" aria-modal="true" aria-label="Search docs">
      <button
        type="button"
        className="search-dialog__backdrop"
        aria-label="Close search"
        onClick={() => close}
      />
      <div className="search-dialog__panel" onKeyDown={handleKeyDown}>
        <input
          type="text"
          className="search-dialog__input"
          placeholder="Search docs..."
          aria-label="Search docs"
          autoComplete="off"
          spellCheck={false}
          onInput={handleInput}
          autoFocus
        />
        <div className="search-dialog__results">{resultsList}</div>
      </div>
    </div>
  );
});
