import { Component } from "trygg";
import * as Router from "trygg/router";

import { DocsArticle, extractDocsHeadings } from "../../components/docs-article";
import { docsContent } from "../../content/docs-content";
import { setDocsHeadings, type HeadingEntry } from "../../content/headings";
import { sidebarGroups } from "../../content/sidebar";
import { currentRouteSnapshot } from "../../lib/router-snapshot";

const sidebarLinks = sidebarGroups.flatMap((group) => group.links);

const placeholderHeadings: ReadonlyArray<HeadingEntry> = [
  {
    id: "docs-topic-authoring-title",
    text: "Write canonical docs beside the owner first",
    level: 2,
  },
  { id: "docs-topic-next-title", text: "Keep moving", level: 2 },
];

export default Component.gen(function* () {
  const route = yield* currentRouteSnapshot;
  const path = route.path;
  const link = sidebarLinks.find((item) => item.href === path);
  const content = docsContent[path];

  yield* setDocsHeadings(content ? extractDocsHeadings(content) : placeholderHeadings);

  if (content) {
    const docTitle = link?.label ?? "Docs topic";
    return (
      <>
        <title>{`${docTitle} | trygg docs`}</title>
        <DocsArticle
          source={content}
          description={link?.description}
          primaryExport={link?.primaryExport}
        />
      </>
    );
  }

  const title = link?.label ?? "Docs topic";
  const description =
    link?.description ??
    "This docs route is reserved for a future guide. Start with source-owned docs before expanding the website copy.";

  return (
    <>
      <title>{`${title} | trygg docs`}</title>
      <article className="docs-page docs-topic-placeholder" aria-labelledby="docs-topic-title">
        <Router.Link to="/docs" className="docs-back-link">
          <span aria-hidden="true">←</span>
          Docs home
        </Router.Link>

        <header className="docs-topic-placeholder__header">
          <p className="docs-eyebrow">Docs topic</p>
          <h1 id="docs-topic-title">{title}</h1>
          <p>{description}</p>
        </header>

        <section className="docs-authoring-panel" aria-labelledby="docs-topic-authoring-title">
          <div>
            <p className="docs-section__kicker">Expandable slot</p>
            <h2 id="docs-topic-authoring-title">Write canonical docs beside the owner first.</h2>
            <p>
              Public symbol docs, module docs, and required sidecar guides stay in packages/core.
              This page should summarize that source-owned behavior, not become the source of truth.
            </p>
          </div>
          {link?.primaryExport === undefined ? null : (
            <pre aria-label={`Import ${link.primaryExport} from trygg`}>
              <code>{`import { ${link.primaryExport} } from "trygg";`}</code>
            </pre>
          )}
        </section>

        <section className="docs-section" aria-labelledby="docs-topic-next-title">
          <div className="docs-section__header">
            <p className="docs-section__kicker">Next</p>
            <h2 id="docs-topic-next-title">Keep moving</h2>
          </div>
          <div className="docs-next-row">
            <Router.Link to="/docs/getting-started" className="docs-next-link">
              <strong>Getting started</strong>
              <span>Create and run a canary app.</span>
            </Router.Link>
            <a
              href="https://github.com/EduSantosBrito/trygg/tree/main/packages/core/src"
              className="docs-next-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong>Source docs</strong>
              <span>Browse owner modules and sidecar guides.</span>
            </a>
          </div>
        </section>
      </article>
    </>
  );
});
