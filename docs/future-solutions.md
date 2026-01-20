# Future Solutions (effect-ui)

## Status: In Progress
**Last Updated:** 2026-01-19
**Architect:** OpenCode

---

## Solution Index
| ID | Finding | Category | Priority | Status | Solution Link |
|----|---------|----------|----------|--------|---------------|
| FUT-001 | API Routes (effect-first, platform-agnostic) | Feature/Security | HIGH | ❓ Needs Revision | [Link](#fut-001) |
| FUT-002 | Data Fetching Resource API | Feature/Performance | HIGH | ❓ Needs Revision | [Link](#fut-002) |

---

## Detailed Solutions

### FUT-001: API Routes (effect-first, platform-agnostic)
**Status:** ❓ Needs Revision
**Category:** Feature / Security / Reliability
**Priority:** HIGH
**Files Affected:** `src/vite-plugin.ts`, `src/api/*` (new), `src/index.ts`, `effect-ui.config.ts` (new), `docs/design.md`

#### Original Finding
> API routes with `src/api/**/route.ts` convention, schema-driven validation, build-time checks, and per-app error mapping. Platform agnostic; adapters inject platform services.

#### Clarifying Questions
1. How is platform selected?
   - **Answer:** CLI writes config (bun/node). Platform support mirrors Effect platform support.
2. Build-time integration location?
   - **Answer:** Use the existing Vite plugin.
3. Client surface?
   - **Answer:** Public `effect-ui/api` with `ApiClient.make(...)` Layer (end-user imports only this).
4. Error mapping policy?
   - **Answer:** Default tag mapping + custom errors via a status-like pattern.
5. Build-time validation strategy?
   - **Answer:** Use Vite `ssrLoadModule` to evaluate route modules for real schema validation.
6. Internal manifest strategy?
   - **Answer:** Keep virtual manifest internal (end users never import virtual modules).

#### Analysis
There is no server-side API routing pipeline yet; only the client router exists. The desired API model is schema-first and adapter-agnostic, which implies: (1) a build-time collector/validator for routes, (2) a runtime router that decodes/encodes using Effect Schema, and (3) a typed client generated from the same contract.

#### Proposed Solution
**Approach:** Extend the Vite plugin to scan `src/api/**/route.ts`, validate exports and schemas, generate server route manifests and a typed client module, and rely on Effect platform adapters for execution.

**Build-time (Vite plugin):**
- Scan `src/api/**/route.ts` and derive `/api/**` paths (same param rules as routes).
- Validate required exports: `METHOD`, `schema`, `handler`.
- Validate schema constraints:
  - `schema.response` required
  - `schema.body` forbidden for GET/HEAD
  - `schema.params` keys match path params
  - `schema.error` required if handler error type is not `never` (if enforceable)
- Generate `virtual:effect-ui-api` module for typed client + route metadata.
- Emit `api-routes.d.ts` to augment a `RouteApiMap` for typed requests.

**Runtime (API router):**
- Add `src/api/router.ts` with:
  - `RouteSchema` type (params/query/body/response/error)
  - `RouteHandler` type: `(req: Request) => Effect<Response, ApiError, never>`
  - `decodeRequest` helpers (`req.params`, `req.query`, `req.body`) using `Schema.decode`
  - `handleApiRoute` to map decode failures -> 400 and handler failures -> status mapping
- Provide `ApiErrorMap` service:
  - If `error.status` exists, use it
  - Else map by `_tag` using configurable map
  - Else 500
  - Default map includes common tags: `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `ValidationError`

**Platform config:**
- Add `effect-ui.config.ts` at project root:
  - `{ platform: "bun" | "node" | "edge"; apiBasePath?: "/api" }`
- CLI writes this file; adapters use it to select Effect platform integration.

**Client surface (public, end-user):**
- Export `ApiClient` Context.Tag from `effect-ui/api` with typed endpoints:
  - `api.users.get({ params, query, body }) -> Effect<Res, Err, never>`
- `ApiClient.make({ baseUrl?, fetch? })` returns a Layer using Effect HttpClient or provided fetch.
- Generated endpoint functions encode params/query/body with schema and decode response/error.
- Internal manifest uses a virtual module, but end users never import it.

#### Implementation Plan
- [ ] Extend Vite plugin to scan `src/api/**/route.ts` and emit `virtual:effect-ui-api` + `api-routes.d.ts`.
- [ ] Add API router runtime (`src/api/router.ts`) with schema decode helpers and error mapping.
- [ ] Add `effect-ui.config.ts` loader and platform adapter selection.
- [ ] Wire exports in `src/index.ts` (types + helpers only).
- [ ] Docs: add API route docs + client usage in `docs/design.md`.
- [ ] Tests: plugin validation + router decode + error mapping.

#### Verification
- [ ] Build fails when `METHOD`/`schema`/`handler` missing or invalid.
- [ ] `GET` with `schema.body` fails build with actionable error.
- [ ] Path params mismatch fails build with explicit key list.
- [ ] Decode failures return 400.
- [ ] `error.status` respected; fallback `_tag` map applied.

#### Review
**Reviewed:** 2026-01-20
**Reviewer:** OpenCode
**Review Verdict:** ⚠️ Needs Revision

**Review Notes:**
- Missing TL;DR, effort estimate, and risk estimate sections.
- Tests are listed but not in required test-case format or with concrete cases.
- Vague details: “same param rules as routes”, error-type enforcement, request type (`Request` vs `HttpServerRequest`).
- Potential duplication of Effect `HttpApiBuilder` / `HttpApiError` / `HttpApiClient` patterns; needs explicit alignment or rationale.

**Required Actions:**
1. [ ] Add TL;DR plus effort/risk estimates.
2. [ ] Replace test bullets with required test format (happy, error, edge cases).
3. [ ] Specify request type, path-param rules, and decode/error mapping behavior (e.g., `Schema.decodeUnknown` + `HttpApiDecodeError`).
4. [ ] Decide whether to build custom router/client or reuse Effect HttpApi APIs; document choice.

---

### FUT-002: Data Fetching Resource API
**Status:** ❓ Needs Revision
**Category:** Feature / Performance
**Priority:** HIGH
**Files Affected:** `src/data/*` (new), `src/index.ts`, `docs/design.md`

#### Original Finding
> Resource-based data fetching with `Data.resource`, `Data.fetch`, and `Data.match`. Inline failure handling; no boundary-first variant.

#### Clarifying Questions
1. Should `Data.fetch` be the only entry (no `fetchOrFail`)?
   - **Answer:** Yes. Only `Data.fetch`.
2. Should failures be handled inline via `Data.match` (error boundary style)?
   - **Answer:** Yes. Failure branch returns an element.
3. Should resources be cached by key across mounts and dedupe concurrent requests?
   - **Answer:** Yes.
4. Do you want an explicit invalidation/refetch API (e.g., `Data.invalidate`, `Data.refresh`)?
   - **Answer:** Yes. Add invalidate/refresh.

#### Analysis
No data fetching layer exists. The desired DX is Effect-first, schema-agnostic, and UI-friendly. Caching + dedupe require a shared registry to persist across component lifetimes while remaining explicit and controllable.

#### Proposed Solution
**Approach:** Introduce a `DataRegistry` service keyed by resource key; `Data.resource` registers the fetcher; `Data.fetch` returns a Signal-backed state that re-renders on updates; `Data.match` renders pending/failure/success inline.

**API:**
- `Data.resource({ key, fetch })` returns a Resource descriptor.
- `Data.fetch(resource)`:
  - Returns `Signal<DataState<A, E>>` (pending/failure/success)
  - Starts fetch if no cached state or if invalidated
  - Dedupes concurrent fetches via `Deferred` per key
- `Data.match(state, { pending, failure, success })`:
  - Returns an Element that subscribes to the state signal
  - `failure` must return an Element (acts as local error boundary)

**DataRegistry details:**
- `Map<string, ResourceEntry>` where entry contains:
  - `state: Signal<DataState<A, E>>` (success includes `stale: boolean`)
  - `inFlight?: Deferred<Exit<...>>` to dedupe fetch
  - `timestamp` for potential TTL (optional later)
- Effects use Scope finalizers to cleanup if registry is scoped; default registry lives at app root.

#### Implementation Plan
- [ ] Create `src/data/` module with `DataState`, `Data.resource`, `Data.fetch`, `Data.match`, `Data.invalidate`, `Data.refresh`.
- [ ] Add `DataRegistry` Context.Tag and default layer.
- [ ] Implement dedupe via per-key in-flight Deferred.
- [ ] Implement stale-while-revalidate: `Data.invalidate` marks `stale=true` and triggers background fetch.
- [ ] Export from `src/index.ts`.
- [ ] Docs: add data fetching section + failure semantics in `docs/design.md`.
- [ ] Tests: caching, dedupe, refresh/invalidate, stale flag, and render updates.

#### Verification
- [ ] Multiple mounts with same key reuse cached state (no refetch).
- [ ] Concurrent `Data.fetch` calls dedupe (single request).
- [ ] Failure renders failure element and does not throw.
- [ ] `Data.invalidate` marks `stale=true`, preserves last success, triggers background fetch.
- [ ] Success updates only the subscribed subtree.

#### Review
**Reviewed:** 2026-01-20
**Reviewer:** OpenCode
**Review Verdict:** ⚠️ Needs Revision

**Review Notes:**
- Missing TL;DR, effort estimate, risk estimate, and code-change examples.
- Tests listed only as topics; required test-case format + cases missing.
- API signatures vague: `Data.resource`/`Data.fetch`/`Data.match`/`Data.invalidate`/`Data.refresh` types and `Signal` source not defined.
- Cache semantics unclear: key derivation, state transitions (pending → success/failure), `stale` behavior on error, and cancellation/unmount cleanup.
- Potential naming conflict with `effect/Data`; no guidance on import ergonomics.

**Required Actions:**
1. [ ] Add TL;DR plus effort/risk estimates and a concrete code sketch for each API.
2. [ ] Replace test bullets with required test format including happy/error/edge cases.
3. [ ] Specify API signatures (Effect return types, error types, environment R), `Signal` type origin, and lifecycle rules.
4. [ ] Define cache key strategy and state transitions for invalidation/refresh/dedupe.

---


---

## Session Log
### 2026-01-19 - Solution Session
- Processed findings: FUT-001, FUT-002
- Decisions finalized: FUT-001 (public ApiClient.make + internal virtual manifest, module evaluation for validation), FUT-002 (invalidate -> stale + background fetch)
- Solutions proposed: FUT-001, FUT-002
- Next: implement when ready
