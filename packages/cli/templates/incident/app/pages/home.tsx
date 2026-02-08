import { Component } from "trygg";
import * as Router from "trygg/router";

const FEATURES: ReadonlyArray<{ readonly title: string; readonly description: string }> = [
  {
    title: "Signals",
    description: "Fine-grained reactivity that updates only what changed. No virtual DOM diffing.",
  },
  {
    title: "Effects",
    description:
      "Typed async operations with explicit error handling. Compose complex flows safely.",
  },
  {
    title: "Layers",
    description:
      "Dependency injection at the edge. Swap implementations without touching components.",
  },
];

export default Component.gen(function* () {
  return (
    <>
      <header className="content-header">
        <div className="content-header__left">
          <div className="content-header__title">
            <div className="content-header__icon content-header__icon--home" aria-hidden="true" />
            <h1 className="content-header__text">Home</h1>
          </div>
        </div>
      </header>

      <main className="content-body">
        {/* Hero card */}
        <div className="card" style={{ padding: "32px", marginBottom: "24px" }}>
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: "var(--accent)", letterSpacing: "0.15em" }}
          >
            trygg
          </p>
          <h2 className="text-2xl font-semibold mb-2" style={{ color: "var(--text-1)" }}>
            Effect-native UI framework
          </h2>
          <p className="text-sm mb-6" style={{ color: "var(--text-3)", maxWidth: "480px" }}>
            Fine-grained signals, typed effects, and dependency injection — for UIs that scale with
            your codebase.
          </p>
          <Router.Link to="/incidents" className="btn btn--primary">
            Open Incident Commander
          </Router.Link>
        </div>

        {/* Feature cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "16px",
          }}
        >
          {FEATURES.map((feature) => (
            <article key={feature.title} className="card" style={{ padding: "20px" }}>
              <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--text-1)" }}>
                {feature.title}
              </h3>
              <p className="text-sm" style={{ color: "var(--text-3)", lineHeight: "1.5" }}>
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </main>
    </>
  );
});
