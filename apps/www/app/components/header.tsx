import { Effect, Scope } from "effect";
import { Component, Signal } from "trygg";
import * as Router from "trygg/router";

import { sections } from "../content/copy";
import { currentRouteSnapshot } from "../lib/router-snapshot";
import { Logo } from "./logo";
import { SearchDialog } from "./search-dialog";
import { ThemeToggle } from "./theme-toggle";

const linkClass =
  "site-header__link text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors";

export const Header = Component.gen(function* () {
  const route = yield* currentRouteSnapshot;
  const isDocs = route.path === "/docs" || route.path.startsWith("/docs/");
  const docsClass = isDocs
    ? `${linkClass} site-header__link--active text-[var(--color-text)]`
    : linkClass;

  const searchOpen = yield* Signal.make(false);

  // Global ⌘K / Ctrl+K shortcut for search on docs pages
  if (isDocs && typeof document !== "undefined") {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        Effect.runFork(Signal.set(searchOpen, true));
      }
    };
    document.addEventListener("keydown", handler);

    const renderScope = yield* Signal.CurrentRenderScope;
    if (renderScope === null) {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => document.removeEventListener("keydown", handler)),
      );
    } else {
      yield* Scope.addFinalizer(
        renderScope,
        Effect.sync(() => document.removeEventListener("keydown", handler)),
      );
    }
  }

  return (
    <>
      <header className="site-header">
        <div className="flex items-center gap-2">
          <Router.Link
            to="/"
            className="site-header__brand flex items-center gap-2"
            aria-label="trygg home"
          >
            <Logo />
            <span className="text-lg font-bold text-[var(--color-text)]">trygg</span>
          </Router.Link>
          <Router.Link
            to="/changelog"
            className="canary-badge"
            aria-label="Canary release — see changelog"
          >
            Canary
          </Router.Link>
        </div>
        <nav aria-label="Site navigation" className="flex items-center gap-4 sm:gap-6">
          {isDocs ? (
            <button
              type="button"
              className="search-trigger site-header__search"
              onClick={() => Signal.set(searchOpen, true)}
            >
              <span>Search docs</span>
              <kbd className="search-trigger__kbd">⌘K</kbd>
            </button>
          ) : null}
          {isDocs ? (
            <button
              type="button"
              className="site-header__search-icon"
              aria-label="Search docs"
              onClick={() => Signal.set(searchOpen, true)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          ) : null}
          <Router.Link to="/docs" className={docsClass}>
            Docs
          </Router.Link>
          <a
            href={sections.community.github.href}
            className={`${linkClass} site-header__link--secondary`}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://discord.gg/BRDc7xGb5D"
            className={`${linkClass} site-header__link--secondary`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Discord
          </a>
          <ThemeToggle />
        </nav>
      </header>
      {isDocs ? <SearchDialog open={searchOpen} /> : null}
    </>
  );
});
