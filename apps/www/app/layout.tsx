/**
 * Root Layout: trygg.dev
 *
 * Minimal document structure for landing page.
 * Supports light and dark themes with no flash on load.
 */
import "../styles.css";

import { Component } from "trygg";
import * as Router from "trygg/router";

import { themeColor, themeInitScript } from "./lib/theme";

const seo = {
  title: "trygg: Effect-native UI framework",
  description:
    "TypeScript UI framework built on Effect. Component types declare props, typed errors, and service dependencies. Signals, HttpApi contracts, generated clients.",
  url: "https://trygg.dev",
} as const;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  name: "trygg: Effect-native UI framework",
  description: seo.description,
  url: seo.url,
  codeRepository: "https://github.com/EduSantosBrito/trygg",
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
    <html lang="en" data-theme="light">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script>{themeInitScript}</script>

        {/* Primary Meta */}
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <meta
          name="keywords"
          content="Effect, TypeScript, full-stack UI framework, HttpApi, generated API client, fine-grained reactivity, dependency injection, type-safe, JSX, signals"
        />
        <meta name="author" content="Eduardo Santos Brito" />
        <meta name="robots" content="index, follow, max-image-preview:large" />
        <meta name="googlebot" content="index, follow, max-image-preview:large" />
        <link rel="canonical" href={seo.url} />
        <link rel="sitemap" type="application/xml" href="/sitemap.xml" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content={seo.url} />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:site_name" content="trygg" />
        <meta property="og:image" content={`${seo.url}/og/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:alt" content="trygg: Effect-native UI framework" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={seo.title} />
        <meta name="twitter:description" content={seo.description} />
        <meta name="twitter:image" content={`${seo.url}/og/og-image.png`} />

        {/* Theme */}
        <meta name="theme-color" content={themeColor("light")} />
        <meta name="color-scheme" content="light dark" />

        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@700&display=swap"
          rel="stylesheet"
        />

        {/* Favicon */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

        {/* JSON-LD */}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </head>
      <body>
        <Router.Outlet />
      </body>
    </html>
  );
});
