/**
 * 404 page for unknown routes.
 */
import { Component } from "trygg";
import * as Router from "trygg/router";

import { Footer } from "../components/footer";
import { Header } from "../components/header";

export default Component.gen(function* () {
  return (
    <>
      <title>404 | trygg</title>
      <meta name="robots" content="noindex" />

      <div className="min-h-screen flex flex-col">
        <Header />

        <main id="main-content" className="flex-1">
          <section aria-labelledby="not-found-title" className="not-found">
            <p className="not-found__kicker">404 / not&nbsp;found</p>
            <h1 id="not-found-title" className="not-found__title">
              This page slipped through the rule.
            </h1>
            <p className="not-found__lede">
              The link is missing or has moved. The docs are the fastest way back; pick a
              direction below.
            </p>

            <ul className="not-found__directions" role="list">
              <li>
                <Router.Link to="/docs" className="not-found__link">
                  <span className="not-found__link-num">01</span>
                  <span className="not-found__link-body">
                    <span className="not-found__link-title">Open the docs</span>
                    <span className="not-found__link-meta">/docs</span>
                  </span>
                </Router.Link>
              </li>
              <li>
                <Router.Link to="/changelog" className="not-found__link">
                  <span className="not-found__link-num">02</span>
                  <span className="not-found__link-body">
                    <span className="not-found__link-title">Read the changelog</span>
                    <span className="not-found__link-meta">/changelog</span>
                  </span>
                </Router.Link>
              </li>
              <li>
                <Router.Link to="/" className="not-found__link">
                  <span className="not-found__link-num">03</span>
                  <span className="not-found__link-body">
                    <span className="not-found__link-title">Return home</span>
                    <span className="not-found__link-meta">/</span>
                  </span>
                </Router.Link>
              </li>
            </ul>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
});
