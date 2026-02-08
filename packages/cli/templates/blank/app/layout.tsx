import "../styles.css";
import { Component, DevMode } from "trygg";
import * as Router from "trygg/router";

export default Component.gen(function* () {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="A trygg app" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <title>trygg</title>
      </head>
      <body className="m-0 min-h-screen font-sans antialiased">
        <DevMode />
        <a
          className="absolute left-4 top-[-3rem] z-20 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--ink)] no-underline focus-visible:top-4 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          href="#main-content"
        >
          Skip to content
        </a>
        <Router.Outlet />
      </body>
    </html>
  );
});
