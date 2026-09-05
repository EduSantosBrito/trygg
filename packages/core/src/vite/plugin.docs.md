# Vite Plugin

Add trygg's JSX transform, route code-splitting, generated entry module, and dev API wiring to a Vite app with one plugin in `vite.config.ts`.

```ts
import { defineConfig } from "vite";
import { trygg } from "trygg/vite-plugin";

export default defineConfig({
  plugins: [trygg()],
});
```

## When to use

Add `trygg()` to `vite.config.ts` for every trygg app built on Vite. It is required, not optional. Without it, `.tsx` files never lower to trygg's JSX runtime, routes are not code-split, and the dev API path is not wired. There is nothing to configure for the common case; pass `TryggOptions` only to opt into non-default behavior.

## Behavior

The `trygg` factory configures Vite for the trygg JSX runtime, manages generated `.trygg` files, and boots the dev-time routing and API integration path from app config.

For `.tsx` modules, the plugin also applies a hidden JSX requirement lowering pass. User source stays as JSX, but Vite receives explicit `jsx` / `jsxs` calls from `trygg/jsx-runtime` so component child requirements remain visible to Trygg-owned tooling and generated type fixtures.

Current limitation: stock TypeScript, `tsgo --noEmit`, and editor hovers still parse raw JSX as `JSX.Element` without running Vite plugins, so they can still erase child component requirements until a Trygg-owned typecheck/editor integration feeds them the lowered virtual source.

### API readiness and reloads

When `app/api.ts` exists, dev startup imports it, validates its default export as a composed Layer, and acquires its handler resources before mounting `/api/*` middleware or reporting `API handlers loaded`. An import, Layer validation, or acquisition failure releases partial resources and fails dev-server setup; an unusable API is never reported as ready. When `app/api.ts` is absent, the rest of the dev server starts without API middleware.

On an `app/api.ts` change, the current handler keeps serving while a replacement is acquired. New requests switch only after the replacement is ready, and cleanup of the retired handler is awaited after the switch. Failure or interruption before the swap discards the candidate and retains the current handler. Interruption after the swap retains the new handler while cleanup of the retired handler finishes.

An active request's finalizers finish before the retired API Layer releases its services. The generated handler owns the HTTP Fiber as well as the response bridge, because completion or cancellation of the Web response Promise alone does not guarantee that request finalization has finished.

Reloads never overlap. Changes that arrive during an active reload coalesce into one follow-up pass instead of starting one pass per event. A typed failure does not suppress a follow-up that was already requested, so a later valid save can recover without restarting Vite.

### HTTP server spans

The generated development handlers and Node/Bun production servers project transport data before calling the configured tracer. Server spans retain method, pathname, route, status, timing, sampling, and distributed parent identifiers. They omit full URLs, queries, request and response headers, user-agent strings, and client addresses. Their terminal values carry success or failure classifications instead of response objects or original error values, including when sampling is disabled. Handler inputs, responses, and handler Exits retain their original values.

This projection applies to server spans in the generated HTTP context. Other span kinds pass through unchanged. Production API responses use one composed HTTP logger. Its automatic response records also project failure Causes to classifications before logger delivery. Application code keeps its original logger identities and local overrides; `HttpMiddleware.withLoggerDisabled` still suppresses the automatic response log.

### Lifecycle and middleware

Watcher callbacks, API reloads, API requests, streamed responses, and HTML fallback transforms belong to the Vite server instance that started them. Closing that instance detaches its watcher, cancels active work, and awaits cleanup. Repeated or concurrent terminal close and build-failure hooks share the same awaited shutdown, including middleware mode where there is no HTTP server close event.

During a Vite restart, closing the old server cleans up only the old instance; it does not tear down the replacement server or its middleware. The final close waits for current server work and then disposes the shared plugin runtime.

An API handle retained after its owner Scope closes cannot start another import or reload. A candidate resumed after shutdown is rejected before publication; already-acquired resources still finalize. If acquisition and cleanup both fail, their Causes remain observable together.

The API middleware consumes only `/api/*` requests and delegates everything else. The HTML fallback runs after Vite's own middleware and serves the transformed shell for non-file `GET` navigations. API paths, file-like asset paths, and non-`GET` requests continue to downstream middleware.

If Vite's HTML transform fails before the fallback writes a status or headers, the plugin delegates the untouched request downstream. Once a fallback response has begun, a failure is reported and is not delegated or replaced with a second response.

### Development API requests

The development API bridge does not read bodies for `GET` or `HEAD`. For every other method, it buffers at most 1,048,576 bytes (1 MiB), inclusive. A larger body is drained and receives `413 Payload Too Large`. Other non-cancellation request or response failures that occur before headers are sent receive `500 Internal Server Error`; after headers are sent, the plugin does not overwrite the partial response.

A client disconnect or plugin shutdown aborts the web Request and cancels pending body reads, API handling, and response streaming without synthesizing another response. Shutdown waits for that work to finish. If a streamed response does not complete, its reader is canceled and its lock and native listeners are released.

The generated handler owns a streaming response even before the bridge acquires its reader, including a body replaced by an application pre-response handler. For `HEAD`, it preserves response metadata and closes request resources without starting a body stream.

Repeated `Set-Cookie` response fields remain separate header values, including cookies whose `Expires` attribute contains a comma. They are never folded into one comma-delimited cookie value.

The `api.request.received` Trace record contains only the request method and pathname. Query strings, fragments, URL authority, headers, and bodies are omitted from that record.

### Production readiness

For `output: "server"`, the generated process validates `PORT` and `HOST`, reads the generated SPA shell, acquires API and server Layers, and binds the listener before it reports `Server listening`. Invalid configuration, an unreadable shell, API acquisition failure, or a bind failure exits with a typed failure and never emits that readiness message.

## Related exports

- `trygg`
- `TryggOptions`
- `TryggPlugin`

## Troubleshooting

- **`trygg(...)` throws `TryggConfigError` before Vite starts.** The plugin decodes config synchronously, including values that came from JavaScript or bypassed TypeScript. Use `defineConfig`, pass only `platform: "bun" | "cloudflare" | "node"` and `output: "server" | "static"`, and check the Configuration guide for unsupported platform/output combinations. The error retains the original Schema failure in `cause`.
- **Dev startup fails with `ApiInitError` or `ImportError`.** The initial API never became ready, so no API middleware was mounted. Check that platform dependencies resolve, `app/api.ts` imports succeed, and its default export is a composed Layer. If the app imports `trygg/api`, also export the named `Api` value.
- **A save logs `[api] reload.failed`.** The replacement API could not be imported, validated, or acquired. The previous healthy handler is still serving; fix the typed error and save `app/api.ts` again to retry.
- **A generated server exits with `ServerConfigError`, `ServerFileSystemError`, or `ServerStartupError`.** For `ServerConfigError`, use a non-empty `HOST` and an integer `PORT` from 1 through 65535. For `ServerFileSystemError`, rebuild and verify the generated client shell was deployed and is readable. For `ServerStartupError`, check the typed reason for an occupied, unavailable, or disallowed bind address.
- **A dev API request returns `413`.** Keep non-`GET`/`HEAD` request bodies at or below 1,048,576 bytes. The development bridge's bound is fixed and is enforced on bytes received rather than trusting `Content-Length`.
- **You need to share diagnostics.** Share the typed error tag and reason, the selected platform/output, and only sanitized paths. Do not paste a raw Cause, environment values, query strings, fragments, authorization or cookie headers, or request/response bodies. Routine request Trace records omit URL secrets, but nested import and operating-system causes are not a general redaction boundary.
