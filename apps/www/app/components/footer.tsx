import { Component } from "trygg";
import * as Router from "trygg/router";

import { sections } from "../content/copy";
import { Logo } from "./logo";

export const Footer = Component.gen(function* () {
  return (
    <footer role="contentinfo" className="footer-stack">
      <div className="footer-stack__inner">
        <div className="footer-stack__top">
          <div className="footer-stack__brand">
            <Router.Link to="/" className="footer-stack__mark" aria-label="trygg home">
              <Logo />
              <span className="footer-stack__name">trygg</span>
            </Router.Link>
            <p className="footer-stack__tagline">
              Effect-native UI framework. Typed components, signals, generated clients.
            </p>
          </div>

          <div className="footer-stack__nav-group">
            <nav aria-label="Resources" className="footer-stack__nav">
              <h2 className="footer-stack__heading">Resources</h2>
              <ul role="list" className="footer-stack__links">
                <li>
                  <Router.Link to="/docs" className="footer-stack__link">
                    Docs
                  </Router.Link>
                </li>
                <li>
                  <Router.Link to="/changelog" className="footer-stack__link">
                    Changelog
                  </Router.Link>
                </li>
                <li>
                  <a
                    href={sections.community.github.href}
                    className="footer-stack__link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.npmjs.com/package/trygg"
                    className="footer-stack__link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    npm
                  </a>
                </li>
                <li>
                  <a
                    href="https://npmx.dev/package/trygg"
                    className="footer-stack__link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    npmx
                  </a>
                </li>
              </ul>
            </nav>

            <nav aria-label="Community" className="footer-stack__nav">
              <h2 className="footer-stack__heading">Community</h2>
              <ul role="list" className="footer-stack__links">
                <li>
                  <a
                    href="https://effect.website"
                    className="footer-stack__link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Effect
                  </a>
                </li>
                <li>
                  <a
                    href="https://discord.gg/BRDc7xGb5D"
                    className="footer-stack__link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Discord
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div className="footer-stack__base">
          <a
            href="https://github.com/EduSantosBrito/trygg/blob/main/LICENSE"
            className="footer-stack__small footer-stack__small--link"
            target="_blank"
            rel="noopener noreferrer"
          >
            MIT License
          </a>
          <small className="footer-stack__small">Made with trygg</small>
        </div>
      </div>
    </footer>
  );
});
