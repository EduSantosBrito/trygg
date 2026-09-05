import { assert, describe } from "@effect/vitest";
import { scoped } from "../../testing/effect-vitest.js";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope } from "effect";
import { createServer, request as httpRequest } from "node:http";
import type { Connect } from "vite";
import {
  ApiInitError,
  DevPlatform,
  type HandlerFactory,
  requestPathname,
  traceApiRequestReceived,
} from "../dev-platform.js";
import * as BunDevPlatform from "../dev-platform-bun.js";
import * as NodeDevPlatform from "../dev-platform-node.js";
import { PluginApi } from "../plugin.js";
import * as Trace from "../../trace/index.js";

const AddressInfoSchema = Schema.Struct({ port: Schema.Number });
const decodeAddressInfo = Schema.decodeUnknownEffect(AddressInfoSchema);

const requestBody = (port: number, path: string = "/api/version"): Effect.Effect<string> =>
  Effect.promise(
    () =>
      new Promise((resolve, reject) => {
        const request = httpRequest({ hostname: "127.0.0.1", path, port }, (response) => {
          const chunks: Array<string> = [];
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => chunks.push(chunk));
          response.on("end", () => resolve(chunks.join("")));
        });
        request.on("error", reject);
        request.end();
      }),
  );

const withHttpServer = (middleware: Connect.NextHandleFunction) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const server = createServer((req, res) =>
        middleware(req, res, () => {
          res.statusCode = 404;
          res.end("not found");
        }),
      );
      yield* Effect.promise(
        () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
      );
      return server;
    }),
    (server) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

const emptyApiLayer: Layer.Layer<unknown> = Layer.succeedContext(
  Context.makeUnsafe<unknown>(new Map()),
);

const webHandler: HandlerFactory["makeWebHandler"] = (_apiLive) =>
  Effect.succeed({
    handler: () => Promise.resolve(new Response(null, { status: 204 })),
    dispose: Effect.void,
  });

const handoffPlatforms = [
  { name: "Node", layer: NodeDevPlatform.layer },
  { name: "Bun", layer: BunDevPlatform.layer },
];

describe("development API lifecycle", () => {
  for (const platform of handoffPlatforms) {
    for (const stage of ["import", "composition", "handler"]) {
      scoped(
        `should fail ${platform.name} readiness and close partial work when ${stage} fails`,
        () =>
          Effect.gen(function* () {
            // Scope: the production PluginApi coordinator delegates to the actual platform adapter.
            // Assertion: Loading becomes Failed, no Ready is published, and partial resources close once.
            const devPlatform = yield* DevPlatform;
            const apiScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
              Scope.close(scope, Exit.void),
            );
            let finalized = 0;
            let reported = 0;
            const seen: Array<PluginApi.InitialState["_tag"]> = [];
            const failPhase = Effect.fail(new ApiInitError({ message: `${stage} failed` }));
            const failHandler = Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  finalized++;
                }),
              );
              return yield* failPhase;
            });
            const factory: HandlerFactory = {
              makeApiLayer: () =>
                stage === "composition" ? failPhase : Effect.succeed(emptyApiLayer),
              makeNodeHandler: () => failHandler,
              makeWebHandler: () => failHandler,
            };
            const state = yield* PluginApi.loadInitial({
              apiPath: "/app/api.ts",
              hasApi: Effect.succeed(true),
              loadHandlerFactory: Effect.succeed(factory),
              ownerScope: apiScope,
              makeApi: (handlerFactory) =>
                devPlatform.makeApi({
                  handlerFactory,
                  loadApiModule: () =>
                    stage === "import" ? failPhase : Effect.succeed({ default: emptyApiLayer }),
                  onError: () =>
                    Effect.sync(() => {
                      reported++;
                    }),
                }),
              observe: (next) =>
                Effect.sync(() => {
                  seen.push(next._tag);
                }),
            });
            assert.deepStrictEqual(seen, ["Loading", "Failed"]);
            assert.strictEqual(state._tag, "Failed");
            assert.strictEqual(finalized, stage === "handler" ? 1 : 0);
            assert.strictEqual(reported, 1);
            yield* Scope.close(apiScope, Exit.void);
            assert.strictEqual(finalized, stage === "handler" ? 1 : 0);
          }).pipe(Effect.provide(platform.layer)),
      );
    }
  }

  scoped("should install a reload candidate before awaiting old disposal", () =>
    Effect.gen(function* () {
      // Test: should install a reload candidate before awaiting old disposal
      // Scope: covers the acquire/swap/finalize ordering for a healthy Node API reload.
      // Assertion: requests see generation two while generation one's finalizer is blocked.
      const devPlatform = yield* DevPlatform;
      const apiScope = yield* Scope.make();
      const oldDisposeStarted = yield* Deferred.make<void>();
      const releaseOldDispose = yield* Deferred.make<void>();
      const events: Array<string> = [];
      let generation = 0;
      const factory: HandlerFactory = {
        makeApiLayer: () => Effect.succeed(emptyApiLayer),
        makeNodeHandler: () =>
          Effect.sync(() => {
            generation += 1;
            const current = generation;
            events.push(`acquire:${current}`);
            return {
              handler: (_req, response) => response.end(String(current)),
              dispose:
                current === 1
                  ? Deferred.succeed(oldDisposeStarted, undefined).pipe(
                      Effect.andThen(Deferred.await(releaseOldDispose)),
                      Effect.tap(() =>
                        Effect.sync(() => {
                          events.push("dispose:1");
                        }),
                      ),
                      Effect.asVoid,
                    )
                  : Effect.sync(() => {
                      events.push("dispose:2");
                    }),
            };
          }),
        makeWebHandler: webHandler,
      };
      const handle = yield* Scope.provide(
        devPlatform.makeApi({
          handlerFactory: factory,
          loadApiModule: () => Effect.succeed({ default: emptyApiLayer }),
          onError: () => Effect.void,
        }),
        apiScope,
      );
      const server = yield* withHttpServer(handle.middleware);
      const address = yield* decodeAddressInfo(server.address());

      const reload = yield* handle.reload.pipe(Effect.forkChild);
      yield* Deferred.await(oldDisposeStarted);
      const bodyDuringDispose = yield* requestBody(address.port);

      assert.deepStrictEqual(events, ["acquire:1", "acquire:2"]);
      assert.strictEqual(bodyDuringDispose, "2");

      yield* Deferred.succeed(releaseOldDispose, undefined).pipe(Effect.asVoid);
      yield* Fiber.join(reload);
      yield* handle.dispose;
      yield* Scope.close(apiScope, Exit.void);

      assert.deepStrictEqual(events, ["acquire:1", "acquire:2", "dispose:1", "dispose:2"]);
    }).pipe(Effect.provide(NodeDevPlatform.layer)),
  );

  for (const platform of handoffPlatforms) {
    for (const stage of ["import", "composition", "handler"]) {
      scoped(
        `should preserve the healthy ${platform.name} handler when reload fails during ${stage}`,
        () =>
          Effect.gen(function* () {
            // Scope: a real HTTP request crosses the production adapter after a candidate fails.
            // Assertion: failure closes only partial candidate work, keeps generation one callable,
            // and a subsequent successful reload publishes generation three before releasing one.
            const devPlatform = yield* DevPlatform;
            const apiScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
              Scope.close(scope, Exit.void),
            );
            let loads = 0;
            let partialReleases = 0;
            const disposals: Array<number> = [];
            const failBeforeHandler = Effect.fail(
              new ApiInitError({ message: `invalid ${stage}` }),
            );
            const failCandidate = Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  partialReleases++;
                }),
              );
              return yield* new ApiInitError({ message: `invalid ${stage}` });
            });
            const acquire = Effect.gen(function* () {
              if (loads === 2 && stage === "handler") return yield* failCandidate;
              return loads;
            });
            const dispose = (generation: number) =>
              Effect.sync(() => {
                disposals.push(generation);
              });
            const factory: HandlerFactory = {
              makeApiLayer: () =>
                loads === 2 && stage === "composition"
                  ? failBeforeHandler
                  : Effect.succeed(emptyApiLayer),
              makeNodeHandler: () =>
                acquire.pipe(
                  Effect.map((generation) => ({
                    handler: (_req, response) => response.end(String(generation)),
                    dispose: dispose(generation),
                  })),
                ),
              makeWebHandler: () =>
                acquire.pipe(
                  Effect.map((generation) => ({
                    handler: () => Promise.resolve(new Response(String(generation))),
                    dispose: dispose(generation),
                  })),
                ),
            };
            const handle = yield* devPlatform
              .makeApi({
                handlerFactory: factory,
                loadApiModule: () =>
                  Effect.gen(function* () {
                    loads++;
                    if (loads === 2 && stage === "import") return yield* failBeforeHandler;
                    return { default: emptyApiLayer };
                  }),
                onError: () => Effect.void,
              })
              .pipe(Scope.provide(apiScope));
            const server = yield* withHttpServer(handle.middleware);
            const address = yield* decodeAddressInfo(server.address());
            const reloadExit = yield* handle.reload.pipe(Effect.exit);
            assert.isTrue(Exit.isFailure(reloadExit));
            if (Exit.isFailure(reloadExit))
              assert.instanceOf(Cause.squash(reloadExit.cause), ApiInitError);
            assert.strictEqual(yield* requestBody(address.port), "1");
            assert.strictEqual(partialReleases, stage === "handler" ? 1 : 0);
            assert.deepStrictEqual(disposals, []);
            yield* handle.reload;
            assert.strictEqual(yield* requestBody(address.port), "3");
            assert.deepStrictEqual(disposals, [1]);
            yield* handle.dispose;
            yield* Scope.close(apiScope, Exit.void);
            assert.deepStrictEqual(disposals, [1, 3]);
            assert.strictEqual(partialReleases, stage === "handler" ? 1 : 0);
          }).pipe(Effect.provide(platform.layer)),
      );
    }
  }

  scoped("should redact query and fragment data from request telemetry URLs", () =>
    Effect.gen(function* () {
      // Test: should redact query and fragment data from request telemetry URLs
      // Scope: covers the shared event path used by both Node and Bun adapters.
      // Assertion: method/pathname remain while sentinel secrets are absent from the record.
      const path = requestPathname("/api/session?token=sentinel-secret#correlation-secret");
      const absolutePath = requestPathname(
        "http://user:authority-secret@example.test/api/session?token=sentinel-secret",
      );
      const authorityPath = requestPathname("user:authority-secret@example.test:443");
      const recorder = Trace.makeRecorder();
      yield* Trace.record(
        traceApiRequestReceived("POST", "/api/session?token=sentinel-secret#correlation-secret"),
        recorder,
      );
      const record = recorder.records()[0];

      assert.strictEqual(path, "/api/session");
      assert.notInclude(path, "sentinel-secret");
      assert.notInclude(path, "correlation-secret");
      assert.strictEqual(absolutePath, "/api/session");
      assert.notInclude(absolutePath, "authority-secret");
      assert.strictEqual(authorityPath, "");
      assert.deepStrictEqual(record?.payload, { method: "POST", pathname: "/api/session" });
    }),
  );

  for (const platform of handoffPlatforms) {
    scoped(`should redact query sentinels from live ${platform.name} request telemetry`, () =>
      Effect.gen(function* () {
        // Test: should redact query sentinels from a live platform request telemetry event
        // Scope: sends an API request through the actual Node/Bun middleware and captured runtime.
        // Assertion: recorder and report outputs retain GET/pathname while omitting both sentinels.
        const firstSentinel = `${platform.name.toLowerCase()}-token-sentinel-secret`;
        const secondSentinel = `${platform.name.toLowerCase()}-code-sentinel-secret`;
        const recorder = Trace.makeRecorder();
        yield* Trace.record(
          Effect.gen(function* () {
            const devPlatform = yield* DevPlatform;
            const apiScope = yield* Scope.make();
            const factory: HandlerFactory = {
              makeApiLayer: () => Effect.succeed(emptyApiLayer),
              makeNodeHandler: () =>
                Effect.succeed({
                  handler: (_request, response) => response.end("ok"),
                  dispose: Effect.void,
                }),
              makeWebHandler: () =>
                Effect.succeed({
                  handler: () => Promise.resolve(new Response("ok")),
                  dispose: Effect.void,
                }),
            };
            const handle = yield* Scope.provide(
              devPlatform.makeApi({
                handlerFactory: factory,
                loadApiModule: () => Effect.succeed({ default: emptyApiLayer }),
                onError: () => Effect.void,
              }),
              apiScope,
            );
            const server = yield* withHttpServer(handle.middleware);
            const address = yield* decodeAddressInfo(server.address());

            const body = yield* requestBody(
              address.port,
              `/api/session?token=${firstSentinel}&code=${secondSentinel}`,
            );
            assert.strictEqual(body, "ok");

            yield* handle.dispose;
            yield* Scope.close(apiScope, Exit.void);
          }),
          recorder,
        );

        const requestRecords = recorder
          .records()
          .filter((record) => record.name === "api.request.received");
        assert.deepStrictEqual(
          requestRecords.map((record) => record.payload),
          [{ method: "GET", pathname: "/api/session" }],
        );
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        const exported = JSON.stringify(Trace.toJSON(recorder.records()));
        const markdown = Trace.toMarkdown(recorder.records());
        assert.notInclude(exported, firstSentinel);
        assert.notInclude(exported, secondSentinel);
        assert.notInclude(markdown, firstSentinel);
        assert.notInclude(markdown, secondSentinel);
      }).pipe(Effect.provide(platform.layer)),
    );
  }

  for (const platform of handoffPlatforms) {
    scoped(`should close an interrupted ${platform.name} candidate before swap`, () =>
      Effect.gen(function* () {
        // Test: should close an interrupted platform candidate before swap
        // Scope: interrupts generation two while its candidate Scope is still acquiring.
        // Assertion: candidate cleanup runs once and live requests continue using generation one.
        const devPlatform = yield* DevPlatform;
        const apiScope = yield* Scope.make();
        const candidateStarted = yield* Deferred.make<void>();
        const candidateClosed = yield* Deferred.make<void>();
        const blockCandidate = yield* Deferred.make<void>();
        let generation = 0;
        let candidateFinalizers = 0;
        const disposals: Array<number> = [];
        const disposeGeneration = (current: number): Effect.Effect<void> =>
          Effect.sync(() => {
            disposals.push(current);
          });
        const factory: HandlerFactory = {
          makeApiLayer: () => Effect.succeed(emptyApiLayer),
          makeNodeHandler: () => {
            const current = generation;
            return Effect.succeed({
              handler: (_req, response) => response.end(String(current)),
              dispose: disposeGeneration(current),
            });
          },
          makeWebHandler: () => {
            const current = generation;
            return Effect.succeed({
              handler: () => Promise.resolve(new Response(String(current))),
              dispose: disposeGeneration(current),
            });
          },
        };
        const handle = yield* Scope.provide(
          devPlatform.makeApi({
            handlerFactory: factory,
            loadApiModule: () => {
              generation += 1;
              const current = generation;
              return Effect.gen(function* () {
                if (current === 2) {
                  yield* Deferred.succeed(candidateStarted, undefined).pipe(Effect.asVoid);
                  yield* Deferred.await(blockCandidate);
                }
                return { default: emptyApiLayer };
              }).pipe(
                Effect.onExit(() =>
                  current === 2
                    ? Effect.sync(() => {
                        candidateFinalizers += 1;
                      }).pipe(
                        Effect.andThen(Deferred.succeed(candidateClosed, undefined)),
                        Effect.asVoid,
                      )
                    : Effect.void,
                ),
              );
            },
            onError: () => Effect.void,
          }),
          apiScope,
        );
        const server = yield* withHttpServer(handle.middleware);
        const address = yield* decodeAddressInfo(server.address());

        const reload = yield* handle.reload.pipe(Effect.forkChild);
        yield* Deferred.await(candidateStarted);
        const interrupting = yield* Fiber.interrupt(reload).pipe(Effect.forkChild);
        yield* Deferred.await(candidateClosed);
        yield* Fiber.join(interrupting);
        const reloadExit = yield* Fiber.await(reload);
        const body = yield* requestBody(address.port);

        assert.isTrue(Exit.isFailure(reloadExit));
        if (Exit.isFailure(reloadExit)) assert.isTrue(Cause.hasInterrupts(reloadExit.cause));
        assert.strictEqual(body, "1");
        assert.strictEqual(candidateFinalizers, 1);
        assert.deepStrictEqual(disposals, []);

        yield* handle.dispose;
        yield* Scope.close(apiScope, Exit.void);
        assert.deepStrictEqual(disposals, [1]);
      }).pipe(Effect.provide(platform.layer)),
    );

    scoped(`should retain the new ${platform.name} owner after post-swap interruption`, () =>
      Effect.gen(function* () {
        // Test: should retain the new platform owner after post-swap interruption
        // Scope: interrupts reload while generation one's finalizer is blocked after atomic swap.
        // Assertion: generation two serves throughout and each generation is finalized exactly once.
        const devPlatform = yield* DevPlatform;
        const apiScope = yield* Scope.make();
        const oldDisposeStarted = yield* Deferred.make<void>();
        const releaseOldDispose = yield* Deferred.make<void>();
        let generation = 0;
        const disposals: Array<number> = [];
        const beginGeneration = Effect.fnUntraced(function* () {
          generation += 1;
          return generation;
        });
        const disposeGeneration = (current: number): Effect.Effect<void> =>
          current === 1
            ? Deferred.succeed(oldDisposeStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseOldDispose)),
                Effect.andThen(
                  Effect.sync(() => {
                    disposals.push(current);
                  }),
                ),
              )
            : Effect.sync(() => {
                disposals.push(current);
              });
        const factory: HandlerFactory = {
          makeApiLayer: () => Effect.succeed(emptyApiLayer),
          makeNodeHandler: () =>
            beginGeneration().pipe(
              Effect.map((current) => ({
                handler: (_req, response) => response.end(String(current)),
                dispose: disposeGeneration(current),
              })),
            ),
          makeWebHandler: () =>
            beginGeneration().pipe(
              Effect.map((current) => ({
                handler: () => Promise.resolve(new Response(String(current))),
                dispose: disposeGeneration(current),
              })),
            ),
        };
        const handle = yield* Scope.provide(
          devPlatform.makeApi({
            handlerFactory: factory,
            loadApiModule: () => Effect.succeed({ default: emptyApiLayer }),
            onError: () => Effect.void,
          }),
          apiScope,
        );
        const server = yield* withHttpServer(handle.middleware);
        const address = yield* decodeAddressInfo(server.address());

        const reload = yield* handle.reload.pipe(Effect.forkChild);
        yield* Deferred.await(oldDisposeStarted);
        const interrupting = yield* Fiber.interrupt(reload).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const bodyDuringDispose = yield* requestBody(address.port);

        assert.strictEqual(bodyDuringDispose, "2");
        assert.deepStrictEqual(disposals, []);

        yield* Deferred.succeed(releaseOldDispose, undefined).pipe(Effect.asVoid);
        yield* Fiber.join(interrupting);
        const reloadExit = yield* Fiber.await(reload);
        const bodyAfterInterrupt = yield* requestBody(address.port);

        assert.isTrue(Exit.isFailure(reloadExit));
        if (Exit.isFailure(reloadExit)) assert.isTrue(Cause.hasInterrupts(reloadExit.cause));
        assert.strictEqual(bodyAfterInterrupt, "2");
        assert.deepStrictEqual(disposals, [1]);

        yield* handle.dispose;
        yield* Scope.close(apiScope, Exit.void);
        assert.deepStrictEqual(disposals, [1, 2]);
      }).pipe(Effect.provide(platform.layer)),
    );
  }
});
