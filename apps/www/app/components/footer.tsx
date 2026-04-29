import { Component } from "trygg";
import * as Router from "trygg/router";

import { sections } from "../content/copy";
import { Logo } from "./logo";

export const Footer = Component.gen(function* () {
  return (
    <footer
      role="contentinfo"
      className="py-16 px-6 border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]"
    >
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between gap-8 mb-12">
          <div className="max-w-xs">
            <span className="flex items-center gap-2">
              <Logo />
              <span
                className="text-xl font-bold text-[var(--color-text)]"
                style={{ fontFamily: "var(--font-brand)" }}
              >
                trygg
              </span>
            </span>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Effect-native UI framework
            </p>
          </div>

          <div className="flex gap-16">
            <nav aria-label="Resources">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-subtle)] mb-4">
                Resources
              </h4>
              <ul role="list" className="flex flex-col gap-3">
                <li>
                  <Router.Link
                    to="/changelog"
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                  >
                    Changelog
                  </Router.Link>
                </li>
                <li>
                  <a
                    href={sections.community.github.href}
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.npmjs.com/package/trygg"
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    npm
                  </a>
                </li>
                <li>
                  <a
                    href="https://npmx.dev/package/trygg"
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    npmx
                  </a>
                </li>
              </ul>
            </nav>

            <nav aria-label="Community">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-subtle)] mb-4">
                Community
              </h4>
              <ul role="list" className="flex flex-col gap-3">
                <li>
                  <a
                    href="https://effect.website"
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Effect
                  </a>
                </li>
                <li>
                  <a
                    href="https://discord.gg/effect-ts"
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Effect Discord
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div className="pt-8 border-t border-[var(--color-border)] flex items-center justify-between gap-4">
          <small className="text-xs text-[var(--color-text-subtle)]">MIT License</small>
          <small className="text-xs text-[var(--color-text-subtle)]">Made with trygg</small>
        </div>
      </div>
    </footer>
  );
});
