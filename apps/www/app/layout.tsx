/**
 * Root Layout — trygg.dev
 *
 * Minimal document structure for landing page.
 * Dark theme, technical aesthetic.
 */
import "../styles.css";

import { Component } from "trygg";
import * as Router from "trygg/router";

const seo = {
  title: "trygg — Effect-native UI framework",
  description:
    "Effect-native UI framework with fine-grained reactivity, type-safe routing, and dependency injection built in. Components that compose like Effects.",
  url: "https://trygg.dev",
} as const;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "trygg",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  description: seo.description,
  url: seo.url,
  author: {
    "@type": "Person",
    name: "Eduardo Santos Brito",
    url: "https://github.com/EduSantosBrito",
  },
  license: "https://opensource.org/licenses/MIT",
  programmingLanguage: "TypeScript",
};

export default Component.gen(function* () {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        {/* Primary Meta */}
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <meta
          name="keywords"
          content="Effect, TypeScript, UI framework, fine-grained reactivity, dependency injection, type-safe, JSX, signals"
        />
        <meta name="author" content="Eduardo Santos Brito" />
        <link rel="canonical" href={seo.url} />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content={seo.url} />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:site_name" content="trygg" />
        {/* TODO: add og:image when available */}

        {/* Twitter */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={seo.title} />
        <meta name="twitter:description" content={seo.description} />
        {/* TODO: add twitter:image and twitter:site when available */}

        {/* Theme */}
        <meta name="theme-color" content="#050508" />
        <meta name="color-scheme" content="dark" />

        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />

        {/* Favicon */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

        {/* JSON-LD */}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>

        {/* DataFast Analytics */}
        <script id="datafast-queue">
          {`window.datafast = window.datafast || function() {
            window.datafast.q = window.datafast.q || [];
            window.datafast.q.push(arguments);
          };`}
        </script>
        <script
          defer
          data-website-id="dfid_BbESRIMl3PZCy5JAfLnWQ"
          data-domain="trygg.dev"
          src="https://datafa.st/js/script.js"
        />
      </head>
      <body>
        <Router.Outlet />
      </body>
    </html>
  );
});
