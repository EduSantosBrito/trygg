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
- **Runtime platform** — The environment trygg targets when generating runtime-specific integration code. Known platforms include Bun, Node, and Cloudflare.
- **Cloudflare Static SPA** — `output: "static"` on the Cloudflare runtime platform. trygg generates a minimal Worker that serves static assets directly and falls back app routes to the SPA shell.
- **Cloudflare server output** — `output: "server"` on the Cloudflare runtime platform. Intended to preserve the same app and API semantics as Bun and Node server output, with Cloudflare-specific runtime plumbing.
- **Cloudflare Worker artifact** — The deployment contract for the Cloudflare runtime platform. Deploy tools such as alchemy may consume it, but trygg does not define Cloudflare behavior in terms of a specific deployment tool.
- **Worker entry** — The generated entrypoint for a Cloudflare Worker artifact. Canonical generated path: `.trygg/worker-entry.js`.
- **Cloudflare assets binding** — The Worker binding named `ASSETS` used by Cloudflare Static SPA output to serve generated static files.
- **SPA fallback** — In Static SPA output, the runtime tries static assets first. If no asset exists and the request is a `GET` or `HEAD` HTML navigation, it returns the SPA shell. Missing generated asset-like URLs remain 404s. Route-level not-found behavior belongs to the client router.
