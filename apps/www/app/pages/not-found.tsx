/**
 * 404 page for unknown routes.
 */
import { Component } from "trygg";

import { sections } from "../content/copy";

export default Component.gen(function* () {
  return (
    <>
      <title>404 — Page not found | trygg</title>
      <meta name="robots" content="noindex" />

      <main id="main-content" className="bg-grid min-h-screen px-6 py-16 flex items-center">
        <section
          aria-labelledby="not-found-title"
          className="mx-auto w-full max-w-3xl rounded-2xl border border-[var(--color-border)] bg-[rgba(5,5,8,0.86)] backdrop-blur-sm"
        >
          <div className="p-8 sm:p-12">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">
              Error 404
            </p>

            <h1
              id="not-found-title"
              className="mt-3 text-4xl sm:text-5xl font-semibold tracking-tight text-[var(--color-text)]"
            >
              Page not found
            </h1>

            <p className="mt-4 max-w-xl text-[var(--color-text-muted)] leading-relaxed">
              The link is missing or moved. Return home or open the repository.
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <a
                href="/"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
              >
                Go home
                <span aria-hidden="true">&rarr;</span>
              </a>

              <a
                href={sections.community.github.href}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)] text-[var(--color-text)] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open trygg GitHub repository (opens in new tab)"
              >
                Open GitHub
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
});
