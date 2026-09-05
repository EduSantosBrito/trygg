import { Effect } from "effect";
import { Component, Signal } from "trygg";
import * as Router from "trygg/router";
import { CodeBlock, highlightCode } from "../../components/code-block";
import { DocsSidebar } from "../../components/docs-sidebar";
import { Footer } from "../../components/footer";
import { Header } from "../../components/header";
import { docsContent } from "../../content/docs-content";
import { DocsHeadingsLive, setDocsHeadings } from "../../content/headings";
import { sidebarGroups, type SidebarGroup } from "../../content/sidebar";

const quickPath = [
  {
    label: "Create the app",
    body: "Scaffold the canary template and install dependencies with your package manager.",
    href: "/docs/getting-started",
  },
  {
    label: "Understand the model",
    body: "See how JSX, the renderer, and signals fit together — and why components run once.",
    href: "/docs/concepts/how-it-works",
  },
  {
    label: "Learn the core primitives",
    body: "Components, signals, resources, and error boundaries — the surface you build with daily.",
    href: "/docs/components",
  },
];

// The one idea everything else builds on, shown before the prose explains it:
// a Component is an Effect that runs once, reads signals with yield*, and
// returns the element tree to mount.
const componentSnippet = `import { Component, Signal } from "trygg";

const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0);

  return (
    <button onClick={() => Signal.update(count, (n) => n + 1)}>
      Clicked {count} times
    </button>
  );
});`;

// Honest read-times: derived from the actual word count of each section's pages
// rather than hand-maintained estimates, so they stay accurate as docs change.
const WORDS_PER_MINUTE = 200;

const groupReadMinutes = (group: SidebarGroup): number => {
  const words = group.links.reduce((total, link) => {
    const content = docsContent[link.href];
    if (!content) return total;
    return total + content.trim().split(/\s+/).filter(Boolean).length;
  }, 0);
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
};

const sectionIntros: Readonly<Record<string, string>> = {
  Concepts: "How rendering, reactivity, and Effect fit together — read this before the reference.",
  "Core model":
    "Components, elements, rendering, signals, resources, and error boundaries — the primitives the framework is built on.",
  Composition: "Portals, document head, class names, and browser-facing security constraints.",
  Routing:
    "Define routes, navigate with typed links, share layouts, and tune prefetch, render, and scroll behavior.",
  Tooling: "Config, the Vite plugin, generated API types, and testing — the toolchain surfaces.",
  Patterns: "Reusable solutions to recurring problems, starting with app-wide shared state.",
};

const sectionSummaries = sidebarGroups
  .filter((group) => group.label !== "Start")
  .map((group) => ({
    label: group.label,
    intro: sectionIntros[group.label] ?? "",
    href: group.links[0]?.href ?? "/docs",
    count: group.links.length,
    time: `${groupReadMinutes(group)} min read`,
  }));

export default Component.gen(function* () {
  yield* setDocsHeadings([]);

  const snippetLines = yield* Effect.promise(() => highlightCode(componentSnippet, "tsx"));

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
            Get started
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

      <section className="docs-section" aria-labelledby="docs-snippet-title">
        <div className="docs-section__header">
          <p className="docs-section__kicker">The whole idea</p>
          <h2 id="docs-snippet-title">A component is an Effect</h2>
          <p>
            It runs once, reads state and services with <code>yield*</code>, and returns the element
            tree to mount. Signals patch the DOM in place — no virtual DOM, no re-renders.
          </p>
        </div>
        <CodeBlock
          lines={snippetLines}
          header="counter.tsx"
          fileType="tsx"
          copyText={componentSnippet}
        />
      </section>

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
          <p>{`${sectionSummaries.length} sections. Read in order, or jump straight to the one you need.`}</p>
        </div>

        <ol className="docs-section-index" role="list">
          {sectionSummaries.map((section) => (
            <li key={section.href}>
              <Router.Link to={section.href} className="docs-section-index__item">
                <span className="docs-section-index__body">
                  <strong>{section.label}</strong>
                  <span className="docs-section-index__intro">{section.intro}</span>
                  <span className="docs-section-index__meta">
                    <span>{`${section.count} ${section.count === 1 ? "topic" : "topics"}`}</span>
                    <span aria-hidden="true">·</span>
                    <span>{section.time}</span>
                  </span>
                </span>
                <span className="docs-section-index__arrow" aria-hidden="true">
                  →
                </span>
              </Router.Link>
            </li>
          ))}
        </ol>
      </section>
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
}).pipe(Component.provide(DocsHeadingsLive));
