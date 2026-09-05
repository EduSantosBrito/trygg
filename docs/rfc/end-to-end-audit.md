# End-to-end RFC audit

Status: **in progress**. Started 2026-09-04 against the current uncommitted worktree.

The goal is implementation-wide compliance with every applicable requirement of
[RFC 1.1](./effect-first.md), plus evidence-driven performance optimization within
Trygg's correctness, Effect ownership, typing, and API constraints. The prior
[adoption report](./trygg-adoption.md) is scoped evidence, not completion of this audit.

## Completion criteria

Latest continuation (2026-09-05): [bounded SigNoz render profiling](./profiling-signoz.md)
adds 19 tests and opt-in granular phase instrumentation. The full suite now passes
1,924 tests; build, types, Effect diagnostics and the 345-export docs contract pass.
The same seven pre-existing scaffold format failures still block `bun run check`.
Two final browser profiles received collector acceptance for 15,400 spans with
locally validated parentage. The initial 401 was resolved by the Infisical-backed
MCP launch: one authenticated query retrieved a complete seven-span trace.
Exhaustive ingestion and the historical granular performance gap remain open. This evidence
does not change the historical finding count or close additional RFC clauses.

- Review every clause below at all applicable production owners: core, browser
  adapters, router, resource registry, Vite/server generation, CLI, templates,
  observability, and executable roots. Account for the 73 historical findings.
- Record actual enforcement and behavioral/type-level evidence. Mark a clause
  not applicable only after confirming that the corresponding capability is absent.
- Fix demonstrated violations with regression tests, including failure, interruption,
  resource ownership, cache identity, boundary input, and telemetry isolation.
- Measure renderer interactions in a real browser, runtime primitives, retained
  memory and cleanup, and production bundle/startup costs. Preserve raw samples,
  workload assertions, environment, and comparable before/after measurements.
- Use primary research sources to form hypotheses; accept optimizations only when
  measurements support them and correctness/lifecycle evidence remains green.
- Pass build, complete tests, lint/format, types, Effect diagnostics, docs, and
  consumer builds. Explicitly account for anything these checks do not prove.

## Clause ledger

`Pending` means the complete scope of that clause has not been verified. Green
suites or an isolated fix do not automatically mark a clause complete.

| Clause | Requirement group                            | Status         | Owner and evidence                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | -------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1    | Installed Effect Version                     | Verified       | Workspace catalog/lockfile pin Effect 4.0.0-rc.112; full build/typecheck passes; source search finds no production imports from .repos                                                                                                                                                                                                                                                              |
| 6.2    | Language                                     | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 6.3    | Formatting and Comments                      | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 7.1    | Boundary Decoding                            | Pending        | Canonical configuration decodes at defineConfig; generated Node/Bun env boundaries are tested through real processes, including inclusive PORT limits and project-owned failures. Checker project diagnostics and route schema input audits also pass; other transported boundaries remain to review                                                                                                |
| 7.2    | Canonical Representations                    | Pending        | Outlet/prefetch use the same compiled RouteMatcher as direct matching; the duplicate trie is gone. Dynamic names, malformed encoding, wildcard/catch-all behavior, and suffix rejection have shared evidence. Other canonical representation owners remain to inspect                                                                                                                               |
| 7.3    | Patch Semantics                              | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 7.4    | Branded Values                               | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 8.1    | Functions                                    | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 8.2    | Namespaces                                   | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 8.3    | Services                                     | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 8.4    | Effect Function Forms                        | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 8.5    | Owner-Qualified Construction                 | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 9.1    | Layer Construction                           | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 9.2    | Composition Root                             | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 9.3    | Placement and Sharing                        | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 9.4    | Freshness                                    | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 9.5    | Runtime Ownership                            | Pending        | Vite lifecycle verified: real normal/middleware servers share shutdown completion and dispose ManagedRuntime after blocked API cleanup; see historical 039. Other runtime roots still require complete review                                                                                                                                                                                       |
| 9.6    | Custom Layer Graphs                          | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 10.1   | Typed Failures                               | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 10.2   | Defects                                      | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 10.3   | Cause Handling                               | Pending        | Render transaction, reactive worker, and actual ErrorBoundary matrices preserve terminal Reasons; new staged rollback tests retain typed render failure in finalizer Exits and combine cleanup defects. Remaining Cause-level owners still require review                                                                                                                                           |
| 10.4   | Interruption                                 | Pending        | NavigationCore preserves an applied mutation's snapshot before reporting interruption, and queued callers remain cancellable. Router-owned publication survives caller cancellation and has reentrancy/awaited-cleanup tests. RouteActivation tests cover superseded load/fallback/swap/scroll finalization. Remaining owners still require review                                                  |
| 11.1   | Repository Intent                            | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 11.2   | Atomicity                                    | Not applicable | No durable mutation-plus-fact transaction is exposed; browser storage is a scalar capability and the incident repository explicitly documents volatile state                                                                                                                                                                                                                                        |
| 11.3   | Commit Before Notify                         | Not applicable | No durable fact/advisory delivery protocol exists; reactive publication ordering is reviewed under concurrency and observability                                                                                                                                                                                                                                                                    |
| 11.4   | Delivery                                     | Not applicable | No durable delivery queue, claim, recovery poll, or persisted pending fact is implemented or promised                                                                                                                                                                                                                                                                                               |
| 11.5   | Idempotency and Concurrent Writes            | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 11.6   | Migrations                                   | Not applicable | No database schema migration or historical durable representation migration is implemented; browser value decoding remains covered by boundary review                                                                                                                                                                                                                                               |
| 12.1   | Structured Ownership                         | Pending        | Generated HTTP and stream fibers attach before user instructions; native disconnect, reload, unconsumed response, and HEAD tests verify release ordering. Browser callback and Resource worker regressions also pass; remaining owners and failure combinations still need review                                                                                                                   |
| 12.2   | Primitive Selection                          | Pending        | Signal.update serializes read/equality/commit and releases its gate before listeners; barrier and reentrancy tests verify historical 049. Versioned derive/deriveAll/cx acquisition tests verify 050. Remaining owner coordination and boundedness decisions require full review                                                                                                                    |
| 12.3   | Single Flight and Locking                    | Pending        | NavigationCore owns a private semaphore and state Ref; adapter mutation and snapshot commit serialize while listeners run outside that lock. Slow-adapter/slow-listener and queued-cancellation tests pass. Built-in Outlet uses bounded monotonic activation identity; arbitrary application IDs retain exact rejection history for their coordinator lifetime. Remaining coordinators need review |
| 12.4   | Resource Acquisition                         | Pending        | Node/Bun candidate acquisition rolls back partial work and rejects closed owners; generated responses retain request cleanup through streaming and HEAD. Portal, root mount, testing container, and static DOM acquisition/failed handoff regressions pass, including reentrant interruption and failed native removal. This does not cover every acquisition site                                                                                                                            |
| 12.5   | Overload                                     | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 13.1   | Selection                                    | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 13.2   | Resource Lifetime                            | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 13.3   | Callback Sources                             | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 13.4   | Ordering and Concurrency                     | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 14.1   | Workflow Selection                           | Verified       | Production core, CLI, and templates use ordinary Effect for process-bound work; no unstable/workflow imports or durable replay contract                                                                                                                                                                                                                                                             |
| 14.2   | Replay Safety                                | Not applicable | No Workflow executions, persisted intermediate results, or Activities                                                                                                                                                                                                                                                                                                                               |
| 14.3   | Activity Delivery Semantics                  | Not applicable | No Activity external-delivery protocol                                                                                                                                                                                                                                                                                                                                                              |
| 14.4   | Background Delivery                          | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 15.1   | Architecture                                 | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 15.2   | Representation                               | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 15.3   | Failure and Consistency                      | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 16.1   | Configuration                                | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 16.2   | Secrets                                      | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 16.3   | External APIs                                | Pending        | HTTP bridge capacity, native disconnect, body/reader cancellation, and generated response ownership verified under historical 040. Callback adapters have scoped registration tests; remaining external boundaries still require review                                                                                                                                                             |
| 16.4   | Time and Randomness                          | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 17.1   | Canonical Event                              | Pending        | Intrinsic children contribute one cost outcome; the keyed list publishes one semantic event with committed counts. Tests and Chromium verify bounded Info volume, retained failure facts, and DOM identity. Other lifecycle owners remain pending. |
| 17.2   | Typed Facts                                  | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 17.3   | Emission and Failure                         | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 17.4   | Sampling and Cardinality                     | Pending        | Generated HTTP server spans project URL/header/response/Cause data before tracer delivery, including unsampled spans. Automatic response logs also project Causes before delivery; real dev factory and production Node/Bun probes pass. Remaining event/cardinality owners and sampling policies still require review                                                                              |
| 17.5   | Annotation and Logging                       | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 18.1   | Authoritative Inputs                         | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 18.2   | Handlers                                     | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 18.3   | Error Translation                            | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 18.4   | Authorization                                | Pending        | Incident authentication now uses a configured operator token, native verification, and a trusted policy before repository acquisition. Missing/invalid credentials, policy denial, application ownership, and real HTTP challenge are tested. Final applicability inventory beyond this template remains pending                                                                                    |
| 19.1   | Subject and Seams                            | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 19.2   | Test Layers                                  | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 19.3   | Adapter Conformance                          | Pending        | Historical 068 verified shared DOM/Storage browser/test contract cases with actual mutation and native backend isolation. Other ports still require complete shared-case inventory                                                                                                                                                                                                                  |
| 19.4   | Intent and Interaction                       | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 19.5   | Concurrency and Time                         | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 19.6   | Persistence, Delivery, and Workflow Evidence | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 19.7   | Stream Evidence                              | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 20.1   | File Ownership                               | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 20.2   | Module Order                                 | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 20.3   | Export and Layer Naming                      | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 20.4   | Imports and Barrels                          | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 20.5   | Circular Construction                        | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 20.6   | Orchestration Concepts                       | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 21.1   | Invalid Input or Stored Data                 | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 21.2   | Missing Dependencies and Readiness           | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 21.3   | Overload                                     | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 21.4   | Delivery and Replay                          | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 21.5   | Observability Context                        | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 21.6   | Unsupported Adapter Behavior                 | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 22     | Options and Extension Points                 | Pending        | To inspect actual optional configurations                                                                                                                                                                                                                                                                                                                                                           |
| 23.1   | Resource Multiplication                      | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 23.2   | Backpressure and Memory                      | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 23.3   | Retry Amplification                          | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 23.4   | Cache Stability                              | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 23.5   | Startup and Shutdown                         | Pending        | Vite readiness, acquire-before-swap reload, active request/stream cleanup, concurrent terminal hooks, and runtime disposal verified under historical 037–040. Complete lifecycle coverage of every host remains pending                                                                                                                                                                             |
| 23.6   | Workflow Stability                           | Not applicable | No persisted Workflow/Activity names or executions to migrate                                                                                                                                                                                                                                                                                                                                       |
| 23.7   | Telemetry Cost                               | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 23.8   | Durable Storage Growth                       | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 24     | Operational Management Considerations        | Pending        | To inspect readiness, draining, and applicable administrative operations                                                                                                                                                                                                                                                                                                                            |
| 25     | IANA Considerations                          | Not applicable | The specification declares no IANA actions                                                                                                                                                                                                                                                                                                                                                          |
| 26     | Internationalization Considerations          | Pending        | To inspect identity, stable tags, and presentation boundaries                                                                                                                                                                                                                                                                                                                                       |
| 27.1   | Input and Authorization                      | Pending        | Incident schemas decode transport input; token middleware validates and verifies credentials before mutation/repository acquisition. Server defaults closed without configuration. Historical 058 is verified fixed; the broader boundary inventory remains pending                                                                                                                                 |
| 27.2   | Injection, Paths, and Outbound Requests      | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 27.3   | Capability Scope                             | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 27.4   | Secret and Data Exposure                     | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 27.5   | Denial of Service                            | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 27.6   | Tenant and Request Isolation                 | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |
| 27.7   | Supply Chain and Reference Source            | Pending        | To inspect                                                                                                                                                                                                                                                                                                                                                                                          |

## Capability applicability

Source inventory covers core, CLI, both scaffold templates, generated-server
sources, and application consumers. The incident service implements a volatile
Map-backed repository; its README now specifies Layer lifetime, commit ordering,
state-transition validation, and the absence of retry deduplication. Browser
LocalStorage/SessionStorage are generic scalar capabilities. No production code
imports Workflow, Activity, SqlClient, Sqlite, or a durable outbox; matches for
"transaction" in the renderer refer to DOM publication, not database commits.
The example `ActivityItem` is a display component, not an Effect Activity.

This makes the durable protocol clauses above inapplicable; it does not waive
ordinary process ownership, input decoding, failure, or concurrency requirements.
Those remain separate entries and are not marked verified by this inventory.

## Confirmed findings during this audit

| Finding             | Guarantee                                                                                                                    | Status                                      | Evidence                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CALLBACK-001        | Queued EventTarget callbacks cannot construct or execute a handler after scope closure (10.4, 12.1, 12.4, 23.5)              | Fixed; full tests and check pass            | `platform/event-target.ts`; `platform/__tests__/callback-ownership.test.ts`; red test observed one invocation after close                                                                                                                                                                                                                         |
| CALLBACK-002        | Retained idle callbacks cannot start after owner cancellation (10.4, 12.1, 12.4, 23.5)                                       | Fixed; full tests and check pass            | `platform/idle.ts`; `platform/__tests__/callback-ownership.test.ts`; red test observed handler construction after close                                                                                                                                                                                                                           |
| ROOT-001            | Root shutdown preserves release defects and mixed interruption while attempting all releases (10.3, 10.4, 12.4)              | Fixed; full tests and check pass            | `primitives/renderer.ts`; `primitives/__tests__/mount-cleanup-cause.test.tsx`; red test observed successful Exit after a child release defect                                                                                                                                                                                                     |
| INCIDENT-001        | Reusable reads observe execution-time state and concurrent mutations preserve committed data (8.1, 11.5, 12.2)               | Fixed; 53 CLI tests and complete check pass | `templates/incident/app/services/incidents.ts`; three red tests reproduced stale reads, lost timeline entries, and competing successful transitions; `incident-concurrency.test.ts` now passes                                                                                                                                                    |
| RENDER-ROLLBACK-001 | Staged rollback finalizers receive the failed render Exit and retain both Causes when rollback also fails (10.3, 10.4, 12.4) | Fixed; full tests and check pass            | `render-transaction.ts`; two red tests reproduced successful finalizer Exits and loss of the original render failure. Public ErrorBoundary tests additionally verify typed fallback and pure/mixed terminal failure classification                                                                                                                |
| SCAFFOLD-001        | Cancellation waits for native staging mutations before rollback (10.4, 12.4, 16.3)                                           | Fixed; full tests and check pass            | `cli/src/scaffold.ts`; three red tests observed cleanup before directory/copy/write callback settlement. Each mutation is now individually uninterruptible; reads and boundaries remain cancellable. All three tests prove awaited settlement and successful retry; eleven stage-failure cases additionally preserve errors and clean owned paths |

Two further consistency failures were reproduced during static preparation:
`keyed-static-preparation.test.tsx` exposed an attribute remaining changed when a
later host write failed, and `render-keyed-list-rfc-regressions.test.ts` exposed
retirement detaching the replacement through an already-updated ItemState.
Static reconciliation now records attempted props before native writes, and
retirement uses captured old markers. The real structural replacement test also
preserves the keyed Signal and verifies that only the new DOM receives updates.
These cases are included in the current full green suite.

The root mount also swallowed a defective release after logging it. The new
`mount-cleanup-cause.test.tsx` first reproduced a successful shutdown Exit after
that defect. The root now promotes typed release failures at the finalizer boundary
and preserves all defects and interrupts while attempting every release. Both defect-only and mixed-interruption cases pass in the complete suite. Both browser composition roots now typecheck without
`unsafeEraseR`, so their complete Layer graph is verified directly.

The earlier focused platform run passed 55 tests across EventTarget, Idle, Observer,
and callback admission tests. Subsequent context, registration-interruption, and
closed-handle tests pass in the complete suite. The change uses the installed `Effect.forkIn`
contract to register the child before its first user instruction.

## Additional callback audit

- **CALLBACK-003:** `runSyncWith` replaces the launcher's Scheduler in Effect
  rc.112. EventTarget, Idle, and Observer now install captured services inside
  the already-owned child, preserving the caller's Scheduler. Three red cases
  reproduced the replacement; native/controlled adapter conformance also covers
  both observer kinds and idle delivery.
- **SHORTCUT-001:** the installed `FiberSet.runtime` starts before adding its
  fiber. A native shortcut event could close its owner during `preventDefault`
  and still construct user work. The template now admits through a child Scope
  registered before the listener, rejects admission once its parent closes, and
  removes listeners before waiting for active callback finalizers. The reentrant
  shutdown regression and existing blocked-finalizer tests pass together.
- **OBSERVER-001:** retained intersection handles could call native `observe`
  after disconnect, reacquiring an unowned observer. Native and controlled handles
  now reject operations with ObserverError once owner shutdown starts. Tests cover
  both completed closure and shutdown blocked in another finalizer. Admission and
  native operation share one synchronous boundary.

- **VITE-001:** reentrant watcher shutdown completed before the callback's
  blocked release. The new private `vite/callback-runtime.ts` captures each
  owner's services and child Scope, attaches before execution, and rejects
  callbacks as soon as parent shutdown starts. All seven Vite/Node/Bun callback
  launch sites use it. Tests prove the reproduced release race, admission during
  a blocked earlier finalizer, and Scheduler preservation. Existing watcher and
  HTML fallback tests retain terminal Cause and interruption coverage.
- **DEVAPI-001:** Node and Bun accepted initial creation/reload through closed
  owners and published candidates resumed after shutdown. Ten red tests cover
  closed initial owners, retained reload handles, and suspension during import,
  composition, or handler acquisition. Both adapters now check structural
  liveness before acquisition phases and inside the atomic candidate swap.
- **DEVAPI-002:** when handler acquisition and candidate cleanup both failed,
  Scope.close replaced the original typed failure with the cleanup defect.
  Two red tests reproduced the loss in Node and Bun. Candidate cleanup now runs
  as an ensuring finalizer on the original failed Effect, preserving both reasons.
- **DEVAPI-003:** the generated Web handler launched an HTTP fiber outside the
  API generation's Scope. Abort settled the bridge before the request's blocked
  finalizer finished, allowing Layer services to release first. Two real HTTP
  tests using the SSR-generated factory reproduced this in Node and Bun. The
  factory middleware now attaches the actual HTTP fiber before user code and
  awaits its Scope before releasing services. Both handler and streaming cases
  verify replacement availability and exact request-before-service cleanup.
  Four additional real Vite tests verify blocked terminal cleanup, concurrent
  hook identity, and runtime availability until finalization completes.
- **DEVAPI-004:** ownership ended when the HTTP fiber completed even though its
  streaming response still owned request cleanup. A generated response disposed
  before reader acquisition reproduced service release without request release.
  The factory now attaches the stream fiber before its first user instruction,
  after user pre-response transformations. A second red case exposed HEAD
  transferring cleanup to a discarded stream; HEAD now retains body metadata
  without that transfer. Direct, replaced, and HEAD responses preserve status
  and headers and release requests before services. Four native TCP disconnect
  cases also verify handler/stream cleanup in both development adapters.
- **CONFIG-001:** invalid JavaScript configuration escaped as an unowned Schema
  error. Two red tests reproduced the missing TryggConfigError discriminator.
  The synchronous Vite/config boundary now retains the original decode cause in
  that project-owned error and preserves all supported literal combinations.
  Production startup tests now execute both Node and Bun artifacts across six
  invalid env cases, three accepted port values with a missing shell, and an
  occupied port; every failed startup terminates without announcing readiness.
- **HTTP-TELEMETRY-001:** Effect's automatic HTTP tracer exported full query-bearing
  URLs and request/response headers despite the framework request event using
  pathname only. A capturing tracer reproduced the leak at `attribute` invocation.
  The generated dev and production HTTP contexts now project server-span attributes
  before delegation and remove response/error values from terminal Exits, including
  unsampled spans. Distributed ancestry, method/path/status, transport values, and
  original handler Exits remain intact. Ten dev cases cover success, Fail, Die,
  Interrupt, and mixed Cause under both sampling states; real Node/Bun production
  probes cover configured tracers and response logging. Effect's own HTTP response
  conversion strips interrupt reasons from mixed Causes before tracing; this patch
  retains that upstream behavior, while the handler's original mixed Cause is checked.
  Removing the extra HttpRouter logger also reduces two production response logs to one.
- **HTTP-TELEMETRY-002:** the installed `HttpMiddleware.logger` emitted a raw Cause
  on request failure. A capturing logger reproduced both failure and defect sentinel
  strings in that automatic record. Generated HTTP middleware now projects this
  logger's Cause before delegation while application execution retains its original
  logger identities. The upstream logger still owns timing, response status, and
  per-request disable controls. Middleware graphs are reused per logger configuration
  through weak keys. Tests cover disabled/enabled response logs, a subtree logger
  override, the ten outcome/sampling cases, and default failure logs in real Node/Bun
  production processes. Application Exits and intentionally emitted application
  records are not rewritten. Other observability owners still require RFC 17.4 review.
- **NAVIGATION-001:** cancellation after history mutation but during the following
  snapshot read left NavigationCore.current on the old entry. A Deferred-controlled
  regression reproduced `/applied` in history with `/` in the coordinator. A private
  semaphore now serializes transitions over a Ref, restoring interruptibility for
  adapter mutation and protecting the subsequent read/commit. Queued cancellation
  still completes while another mutation holds the permit. This verifies the core
  phase and the public boundary: an additional browser Router regression reproduced
  the same divergence in Router.current. The core now hands publication to the
  Router scope before observing post-commit cancellation. Callers await that fiber
  without owning it; cancellation preserves the caller's interrupted Exit while
  the latest eligible route/query/version still reaches subscribers. Five public
  tests cover the browser read boundary, reentrant navigation, cancellation versus
  Layer cleanup, and mixed defect/interruption Causes. Publication has a terminal
  observer emitting only a projected diagnostic; original reasons reach callers.
  Pre-mutation admission and post-mutation publication remain separate phases.
- **NAVIGATION-002:** Outlet previously retained every activation label in a Set.
  It now uses an internal constructor whose identity admission retains only the
  highest accepted Router navigation version. Skipped older versions interrupt,
  duplicates fail, and malformed version/label pairs fail as RouteActivationError
  before changing the owner. A red regression reproduced a previously unseen old
  version replacing the current one; it now remains interrupted. The public
  RouteActivation.make API retains exact lifetime-wide rejection for arbitrary
  application string IDs and its original failure type. Such arbitrary ID history
  remains proportional to the coordinator's operation group; the built-in Outlet
  no longer uses that history. A four-process A–B–B–A comparison at 101,000 claims
  observes about 17.8 MB retained heap with string history versus a 7.7 MB plateau
  for navigation versions, with stable string counts in the latter. This isolates
  the coordinator, not a whole browser application; details are in the research log.
- **SUSPEND-001:** a dependency notification during blocked owner cleanup still
  called Pending, and invoking a suspended component through a closed owner
  began view construction. Both were reproduced before the fix. Admission now
  checks structural liveness before initial callbacks and around refresh
  dependency reads. Tests verify no callbacks after shutdown begins, awaited
  worker cleanup, removal of an actually installed subscription, and disposed view.
- **RESOURCE-001:** reactive fetch workers and mirroring daemons used
  immediate fork execution before Scope attachment. Tests reproduced clear
  finishing before a worker release and render shutdown finishing with one
  retained entry listener. Both forks now attach first; flushing the parent
  dispatcher preserves fetch-before-listener ordering and immediate cached
  output without the ownership gap. The full resource suite passes all three
  ordering/ownership tests together.
- **RESOURCE-002:** a service retained beyond its Layer could return disposed
  entries, accept leases during blocked shutdown, and commit a candidate after
  its Scope closed. Four red tests reproduced these cases. Owner-state checks
  now reject reads/leases and interrupt admission; the finalizer drops private
  cache/lifetime references and settles pending admissions. Six tests additionally
  verify joined admissions are released independently of a suspended candidate,
  no Clock read occurs for a new admission after closure, and static/reactive
  public fetches do not execute their source through a closed registry.
- **MIDDLEWARE-001:** initial middleware redirects changed the router pathname
  before Outlet installed its subscription, leaving empty DOM. The subscription
  now precedes first activation. Real render tests cover both direct and chained
  redirects after deterministic scheduler settlement, checking visible content
  and router pathname. The same matrix verifies typed denial and full emitted
  Fail/Die/mixed Causes at an actual error Component; interruption reaches the
  render caller without executing either page or fallback.
- **TESTING-001:** renderElement registered container cleanup only after mount
  succeeded. Failed and interrupted mounts retained published test containers.
  Each acquisition now has an owned child Scope, registers container release
  before publication, and closes immediately on unsuccessful mount. Three red
  tests reproduce Fail/Die/Interrupt leaks and now pass with the caller Scope
  still open.
- **CLEANUP-001:** translating a typed release failure to a finalizer defect
  discarded its diagnostic annotations. The shared finalizer boundary now uses
  `Cause.reasonAnnotations` to preserve each translated reason's metadata. A red
  test reproduced the lost request ID; existing defect/interruption reason
  identities and their annotations pass through unchanged.
- **PORTAL-001:** native selector and DOM acquisition exceptions escaped as
  defects; interruption or a partially successful append left an inserted
  dynamic container without immediate cleanup. `Portal.make` now declares
  `PortalDomError`, acquires a detached container under a child Scope before
  insertion, and rolls back failed/interrupted acquisition immediately. Seven
  tests cover malformed selector, creation/attribute failures, closed-owner
  rejection, insertion interruption, partial append, and simultaneous rollback
  failure. Root and portal finalizers share the same explicit Cause promotion
  policy, preserving defects and interrupts at the finalizer boundary.
- **THEME-001:** the media callback had the same start-before-attachment race.
  A test against the production AppTheme Layer and its ThemeBrowser service seam
  reproduced premature shutdown during a blocked browser-read finalizer. The
  callback now owns its fiber before execution; listener removal precedes waiting
  for release, and retained native callbacks cannot read after closure.

No production FiberSet runtime bridges remain in core or CLI templates. This
source inventory does not close every callback finding: renderer and other host
roots still require the remaining historical acceptance checks. The verified
historical watcher, fallback, and theme findings are now recorded individually.

## Resource cache review

Historical findings 023–029 are verified against the current implementation and
production API tests. Registry state belongs to the Layer; entry state has its
own Scope; leases keep consumers and in-flight work alive; close runs outside
atomic cache decisions. The review covers identity, four single-flight entrypoints,
reactive render replacement, Cause policy, LRU/TTL/capacity accounting, and slow
finalizers. This scoped evidence does not complete every caching or ownership
clause for all framework owners.

The optimized registry keeps its private Maps inside synchronous Ref callbacks
instead of cloning them on each operation. A conservative next-expiration bound
avoids scanning the entire cache before any entry can expire. Deadline renewals,
exact expiration boundaries, and backward wall-clock movement are tested. No user
work or cleanup runs inside those atomic mutations. Timed hit operations improve
in the local paired runs recorded in the research log; expiration sweeps and
capacity churn remain separate workloads to measure.

## URL, route parameter, and JSX boundary review

Historical findings 030, 031, 032, 033, and 035 are verified against current
production owners and the passing full suite. The evidence covers canonical URL
inspection and per-sink renderer policy, URI encoding/decoding, Schema outputs
observed in routed Components, active-pattern validation, and hostile JSX
enumeration/getter failures across all compiler entrypoints. The historical
ledger records the specific source and acceptance evidence for each finding.
Finding 034 now also has a direct routed-boundary Cause matrix. Comparisons use
the Cause emitted by middleware, including Effect's runtime-added stack metadata;
comparing against an unexecuted bare Cause incorrectly rejects that enrichment.
The initial redirect regression discovered by that matrix is fixed. These scoped
checks do not close every input or Cause clause across the framework.

The generated Worker review verifies finding 036: both artifact and plugin tests
load the planner's actual WriteFile contents and execute deep-route, API, method,
asset, encoded-path, and shell-fallback cases. Readiness (037) is now verified by
both the coordinator/adapter matrix and six fresh Node/Bun subprocesses running
the real configureServer and generated handler factory. Import, invalid Layer,
and acquisition failures reject setup without the success announcement; the
partial acquisition fixture releases exactly once. Reload (038) is now verified
with real-HTTP failure/recovery coverage and four generated-handler cases that
block request/stream cleanup while the replacement serves. Plugin shutdown (039)
is verified with four real Vite cases covering blocked API finalization and the
runtime becoming unavailable only after that finalization completes.

## Current performance evidence

The new `scripts/benchmark-browser.ts` drives a production bundle in Chromium
141.0.7390.122 via Playwright 1.62.1. The fixture uses keyed rows with scoped
selection and derived class signals. The initial measurements were exploratory. The later controlled comparison adds
complete DOM-identity checks; retained-memory measurements now cover repeated row creation/clear and synthetic pagehide.

The first run measured handler medians of 45.6 ms for create-1k, 58.1 ms for
replace-1k, 6.0 ms for updating every tenth row, 0.4 ms for selection, 1.3 ms for
swap, 46.7 ms for removal, 47.3 ms for appending 1k, 13.5 ms for clear, and
421.0 ms for create-10k. Raw samples: `browser-initial.json` beside this document.
These costs refer to this workload and local machine, not official comparative
js-framework-benchmark results. See [research and experiments](./performance-research.md)
for the span-construction optimization and its exploratory rerun.

The stabilized fixture now typechecks and verifies labels, selection, keyed reorder,
and surviving DOM identity in addition to row counts. All cases passed in Chromium;
raw samples are in `browser-verified.json`. The controlled A–B–B–A comparison now uses the same stabilized fixture and
passes every DOM assertion in all four browser processes. Create-10k handler
medians are 464–467 ms with per-call span construction and 311–322 ms with
reusable combinators. Full tables, caveats, and raw results are linked from the
[research log](./performance-research.md). Two fresh browser runs now cover forced-GC retained heap after ten create-10k/clear
cycles plus persisted/non-persisted pagehide. Both return to 37 DOM nodes after
every clear, with approximately 31 KB of final heap growth over baseline.
The independent-mount probe now adds repeated Renderer/Scope acquisitions with
100 derived signals and a dynamic portal per mount. Two fresh 1,000-mount runs
verify exact component release, inactive detached-button callbacks, no published
DOM after closure, and a return to 37 nodes/37 listeners in every frame-settled
GC sample. Heap reaches a plateau near 9.7 MB rather than growing throughout the
run. Details and raw samples are in the research log. Repeated full browser
bootstrap graphs and real tab-destruction finalization remain pending.
Two fresh-process startup probes recorded first contentful paint at 80 and 88 ms;
the entire fixture bundle totals 557,390 JS bytes (169,896 bytes gzip). These local
observations are a starting baseline, not a standalone framework-size claim.

After the generated HTTP owner correction, the runtime smoke benchmark still
executes all route and release cases; raw output is in
`runtime-after-generated-owner.txt`. It ran alongside regression tests and does
not exercise HTTP, so it supports no latency comparison or HTTP speed claim.

The generated development API now has a separate benchmark, available through
`bun run benchmark:dev-api`. Two fresh processes verify 21,600 exact request
releases each across text, streaming, and HEAD. The baseline includes Web
conversion and body consumption, excludes network and console I/O, and makes no
before/after speed claim. Raw samples and source hashes are linked in the
[performance research log](./performance-research.md#generated-development-api-baseline).

After SUSPEND-001, all nine ordinary browser operations pass again in Chromium
141.0.7390.122, including node identity/order assertions. The create-10k handler
median is 302.7 ms and first contentful paint is 76 ms. Raw samples are in
`browser-after-suspend-audit.json`, with source hashes and workload limits in
`browser-after-suspend-environment.json`. This fixture does not invoke suspend
and the memory probe was disabled; these are general DOM regression observations,
not evidence of faster suspend or a new memory guarantee.

## Keyed-list performance investigation

A separate native-method probe now counts DOM construction after the browser
benchmark timing samples. The full nine-case run preserves existing workload
assertions. At baseline, removal retained 999 rows but constructed 998 provisional
row subtrees; 100 label changes constructed 100 candidates and a two-row swap
constructed two. The observed removal median was 36.40 ms. Source inspection
identified full staging before successful static reconciliation as the target.

Raw counters, source/environment hashes, and an exploratory CPU profile are
linked from [the performance research](./performance-research.md#keyed-list-dom-construction-audit).
The subsequent static preparation implementation passes full lifecycle/Cause
regressions and controlled A–B–B–A measurements. Compatible update/swap/remove
now construct zero provisional DOM nodes. Removal improves by 31.3% and updating
100 labels by 22.4% using the mean of the two run medians per variant; these local
results are not release thresholds. See the accepted comparison in the research
log. Retained scopes remain audit work.

Repeated native failure tests exposed stale attributes after a failed rollback
and a nested Signal subscription retained after row removal. Static reconciliation
now retains the union of possibly applied property keys until a complete patch
succeeds, and marks aborted subtrees for subscription cleanup. Both tests failed
before the fix and pass afterward; retry preserves node identity and removes
attributes introduced by the failed attempt. This does not guarantee a consistent
DOM while the host continues rejecting writes.

Static construction acquisition now has fourteen real DOM regressions covering
failed properties, child/root insertion, failed root rollback, the final keyed
marker, and normal unmount failure. Reentrant interruption is tested during both
successful and failed native writes, through direct and keyed rendering. The
initial four tests and subsequent interruption, handoff, and normal release tests
reproduced leaks before their fixes. A retained partial tree now owns acquisitions
before native writes. Failures enter Effect rollback; bounded acquisition masks
and handoff cleanup preserve subscriptions and mixed Causes without masking user
component rendering. Other effectful intrinsic acquisition and teardown boundaries
still require review. A controlled A–B–B–A comparison preserves zero provisional
DOM construction but measures a local cost: creating 10k rows rises 6.1% and removal
7.9% using mean run medians. Acquisition Effect/GC profiling and cost reduction are
now the next performance work; see [the measured comparison](./performance-research.md#static-acquisition-interruption-and-release-audit).


The follow-up acquisition-generator experiments were rejected after broader
measurements or interruption tests regressed. Static preparation now validates
props and structure in one traversal, while mutation still revalidates eligibility.
A new regression and a negative mutation verify that scoped property Effects run
during preparation and release when a later row fails. Longer A–B–B–A measurements
use 10 warmups and 21 samples: creating 10k records a 3.4% lower mean run median,
but update/removal change little and this does not establish a direct causal gain
in creation. The earlier acquisition cost remains open. See the
[experiments and limits](./performance-research.md#acquisition-cost-experiments-and-static-preparation-validation).


Static event contexts are now created only for nodes with handlers, with one
snapshot shared by all handlers on that node. All existing context, acquisition,
interruption, and finalization tests pass. A longer controlled A–B–B–A comparison
observes 11.1% lower mean run median for creating 10k rows and 10.4% for 1k rows;
removal and clear remain near the control. This does not quantify heap savings
or prove global performance completion. See the
[event snapshot experiment](./performance-research.md#event-snapshots-created-only-when-needed).

## Incident authentication review

The default incident server now denies mutation without `INCIDENT_ACCESS_TOKEN`.
`MutationAuthorization` bounds and validates the bearer header, then asks the
trusted policy to verify the credential before providing an authenticated
`operator` principal and admitting repository acquisition. Scheme casing,
legal spacing, missing/malformed/incorrect credentials, policy denial, invalid
configuration, and the real web-handler 401 challenge have direct tests.

The application root provides `MutationAccess.clientLayer` to the generated API
client. Its credential is private to the application Layer, while only presence
is reactive. The real form clears its password input; forgetting or closing the
owner removes the credential, and retained services reject late credential writes.
A client/server integration test verifies missing, loaded, and forgotten states.
Both generated templates compile and build; packed CLI README checks pass.

This is one shared operator credential, with rotation through configuration and
server restart. It does not provide individual accounts, token expiry, or an OIDC
issuer. Those capabilities are not claimed. The README documents HTTPS and the
credential lifecycle. The verifier's fresh-process performance baseline and its
limits are recorded in [performance research](./performance-research.md#incident-authentication-verification-baseline).

## Effectful property acquisition rollback

`render-intrinsic.ts` now retains partial property bindings until `applyProps`
returns its complete cleanup list. A failed or interrupted later property runs
all recorded releases through `cleanupAll`; a release defect is retained with the
original failure or interruption. Event removal is registered before calling the
native `addEventListener`, covering native registration that mutates before it
throws.

Five behavioral regressions in `effectful-acquisition.test.tsx` cover a typed
property failure and a suspended property interrupted by its caller, each with
successful or defective event removal, plus native registration that installs a
listener and then fails. Retained nodes must stop reacting to their signal,
event removal must run, and the failed acquisition must preserve the relevant
Cause reasons. All four property-stop cases failed against the prior source;
moving event cleanup back after native registration separately makes the fifth
case fail.

This closes partial cleanup inside property evaluation. Interruption inside
`Signal.subscribe` before its unsubscribe is returned still requires a dedicated
ownership test. Reconciliation ownership remains a separate audit from initial
acquisition.

## Intrinsic child and native insertion acquisition

The effectful intrinsic renderer now owns a rollback action before property,
root, marker, or child acquisition begins. It accumulates completed child results
and property releases until the final result is handed off. A failed acquisition
runs every release through `cleanupAll`, retaining release Causes alongside the
original failure instead of logging and discarding them.

Keyed child slots separately own their partial start marker, rendered child, and
end marker before native insertion. Their rollback handles failure after a native
write has already changed the DOM. Bounded native writes and acquisition
bookkeeping are masked; property and child Effects are restored to the caller's
interruptibility. A failed native write checks for deferred cancellation before
propagating its Cause, and the outer `onExit` releases successful acquisitions
when interruption prevents their handoff.

`intrinsic-child-acquisition.test.tsx` adds eighteen cases: root, children-anchor,
end-marker and fragment insertion failures; later keyed/unkeyed child failures;
successful and defective root removal; native insertion requesting interruption
with/without a native defect; and cancellation while a later keyed/unkeyed child
is suspended. Fourteen fail against the previous source. Assertions check
retained nodes stop reacting, partial DOM detaches, original/release Causes are
preserved, and caller cancellation completes. The previous static acquisition
and effectful property regressions remain in the focused verification set.

Remaining acquisition work includes document/head owner boundaries and hostile
instrumentation in subscription handoff. Keyed reconciliation must separately
account for newly acquired slots before a later reconciliation fails; this
initial-acquisition change does not claim that audit is complete.

## Browser logging scope and measurement validity

A CPU profile of Effect-property row removal attributed about 580 ms of self time
to Effect's default logger. A direct guard then reproduced 11,976 console messages
in one removal. The benchmark had provided `MinimumLogLevel=None` only around the
Effect producing `App({})`; that configuration did not own the component subtree.
It now belongs to the component provider Layer. The harness rejects console
emission during each measured/warmup operation and records the zero counts.

Four fresh Chromium runs (static, Effect-property, Effect-property, static) pass
all nine operations and guards. Core source and compiled JS are unchanged and
hash-verified against the existing complete green gates. These are corrected
measurement baselines, not a framework optimization. The initial suspicion that
`RenderTransaction.cleanup` erased caller context was disproved: installed
Effect rc.112 merges supplied contexts, and direct service/logger probes passed.
No production context change or speculative regression tests were retained.

The profile revealed repeated semantic step events during nested reconciliation.
The intrinsic-child case is addressed below. Silencing the benchmark does not
complete the wider operation-event audit required by RFC 17.1 and 17.3.

## Bounded list publication telemetry

Intrinsic child reconciliation now declares its child boundary to
`RenderTransaction.reconcile`. Successful/declined child reconciliation contributes
one `render.child.reconcile` cost fact rather than independent semantic swap
steps. Typed failures keep their recoverable outcome, defects/interruption keep
failed Exits, and failure records remain present. Top-level operation traces keep
their existing ordering.

The list owner emits the existing `keyedList.reorder` event at semantic level,
with committed inserted/removed/reconciled/replaced counts alongside total items,
moves, and stable nodes. Additional fields are optional for decoding old records;
the current owner always supplies them. This records publication, not successful
completion of later cleanup.

Twelve new tests cover exactly one Info-level record across list sizes and keyed
or unkeyed children, insertion/replacement counts and DOM identity, child versus
operation trace ordering, true/false reconciliation outcomes, and typed failure,
defect and interruption Causes. Four initial integration cases reproduce the old
step-event volume. A real Chromium probe with 1,000 Effect-property rows verifies
exactly one Info console message during removal, versus the previously measured
11,976 messages. The zero-console performance fixture remains unchanged.

The corrected silent A–B–B–A comparison measures removal at 74.05 → 70.05 ms
(mean of run medians). Full-fixture clear increases 20.10 → 21.50 ms; isolated
clear gives 20.60 → 21.10 ms with a 1 ms spread between control medians. Both results
are retained, and no universal no-regression or optimal-performance claim is made.
See [measurements and limits](./performance-research.md#bounded-reconciliation-operation-events).
Other operation owners still require the RFC wide-event audit.

## Prepared Effect-property values

A real keyed-row regression test found that updating a compatible intrinsic
executed each property Effect twice: once while building detached preparation DOM
and again while reconciling retained DOM. Rollback also reran the previous Effects.
With a shared Effect object, shallow-equal original properties instead skipped the
newly acquired values and left stale attributes on the retained node.

Intrinsic results now retain per-property acquired values and expose a snapshot
of those values and child preparations. Keyed reconciliation captures the old
snapshot before attempting live writes, passes the candidate snapshot during
commit, and restores the captured values during rollback. Fragments and context
providers forward preparations; new keyed child slots also consume already
acquired property values. Completed value Maps are shared read-only during binding rather than copied
again. Snapshots do not replace the owning Scope or memoize Effect objects. Missing entries are distinguished from acquired `undefined`, and
an Effect returned as a value is not executed again.

Ten behavioral tests fail against the preceding implementation and pass after
this change. They cover nested property counts and finalizers, failed native
patch rollback/retry, shared Effect objects, returned Signals and unsubscription,
keyed child reorder/insertion, undefined and nested Effect values, fragment and
provider boundaries, and interruption of the actual update owner followed by retry.
See `packages/core/src/primitives/__tests__/prepared-property-effects.test.tsx`.

The final silent A–C–C–A comparison keeps update means at 7.90 ms in both
variants but measures removal at 69.75 → 73.40 ms (5.2% higher). That checkpoint left a local performance regression; the subsequent intrinsic
preparation measurements below address its provisional construction cost.
The retained readonly Map removes a redundant copy, but preparation/snapshot
bookkeeping and provisional DOM still need optimization. See the
[full measurements and limits](./performance-research.md#reusing-prepared-effect-property-values).

This does not remove provisional DOM construction. Component render execution,
reactive subtree preparation, and partial keyed-child publication still need
separate ownership and rollback audits; these ten tests do not prove those paths.

## Intrinsic preparation without provisional row DOM

The next renderer change plans compatible intrinsic property acquisition before
constructing replacement nodes. A synchronous plan either declines without
executing Effects or returns an Effect that acquires parent properties before
child properties under the existing staging Scope. Compatible rows lend their
committed DOM; reconciliation receives the newly acquired values separately from
the borrowed result's old rollback snapshot. Stable keyed child slots are included.
Structural divergence keeps the replacement path.

A preparation that encounters a host-converted value carries its partial acquired
values into DOM rendering before later Effects execute. Partial child preparation
propagates this requirement to its parent. Static compatibility checks avoid
reading child accessors or opaque host values ahead of parent Effects. Returned
Signals are peeked without enrolling the row's render phase. This optimization
is conditional; it does not declare arbitrary getters, conversions, components,
or changing keyed-child structures safe to skip.

Twelve new behavioral tests cover update/removal with keyed and unkeyed children,
zero provisional element/text/comment construction, typed failure and interruption,
structural replacement, getter ordering, and plain/Effect-returned host conversion
at root and nested positions. Six fail against the preceding implementation's
construction counts; six protect fallback behavior. An intermediate candidate
also failed getter/conversion ordering tests before the fallback was corrected.
See `packages/core/src/primitives/__tests__/effectful-dom-preparation.test.tsx`.

The fresh silent A–B–B–A comparisons show Effect-property update at 8.00 → 5.65 ms
and removal at 72.80 → 42.80 ms. Update/removal/swap now construct zero row
subtree elements, text nodes, or comments in that fixture. The static fixture's
update stays at 3.60 ms and removal is 24.20 → 24.40 ms. All 72 operation/run pairs
pass DOM checks without measured/warmup console messages. Other small timing
differences remain within the observed run variation; this is not a universal
no-regression or optimum-performance proof. See
[measurements and limits](./performance-research.md#intrinsic-preparation-without-provisional-dom).

## Granular keyed-row preparation and source publication

A `Signal.get` inside a row used a separate reconcile-then-build path. Structural
fallback acquired Effect properties twice; failed native patches could retain
partial attributes, and interruption could leave the staging Scope and rerender
flag live. Granular rows now share `renderItem` preparation with source-list
updates, retain the old property snapshot until publication, and own rollback and
staged release through `onExit`. A constructed candidate remains owned even when
the old DOM accepts reconciliation. Cleanup failures remain in the owner Cause.

Source updates now stop active renders of changed or removed rows and await their
finalizers before publication. Non-interruption failure in that release prevents
successful source publication. Row dependency changes arriving while the source
update owns the list are coalesced and resumed against committed inputs. This
prevents a suspended old row from overwriting a newer source update.

Ten added behavioral tests cover structural replacement acquisition counts,
native patch rollback with successful/failing release, typed failure/interruption
and retry, stale row/source publication, coalescing, and delayed finalization for
source change/removal/failure. The first five reproduced failures before the
preparation fix; two additional concurrency cases reproduced failures before
serialization. All 36 tests across the four related suites pass, followed by the
complete 1,885-test suite. See
`packages/core/src/primitives/__tests__/keyed-row-preparation.test.tsx`.

The new granular fixture updates 100 individual row Signals in a 1,000-row list
and awaits each actual row worker through a Deferred/Fiber barrier. It validates
row identity and labels and includes the same barrier overhead in both variants.
The first A–B–B–A comparison reports an observed slowdown: handler medians
23.10/26.60/24.50/19.00 ms, or control/candidate means of medians
21.05/25.55 ms (+21.4%). Both variants construct zero elements, text nodes, or
comments in this workload. This checkpoint is functionally validated but leaves
a performance regression to investigate; it is not a completed no-regression
refactor. Broad source-list measurements are recorded separately in
[performance research](./performance-research.md#granular-keyed-row-preparation).

## Single preparation Scope for granular rows

The granular worker now composes the shared `prepareItem` Effect and live
reconciliation under one staging Scope. The source-update caller keeps its own
acquisition owner; the granular worker's `onExit` owns rollback and release.
This removes a duplicate Scope installation and successful-path finalization
wrapper without removing resource ownership, failure Causes, or interruption.
A forwarding scheduler probe measures 35,721 → 34,721 consultations per 100 row
updates, with one accepted yield in all variants. This is a work count, not a
latency or heap guarantee. Short CPU profiles and exploratory timings showed
substantial variation, so they cannot establish that the previously measured
21.4% regression has been eliminated.

Two more concurrency tests verify queued dependency updates after typed failure
and interruption of source preparation. The row resumes with the last committed
source input and latest dependency while the source worker preserves its failure.
The relevant suites now pass 38 tests and the full suite passes 1,887. See
[diagnostics and final timing](./performance-research.md#composing-the-granular-preparation-scope). The final uninstrumented comparison still measures a
9.8% granular handler regression against the original path; the refactor remains
incomplete on performance.

## Stable keyed-row dependency collections

The dependency update now reuses the subscription Map when size and ordered
Signal IDs are unchanged. The check executes inside the Effect so it observes
the live dependency state. Empty graphs avoid allocating both temporary
collections. Changes in membership or order retain the original diff, preserving
which Signals drive the row and the release order from its latest render.

Two tests exercise unchanged, replaced, empty, restored, reversed, and removed
row dependencies. They pass on both the preceding implementation and the
optimized candidate; this is behavior preservation, not a newly fixed defect.
The complete suite now passes 1,889 tests. Separate constructor probes and timing
comparisons are recorded in
[performance research](./performance-research.md#reusing-stable-keyed-row-dependency-collections).

The separate probes remove 100 Map and 100 Set constructions for 100 updated
rows, and 998 of each for removal's 998 index-changed survivors. Initial creation
is unchanged. The timing comparison still leaves D 15.9% above original A in
granular handler medians, with substantial control variation; the optimization
has work-count evidence but does not close the performance requirement.

## Keyed-row service capture and queued source context

Each keyed list now captures its provided services once per execution, excluding
Scope and log annotations. Row staging continues to own acquisitions; provider
precedence and service identity remain stable across rerenders. Source-triggered
annotations reach row Effects and prepared properties even when a nested provider
captured older annotations. Two regression tests fail on checkpoint D and pass
with service capture and source annotation propagation.

Three more tests reproduce a queued-source bug after predecessor success, typed
failure, and interruption: the latest inputs were retained but their caller
Context was discarded. The queue now retains the latest context, clears it before
resuming, and drops it on list closure. All 35 tests in the focused context,
preparation, dependency, row-scope, and keyed regression suites pass. This does
not establish granular callback or nested component annotation propagation.

The completed browser experiment measures service capture E **before** the
queued-source correction. It removes two Maps per rendered row in the fixture
with a provided Context: 200 fewer Maps for 100 updates and 1,996 fewer for
removal's 998 index-changed survivors. Granular means of process medians are
A 23.95, D 29.90, E 24.85 ms; E remains 3.8% above the original A with a gap below
A's between-process spread. This is not proof that the performance regression is
resolved. [Results and limitations](./performance-research.md#reusing-keyed-row-service-context),
[measured source hashes](./keyed-context-environment.json), and the
[subsequent correctness diff](./keyed-context-queue.diff) distinguish the snapshots.
That experiment did not measure the final queue correction; the continuation below does.

## Validation at the previous pause

Paused at the user's request on 2026-09-05 after completing the queued-source
context correction. The implementation-wide goal remains incomplete.

- Full tests: **1,894 passed** (1,703 core, 87 CLI, 104 website), up from the
  first documented session baseline of 1,611.
- `bun run check`: passed, including lint, formatting, workspace and benchmark
  typechecks, core build, and published type tests. Effect diagnostics checked
  200 core and 30 CLI files without errors, warnings, or messages. Existing lint
  warnings and release-script informational Schema suggestions remain.
- The latest completed browser experiment is checkpoint E before the queue
  correction: 42 timing operation/run pairs and eight separate work probes pass
  with zero operation console messages. Granular means of process medians are
  original A 23.95 ms, preceding D 29.90 ms, candidate E 24.85 ms. The +3.8% gap
  to A is below the control spread; no regression-free performance claim follows.
  The final queue correction is not yet benchmarked.
- Documentation contract: 340 reachable exports pass.
- Examples and website production builds pass after the current core build.
  The website's existing large-chunk warning remains.
- `git diff --check`: passed.
- [Historical finding ledger](./historical-findings-audit.md): 73 verified fixed.
  The separate clause ledger records 85 pending entries, two verified, and eight
  not applicable. Historical finding closure does not certify those clauses.
- The first attempt to authorize tests needing local sockets timed out. The
  sandboxed fallback encountered `listen EPERM` and was stopped; the permitted
  authorization retry succeeded, and the complete suite above exited zero.
- [Session summary and pause point](./session-summary.md),
  [final correction validation hashes](./keyed-context-queue-validation.json).

## Granular notification context and finalization

The continuation on 2026-09-05 found two granular callback failures: immediate
workers used mount annotations instead of the notifying caller's annotations,
and failed/interrupted preparation discarded a later dependency update. Four
initial red tests reproduced these behaviors. `render-keyed-list.ts` now keeps
one latest pending caller Context per row, rather than only a boolean, and drains
it after preparation/retirement cleanup on success or failure. Removal and
shutdown clear pending references and reject reentrant cleanup notifications.

Eleven added tests in `keyed-row-context.test.tsx` cover captured service identity
in both row bodies and property Effects; current source/granular annotations;
pending granular work behind either kind of predecessor with success, typed
failure or interruption; removal/shutdown; and 1,000 notifications during a
blocked defective release. The burst runs only the latest pending render and
preserves both the original typed failure and cleanup defect. Existing Scope
identity, mutable service state, preparation and rollback tests remain green.

A stronger service assertion rejected an intermediate propagation draft: the
row body and property could observe different services when the caller shadowed
a captured service. The final worker composes the captured row services over the
caller Context once, without reapplying the captured annotations or Scope. Both
source and granular workers use this composition. It removes 100 additional Map
constructions from that draft in the 100-row update probe and matches historical
E's 1,303 Maps / 600 Sets without creating provisional row elements/text/comments.

This is module-scoped evidence for RFC 10.3, 10.4, 12.1, 12.3, 12.5, 17.5 and
21.5, **not** closure of those clauses across the framework. Nested component
context and partial reactive/keyed-child reconciliation remain separate work.

The final A–E–H–H–E–A inline Chromium experiment measures means of process medians
at 23.65 / 27.75 / 26.55 ms. H remains 12.3% above original A; the granular
performance requirement is still open. All six timing runs, three separate
allocation probes and nine source smoke operations pass. Ten create/clear cycles
and 100 independent mounts return DOM/listener counts, but the independent-mount
heap rises by about 0.18 MB, so that run does not establish a retention plateau.
See [raw evidence and limitations](./performance-research.md#granular-caller-context-coalescing-and-composed-services).

## Current validation

- Full tests: **1,905 passed** (1,714 core, 87 CLI, 104 website), 11 more than
  the previous pause. The full suite was rerun after the final test-fixture cleanup.
- Core build, full workspace/type-fixture checks, benchmark types, Effect
  diagnostics, documentation contract (340 exports), examples and site builds pass.
- The aggregate `bun run check` is **not green**: formatting includes seven files
  in three pre-existing untracked `packages/core/trygg-test-*` scaffold directories.
  Those directories were present at task entry and were neither removed nor
  reformatted. A separate format check excluding exactly those three directories
  passes. Lint retains its two previous warnings; other gates are run separately.
- Renderer benchmark modes are explicit and typechecked. Inline runs start no
  HTTP listener; their synthetic browser origin is not HTTPS/ingress evidence.
- Work remains local, with no commit, push, shared-service change, or claim of
  complete RFC coverage. The clause ledger remains 85 pending, two verified and
  eight not applicable; the historical ledger still contains 73 verified findings.
- [Final validation, red-test evidence hashes and measured-source verification](./keyed-granular-validation.json).

## Next verification work

The compatible Effect-property fixture now avoids provisional row subtrees during
update/removal/swap, but removal still costs 42.80 ms versus 24.40 ms for the static
fixture. Profile remaining property planning, snapshots, row Scope bookkeeping,
and retained-memory behavior without skipping arbitrary user Effects or closing
staged Scopes prematurely. Extend execution-count and ownership evidence to
component and reactive subtree preparation. Granular row preparation now has execution-count, rollback, interruption, and
source-publication coverage. The final inline H comparison leaves a +12.3% handler gap;
it must not be pooled with the earlier HTTP experiment's +3.8% gap. Failed source preparation with queued dependencies now has typed-failure and
interruption coverage; reentrant source updates still need verification. Getters and host-converted values retain fallback paths whose
broader reactive interactions also need review. Other operation owners still
require the RFC wide-event audit.

1. Inspect remaining static-node allocations (including empty subscription/listener arrays) and reduce measured acquisition/handoff overhead while preserving its fourteen regressions and effectful-prop preparation test; inspect removal profiles and expand retained-memory measurements to full browser bootstrap graphs and cache pressure;
   repeat promising results on a dedicated host before defining release thresholds.
2. Review all remaining callback bridges and renderer host roots for admission,
   interruption, finalization, and failures when loggers or schedulers misbehave.
3. Audit historical findings against current owners; fill the clause ledger with
   source and test evidence, not inferred closure.
4. Expand measurements to signal fanout, registry admission/expiry/pressure, route
   lookup, allocation, retained heap, and production bundle/startup.
5. Maintain complete green gates as further findings are fixed; do not treat the
   current successful gates as proof of clauses still marked pending.
