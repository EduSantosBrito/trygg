import { Component } from "trygg";
import * as Router from "trygg/router";

import { DocsArticle, extractDocsHeadings } from "../../components/docs-article";
import { docsContent } from "../../content/docs-content";
import { setDocsHeadings } from "../../content/headings";
import { sidebarGroups } from "../../content/sidebar";
import { currentRouteSnapshot } from "../../lib/router-snapshot";

const sidebarLinks = sidebarGroups.flatMap((group) => group.links);

export default Component.gen(function* () {
  const route = yield* currentRouteSnapshot;
  const path = route.path;
  const link = sidebarLinks.find((item) => item.href === path);
  const content = docsContent[path];

  yield* setDocsHeadings(content ? extractDocsHeadings(content) : []);

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

  return (
    <>
      <title>Docs topic not found | trygg docs</title>
      <meta name="robots" content="noindex" />
      <article className="docs-page docs-topic-placeholder" aria-labelledby="docs-topic-title">
        <Router.Link to="/docs" className="docs-back-link">
          <span aria-hidden="true">←</span>
          Docs home
        </Router.Link>

        <header className="docs-topic-placeholder__header">
          <p className="docs-eyebrow">404 / docs</p>
          <h1 id="docs-topic-title">This docs page is not published.</h1>
          <p>
            Only source-owned markdown and documented public surfaces are linked from the docs map.
          </p>
        </header>
      </article>
    </>
  );
});
