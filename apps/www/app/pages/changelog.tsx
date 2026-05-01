/**
 * Changelog Listing Page — trygg.dev
 */
import { Component } from "trygg";

import { changelogEntries } from "../lib/changelog";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { Link } from "trygg/router";

export default Component.gen(function* () {
  return (
    <>
      <title>Changelog | trygg</title>

      <div className="min-h-screen flex flex-col">
        <Header />

        <main id="main-content" className="flex-1">
          <div className="changelog-stack">
            <header className="changelog-stack__header">
              <p className="changelog-stack__kicker">Release notes</p>
              <h1 className="changelog-stack__title">Changelog</h1>
              <p className="changelog-stack__lede">
                A record of what shipped, when, and why. Newest first, no marketing varnish.
              </p>
            </header>

            <ol role="list" className="changelog-timeline">
              {changelogEntries.map((entry) => (
                <li key={entry.name} className="changelog-timeline__entry">
                  <Link prefetch="intent" to={`/changelog/${entry.name}`}>
                    <time className="changelog-timeline__date" dateTime={entry.date}>
                      {entry.date}
                    </time>
                    <div className="changelog-timeline__body">
                      <span className="changelog-timeline__version">{entry.meta.version}</span>
                      <h2 id={entry.name} className="changelog-timeline__title">
                        {entry.meta.title}
                      </h2>
                      <p className="changelog-timeline__summary">{entry.meta.summary}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
});
