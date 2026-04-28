/**
 * Changelog Listing Page — trygg.dev
 */
import { Component } from "trygg";

import { changelogEntries } from "../lib/changelog";

// =============================================================================
// Listing Page
// =============================================================================

export default Component.gen(function* () {
  return (
    <>
      <title>Changelog | trygg</title>

      <main id="main-content" className="bg-grid min-h-screen px-6 py-16">
        <div className="max-w-3xl mx-auto">
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
                <a
                  href={`/changelog/${entry.name}`}
                  className="block rounded-2xl border border-[var(--color-border)] bg-[rgba(5,5,8,0.86)] backdrop-blur-sm p-6 sm:p-8 hover:border-[var(--color-accent)] transition-colors"
                >
                  <span className="inline-block font-mono text-xs uppercase tracking-[0.15em] text-[var(--color-text-subtle)] mb-3">
                    {entry.date}
                  </span>
                  <h2 className="text-xl font-semibold tracking-tight text-[var(--color-text)] mb-2">
                    {entry.meta.title}
                  </h2>
                  <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                    {entry.meta.summary}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
});
