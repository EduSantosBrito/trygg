/**
 * Changelog Listing Page — trygg.dev
 */
import { Component } from "trygg";

import { changelogEntries } from "../lib/changelog";
import { Footer } from "../components/footer";
import { Link } from "trygg/router";

// =============================================================================
// Listing Page
// =============================================================================

export default Component.gen(function* () {
  return (
    <>
      <title>Changelog | trygg</title>

      <div className="bg-grid min-h-screen flex flex-col">
        <main id="main-content" className="flex-1 px-6 py-16">
          <div className="max-w-3xl mx-auto">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mb-8"
            >
              <span aria-hidden="true">&larr;</span>
              Back to home
            </Link>

            <header className="mb-12">
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-text)]">
                Changelog
              </h1>
              <p className="mt-4 text-[var(--color-text-muted)] leading-relaxed">
                Updates, improvements, and new features.
              </p>
            </header>

            <ul role="list" className="flex flex-col gap-6">
              {changelogEntries.map((entry) => (
                <li key={entry.name}>
                  <Link
                    prefetch="intent"
                    to={`/changelog/${entry.name}`}
                    className="block rounded-2xl border border-[var(--color-border)] bg-[rgba(5,5,8,0.86)] backdrop-blur-sm p-6 sm:p-8 hover:border-[var(--color-accent)] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--color-text-subtle)]">
                        {entry.date}
                      </span>
                      <span className="font-mono text-xs font-normal text-[var(--color-accent)]">
                        {entry.meta.version}
                      </span>
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight text-[var(--color-text)] mb-2">
                      {entry.meta.title}
                    </h2>
                    <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                      {entry.meta.summary}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
});
