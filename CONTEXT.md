# trygg — Domain Context

## Brand

- **mark** — The pixel-ladder SVG icon (viewBox 0 0 40 48). A geometric symbol composed of staggered 7×7 rectangles at varying opacities. Used standalone (favicon) or paired with the wordmark.
- **wordmark** — The text "trygg" displayed in the brand typeface. Always lowercase.
- **brand lockup** — The mark paired with the wordmark. Used in social cards (OG images). The mark is positioned to the left of the wordmark.

## Visual identity

- Primary brand color: `#8b5cf6` (purple). Used at opacities 100%, 60%, 32%, and 7% across mark rectangles.
- Dark-only presentation. Background: `#050508`.
- Typefaces: IBM Plex Sans (body), IBM Plex Mono (code).

## trygg.dev (landing page)

- Single landing page site serving the trygg UI framework.
- Routes: `/` (home), `/changelog`, `/changelog/:name`.
- Purpose: marketing page for the trygg framework.

## Build output modes

- **Static SPA** — A deploy-target neutral client build. Serves the SPA shell for app routes and static assets directly. Does not imply SSR, API routes, or a Worker-specific runtime.
- **SPA shell** — The public HTML entry for Static SPA output. Canonical build path: `dist/index.html`.
- **Runtime platform** — The environment trygg targets when generating runtime-specific integration code. Known platforms include Bun, Node, and Cloudflare.
- **Cloudflare platform selection** — Cloudflare Worker artifacts are generated only when the runtime platform is explicitly `cloudflare`; deploy-tool detection is not part of the contract.
- **Cloudflare Static SPA** — `output: "static"` on the Cloudflare runtime platform. trygg generates a minimal Worker that serves static assets directly and falls back document-like app routes to the SPA shell without reserving `/assets` as route space.
- **Static API exclusion** — Static SPA output does not include `app/api.ts`. On Cloudflare, API routes with Static SPA output are invalid rather than silently ignored.
- **Cloudflare server output** — `output: "server"` on the Cloudflare runtime platform. Intended to preserve the same app and API semantics as Bun and Node server output, with Cloudflare-specific runtime plumbing.
- **Cloudflare Worker artifact** — The deployment contract for the Cloudflare runtime platform. Deploy tools such as alchemy may consume it, but trygg does not define Cloudflare behavior in terms of a specific deployment tool.
- **Worker entry** — The generated entrypoint for a Cloudflare Worker artifact. Canonical generated path: `.trygg/worker-entry.js`.
- **Cloudflare assets binding** — The Worker binding named `ASSETS` used by Cloudflare Static SPA output to serve generated static files.
- **Generated workspace** — `.trygg` is an internal generated source/cache directory. It must not be part of the public `dist` contract.
- **SPA fallback** — In Static SPA output, the runtime tries static assets first and preserves successful asset responses unchanged. If no asset exists and the request is a `GET` or `HEAD` document-like request, it returns the SPA shell. Detection uses request semantics such as `Accept` and `Sec-Fetch-Dest`, with a small denylist for missing generated asset extensions. Extensionless routes such as `/assets` remain client routes. Route-level not-found behavior belongs to the client router.
