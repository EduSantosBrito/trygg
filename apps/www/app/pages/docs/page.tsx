import { Component, Signal } from "trygg";
import * as Router from "trygg/router";
import { DocsSidebar } from "../../components/docs-sidebar";
import { Footer } from "../../components/footer";
import { Header } from "../../components/header";
import { setDocsHeadings } from "../../content/headings";
import { sidebarGroups } from "../../content/sidebar";

const quickPath = [
  {
    label: "Create the app",
    body: "Scaffold the canary template and install dependencies with your package manager.",
    href: "/docs/getting-started",
  },
  {
    label: "Read the component model",
    body: "See how Component.gen threads props, services, errors, and JSX through Effect.",
    href: "/docs/components",
  },
  {
    label: "Follow source-owned docs",
    body: "Canonical behavior lives beside the code that owns it. This site summarizes the path.",
    href: "/docs/testing",
  },
];

const sectionSummaries: ReadonlyArray<{
  readonly label: string;
  readonly intro: string;
  readonly href: string;
  readonly time: string;
}> = [
  {
    label: "Start",
    intro: "Orient yourself and run the canary app locally before reading further.",
    href: "/docs/getting-started",
    time: "4 min read",
  },
  {
    label: "Core model",
    intro:
      "Components, elements, signals, resources, and error boundaries — the primitives the framework is built on.",
    href: "/docs/components",
    time: "15 min read",
  },
  {
    label: "Composition",
    intro: "Portals, document head, classname utilities, and browser-facing security constraints.",
    href: "/docs/portal",
    time: "10 min read",
  },
  {
    label: "Routing",
    intro:
      "Declare route trees, navigate with typed links, guard with middleware, prefetch, and recover from misses.",
    href: "/docs/router/routes",
    time: "22 min read",
  },
  {
    label: "Integration",
    intro:
      "JSX runtime, API types, config, Vite plugin, testing, debug, and metrics — the surfaces that connect trygg to your toolchain.",
    href: "/docs/jsx-runtime",
    time: "18 min read",
  },
];

const sectionCounts = sidebarGroups.map((group) => group.links.length);

export default Component.gen(function* () {
  yield* setDocsHeadings([]);

  const drawerOpen = yield* Signal.make(false);
  const drawerClass = yield* Signal.derive(drawerOpen, (open): string =>
    open ? "docs-drawer docs-drawer--open" : "docs-drawer",
  );
  const drawerHidden = yield* Signal.derive(drawerOpen, (open) => !open);

  const openDrawer = () => Signal.set(drawerOpen, true);
  const closeDrawer = () => Signal.set(drawerOpen, false);

  const indexArticle = (
    <article className="docs-page docs-home" aria-labelledby="docs-title">
      <header className="docs-hero docs-hero--compact">
        <p className="docs-eyebrow">Docs</p>
        <h1 id="docs-title">Build UI the Effect way.</h1>
        <p className="docs-hero__lede">
          Start with a runnable canary app, then move through components, signals, routing, and
          tooling without leaving the Effect mental model.
        </p>
        <div className="docs-hero__actions" aria-label="Primary docs actions">
          <Router.Link to="/docs/getting-started" className="docs-button docs-button--primary">
            Getting started
          </Router.Link>
          <a
            href="https://github.com/EduSantosBrito/trygg/tree/main/packages/core/src"
            className="docs-button docs-button--secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Browse on GitHub →
          </a>
        </div>
      </header>

      <section className="docs-section" aria-labelledby="docs-fast-path-title">
        <div className="docs-section__header">
          <p className="docs-section__kicker">Recommended path</p>
          <h2 id="docs-fast-path-title">From first run to framework model</h2>
        </div>
        <ol className="docs-path" role="list">
          {quickPath.map((item, index) => (
            <li key={item.href}>
              <Router.Link to={item.href} className="docs-path__item">
                <span className="docs-path__index">0{index + 1}</span>
                <span>
                  <strong>{item.label}</strong>
                  <span>{item.body}</span>
                </span>
              </Router.Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="docs-section" aria-labelledby="docs-map-title">
        <div className="docs-section__header">
          <p className="docs-section__kicker">Map</p>
          <h2 id="docs-map-title">Sections</h2>
          <p>Five sections. Read in order, or jump straight to the one you need.</p>
        </div>

        <ol className="docs-section-index" role="list">
          {sectionSummaries.map((section, index) => {
            const count = sectionCounts[index] ?? 0;
            return (
              <li key={section.href}>
                <Router.Link to={section.href} className="docs-section-index__item">
                  <span className="docs-section-index__num">0{index + 1}</span>
                  <span className="docs-section-index__body">
                    <strong>{section.label}</strong>
                    <span className="docs-section-index__intro">{section.intro}</span>
                    <span className="docs-section-index__meta">
                      <span>
                        {count} {count === 1 ? "topic" : "topics"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{section.time}</span>
                    </span>
                  </span>
                  <span className="docs-section-index__arrow" aria-hidden="true">
                    →
                  </span>
                </Router.Link>
              </li>
            );
          })}
        </ol>
      </section>

      <aside
        className="docs-authoring-note"
        aria-labelledby="docs-contract-title"
        style={{ marginTop: "clamp(2.75rem, 5vw, 4.5rem)" }}
      >
        <p className="docs-authoring-note__label">Docs contract</p>
        <h2 id="docs-contract-title">Source-owned first</h2>
        <p>
          The website is the guide layer. Canonical semantics stay in the owner module TSDoc and
          sidecar *.docs.md files. Update source docs before expanding website copy.
        </p>
      </aside>
    </article>
  );

  return (
    <>
      <title>Docs | trygg</title>
      <Header />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[70] focus:px-4 focus:py-2 focus:bg-[var(--color-accent)] focus:text-[var(--color-text)] focus:rounded-lg focus:outline-none"
      >
        Skip to docs content
      </a>
      <div className="docs-layout">
        <button
          type="button"
          className="docs-menu-button"
          aria-label="Open docs navigation"
          aria-expanded={drawerOpen}
          onClick={openDrawer}
        >
          Menu
        </button>

        <aside className="docs-layout__sidebar" aria-label="Documentation navigation">
          <DocsSidebar />
        </aside>

        <div className={drawerClass} aria-hidden={drawerHidden}>
          <button
            type="button"
            className="docs-drawer__backdrop"
            aria-label="Close docs navigation"
            onClick={closeDrawer}
          />
          <div className="docs-drawer__panel">
            <DocsSidebar onNavigate={closeDrawer} />
          </div>
        </div>

        <main id="main-content" className="docs-content">
          {indexArticle}
        </main>
      </div>

      <Footer />
    </>
  );
});
