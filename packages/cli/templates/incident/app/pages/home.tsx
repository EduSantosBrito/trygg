import { Component, Signal } from "trygg";
import * as Router from "trygg/router";

const FEATURES: ReadonlyArray<{ readonly title: string; readonly description: string }> = [
  {
    title: "Signals",
    description: "Signals update only changed nodes, so reactive UI stays predictable under load.",
  },
  {
    title: "Effects",
    description: "Effects model async and failure paths explicitly, so UI flows stay typed and composable.",
  },
  {
    title: "Layers",
    description: "Layers wire dependencies at the edge, so components stay focused on behavior.",
  },
];

export default Component.gen(function* () {
  const count = yield* Signal.make(0);
  const increment = () => Signal.update(count, (value) => value + 1);

  return (
    <div className="pb-8">
      <div className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--signal)]">
          trygg
        </p>
        <h1 className="m-0 mt-3 text-2xl font-semibold text-[var(--text-1)] sm:text-3xl">
          Effect-native UI. Fine-grained signals. No virtual DOM.
        </h1>
        <div className="mt-5">
          <Router.Link
            to="/incidents"
            className="inline-flex items-center rounded-md border border-[color-mix(in_srgb,var(--signal)_35%,var(--border))] bg-[color-mix(in_srgb,var(--signal)_14%,transparent)] px-4 py-2 text-sm font-medium text-[var(--signal)] no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--signal)_20%,transparent)]"
          >
            Open Incident Commander -&gt;
          </Router.Link>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="m-0 text-lg font-semibold text-[var(--text-1)]">Signal counter</h2>
        <p className="m-0 mt-2 text-sm text-[var(--text-2)]">
          Click increment and only the amber value node updates.
        </p>
        <button
          className="mt-4 rounded-md border-0 bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)] transition-opacity hover:opacity-90"
          onClick={increment}
        >
          Increment
        </button>
        <p className="m-0 mt-3 text-sm text-[var(--text-2)]">
          Count:&nbsp;
          <span className="inline-block min-w-8 text-center font-semibold text-[var(--signal)] motion-safe:animate-pulse">
            {count}
          </span>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <article
            key={feature.title}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <h3 className="m-0 text-sm font-semibold text-[var(--text-1)]">{feature.title}</h3>
            <p className="m-0 mt-2 text-sm text-[var(--text-2)]">{feature.description}</p>
          </article>
        ))}
      </div>
    </div>
  );
});
