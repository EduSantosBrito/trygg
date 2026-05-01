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
- AI crawler policy: allow AI training, search, and agent input to improve framework discoverability.

## Build output modes

- **Static SPA** — A deploy-target neutral client build. Serves the SPA shell for app routes and static assets directly. Does not imply SSR, API routes, or a Worker-specific runtime.
- **SPA shell** — The public HTML entry for Static SPA output. Canonical build path: `dist/index.html`.
- **Runtime platform** — The environment trygg targets when generating runtime-specific integration code. Known platforms include Bun, Node, and Cloudflare.
- **Cloudflare platform selection** — Cloudflare Worker artifacts are generated only when the runtime platform is explicitly `cloudflare`; deploy-tool detection is not part of the contract.
- **Cloudflare Static SPA** — `output: "static"` on the Cloudflare runtime platform. trygg generates a minimal Worker that serves static assets directly and falls back document-like app routes to the SPA shell without reserving `/assets` as route space.
- **Static API exclusion** — Static SPA output does not include `app/api.ts`. On Cloudflare, API routes with Static SPA output are invalid rather than silently ignored.
- **Cloudflare server output** — `output: "server"` on the Cloudflare runtime platform. Preserves the same app and API contract as Bun and Node server output, while respecting Cloudflare-specific operational constraints such as Worker request lifecycle, bindings, and runtime compatibility limits. It should be enabled incrementally: supported server features build and deploy, while unsupported platform assumptions fail with targeted diagnostics instead of blocking the entire platform.
- **Cloudflare server MVP** — The first supported Cloudflare server output slice. It supports `app/api.ts`, serves static assets through the Cloudflare assets binding, and falls back app document routes to the SPA shell. It does not imply full SSR route rendering unless that becomes part of the broader server output contract.
- **Cloudflare server fallback** — In Cloudflare server output, non-API document-like requests use the same SPA fallback behavior as Cloudflare Static SPA. The Worker composes `/api/*` server routing with static asset serving and document fallback; client route-level not-found behavior remains owned by the client router.
- **Server API route space** — In server output, `/api/*` is reserved for server API routes. Cloudflare server output follows the same route boundary as Bun and Node server output.
- **Server output precondition** — Across all runtime platforms, `output: "server"` requires server-owned behavior. Today, the only server-owned behavior is `app/api.ts`. If a build has no server-owned behavior, users should use `output: "static"`; Trygg should fail server output at build time with the same explicit validation style used for other invalid output combinations. Future server features must be added to this definition deliberately.
- **Server output smoke contract** — Generated server output must successfully serve API routes, generated static assets, and SPA fallback responses on every supported runtime platform. A platform server build is not considered valid if its generated response path fails at runtime.
- **Platform layer** — The Effect Layer implementation of a runtime platform contract. It provides the platform-specific services needed to run generated Trygg artifacts without changing the app-level output contract.
- **Cloudflare HTTP platform layer** — The Effect HTTP platform layer for Cloudflare Workers. Cloudflare server output should run app/API handling through Effect HTTP APIs, with the generated Worker only bridging Cloudflare `fetch(request, env, ctx)` into the Effect HTTP request/response model.
- **Cloudflare local runtime** — Trygg may use `@distilled.cloud/cloudflare-runtime` internally for Cloudflare tests because it provides Effect-native workerd orchestration. Public Cloudflare preview UX is deferred. Generated production Worker code remains independent of this package and uses Effect HTTP directly at the Cloudflare `fetch(request, env, ctx)` boundary.
- **Cloudflare Worker artifact** — The deployment contract for the Cloudflare runtime platform. Deploy tools such as alchemy may consume it, but trygg does not define Cloudflare behavior in terms of a specific deployment tool.
- **Worker entry** — The generated entrypoint for a Cloudflare Worker artifact. Canonical generated path: `.trygg/worker-entry.js`. Cloudflare Static SPA and Cloudflare server output share this artifact concept and path; server output adds API capability rather than introducing a separate deployment artifact.
- **Cloudflare assets binding** — The standard Cloudflare Workers Static Assets binding named `ASSETS`. Cloudflare Static SPA and Cloudflare server output use it to serve generated static files and participate in SPA fallback routing; preview and deploy tooling are responsible for providing the binding. The binding name is fixed to `ASSETS` until a concrete custom-binding use case appears.
- **Generated workspace** — `.trygg` is an internal generated source/cache directory. It must not be part of the public `dist` contract.
- **SPA fallback** — In Static SPA output, the runtime tries static assets first and preserves successful asset responses unchanged. If no asset exists and the request is a `GET` or `HEAD` document-like request, it returns the SPA shell. Detection uses request semantics such as `Accept` and `Sec-Fetch-Dest`, with a small denylist for missing generated asset extensions. Extensionless routes such as `/assets` remain client routes. Route-level not-found behavior belongs to the client router.
- **Framework-owned build noise** — Build warnings caused by Trygg generated/runtime internals that app authors cannot reasonably act on. Trygg should hide these from normal app build and deploy output without hiding user-owned warnings.
