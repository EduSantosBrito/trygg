import { Effect, Scope } from "effect";
import { Component, Signal } from "trygg";
import * as Router from "trygg/router";

import { DocsSidebar } from "./docs-sidebar";
import { Footer } from "./footer";
import { Header } from "./header";
import { sidebarGroups } from "../content/sidebar";
import { DocsHeadings, DocsHeadingsLive } from "../content/headings";
import { currentRouteSnapshot } from "../lib/router-snapshot";

const sidebarLinks = sidebarGroups.flatMap((group) => group.links);

const getPrevNext = (
  path: string,
): { prev: (typeof sidebarLinks)[number] | null; next: (typeof sidebarLinks)[number] | null } => {
  const index = sidebarLinks.findIndex((link) => link.href === path);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? (sidebarLinks[index - 1] ?? null) : null,
    next: index < sidebarLinks.length - 1 ? (sidebarLinks[index + 1] ?? null) : null,
  };
};

const setupActiveHeadingTracker = () => {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};

  let raf = 0;
  let timeout: ReturnType<typeof window.setTimeout> | null = null;
  let mutationObserver: MutationObserver | null = null;
  let disposed = false;
  let listening = false;

  const update = () => {
    const links = document.querySelectorAll<HTMLAnchorElement>(".docs-rail__link");
    if (links.length === 0) return;

    const targets: Array<{ id: string; top: number }> = [];
    links.forEach((link) => {
      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("#")) return;
      const id = href.slice(1);
      const target = document.getElementById(id);
      if (target !== null) targets.push({ id, top: target.getBoundingClientRect().top });
    });
    if (targets.length === 0) return;

    const offset = 120;
    let activeId = targets[0]?.id ?? "";
    for (const t of targets) {
      if (t.top <= offset) activeId = t.id;
    }

    links.forEach((link) => {
      const matches = link.getAttribute("href") === `#${activeId}`;
      link.classList.toggle("docs-rail__link--active", matches);
      if (matches) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const scheduleUpdate = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  };

  let pollUntil = 0;
  let pollTimeout: ReturnType<typeof window.setTimeout> | null = null;

  const poll = () => {
    if (disposed) return;
    update();
    if (Date.now() < pollUntil) {
      pollTimeout = window.setTimeout(poll, 100);
    } else {
      pollTimeout = null;
    }
  };

  const start = () => {
    if (disposed) return;

    const links = document.querySelectorAll(".docs-rail__link");
    if (links.length === 0) {
      timeout = window.setTimeout(start, 80);
      return;
    }
    update();
    if (!listening) {
      window.addEventListener("scroll", scheduleUpdate, { passive: true });
      listening = true;
    }
    const mainEl = document.getElementById("main-content");
    if (mainEl !== null && mutationObserver === null) {
      mutationObserver = new MutationObserver(scheduleUpdate);
      mutationObserver.observe(mainEl, { childList: true, subtree: true });
    }
    pollUntil = Date.now() + 4000;
    if (pollTimeout === null) poll();
  };

  raf = requestAnimationFrame(start);
  return () => {
    disposed = true;
    if (timeout !== null) window.clearTimeout(timeout);
    if (pollTimeout !== null) window.clearTimeout(pollTimeout);
    if (listening) window.removeEventListener("scroll", scheduleUpdate);
    mutationObserver?.disconnect();
    mutationObserver = null;
    cancelAnimationFrame(raf);
  };
};

const registerActiveHeadingTracker = Effect.gen(function* () {
  const cleanup = setupActiveHeadingTracker();
  const componentScope = yield* Signal.CurrentComponentScope;

  if (componentScope === null) {
    yield* Effect.addFinalizer(() => Effect.sync(cleanup));
    return;
  }

  yield* Scope.addFinalizer(componentScope, Effect.sync(cleanup));
});

const DocsPrevNext = Component.gen(function* () {
  // The shared DocsLayout is now preserved across sibling navigations, so this
  // component renders ONCE. prev/next depend on the current path, so derive
  // reactively from router.current (mirrors DocsSidebar) rather than reading a
  // one-shot snapshot — otherwise the links would freeze on the first topic.
  const router = yield* Router.get;
  const content = yield* Signal.derive(router.current, (route) => {
    const { prev, next } = getPrevNext(route.path);

    if (prev === null && next === null) return <></>;

    return (
      <nav className="docs-prev-next" aria-label="Previous and next pages">
        {prev ? (
          <Router.Link to={prev.href} className="docs-prev-next__link">
            <span className="docs-prev-next__label">Previous</span>
            <span className="docs-prev-next__title">{prev.label}</span>
          </Router.Link>
        ) : (
          <div />
        )}
        {next ? (
          <Router.Link
            to={next.href}
            className={
              prev
                ? "docs-prev-next__link docs-prev-next__link--next"
                : "docs-prev-next__link docs-prev-next__link--next docs-prev-next__only"
            }
          >
            <span className="docs-prev-next__label">Next</span>
            <span className="docs-prev-next__title">{next.label}</span>
          </Router.Link>
        ) : null}
      </nav>
    );
  });

  return <>{content}</>;
});

export const DocsLayout = Component.gen(function* () {
  const headings = yield* DocsHeadings;
  const drawerOpen = yield* Signal.make(false);
  const drawerClass = yield* Signal.derive(drawerOpen, (open): string =>
    open ? "docs-drawer docs-drawer--open" : "docs-drawer",
  );
  const drawerHidden = yield* Signal.derive(drawerOpen, (open) => !open);

  const openDrawer = () => Signal.set(drawerOpen, true);
  const closeDrawer = () => Signal.set(drawerOpen, false);
  const drawerPanel = yield* Signal.derive(drawerOpen, (open) =>
    open ? (
      <div className="docs-drawer__panel">
        <DocsSidebar onNavigate={closeDrawer} />
      </div>
    ) : (
      <></>
    ),
  );

  const route = yield* currentRouteSnapshot;
  const hasRail = route.path !== "/docs";
  const layoutClass = hasRail ? "docs-layout docs-layout--with-rail" : "docs-layout";

  if (hasRail) {
    yield* registerActiveHeadingTracker;
  }

  return (
    <>
      <Header />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[70] focus:px-4 focus:py-2 focus:bg-[var(--color-accent)] focus:text-[var(--color-text)] focus:rounded-lg focus:outline-none"
      >
        Skip to docs content
      </a>
      <div className={layoutClass}>
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
          {drawerPanel}
        </div>

        <main id="main-content" className="docs-content">
          <Router.Outlet />
          <DocsPrevNext />
        </main>

        <aside className="docs-rail" aria-label="On this page">
          <p className="docs-rail__title">On this page</p>
          <ul className="docs-rail__links" role="list">
            {Signal.each(
              headings.entries,
              (heading) =>
                Effect.succeed(
                  <li>
                    <a
                      href={`#${heading.id}`}
                      className={
                        heading.level === 3
                          ? "docs-rail__link docs-rail__link--h3"
                          : "docs-rail__link"
                      }
                    >
                      {heading.text}
                    </a>
                  </li>,
                ),
              { key: (heading) => heading.id },
            )}
          </ul>
        </aside>
      </div>

      <Footer />
    </>
  );
}).pipe(Component.provide(DocsHeadingsLive));
