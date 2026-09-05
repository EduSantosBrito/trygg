import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  BuildArtifactPlanner,
  BuildArtifactOperation,
  GeneratedArtifactPlanner,
  type BuildArtifactPlanInput,
} from "../build-artifact-planner.js";

const validationPlanner = BuildArtifactPlanner.make({ failOnWarnings: false });
const artifactPlanner = GeneratedArtifactPlanner.make({ includeCleanupOperations: true });

const input = (overrides: Partial<BuildArtifactPlanInput>): BuildArtifactPlanInput => ({
  output: "server",
  platform: "node",
  hasApi: false,
  appDir: "app",
  generatedDir: ".trygg",
  ...overrides,
});

const plan = Effect.fn("GeneratedArtifactPlanner.test.plan")(function* (
  overrides: Partial<BuildArtifactPlanInput>,
) {
  const validation = yield* validationPlanner.validateOutput(input(overrides));
  return yield* artifactPlanner.planArtifacts(validation);
});

const operationDescriptors = (operations: ReadonlyArray<BuildArtifactOperation>) =>
  operations.map((operation) =>
    BuildArtifactOperation.$match(operation, {
      WriteFile: ({ path }) => ({ tag: "WriteFile", path }),
      RemoveFile: ({ path }) => ({ tag: "RemoveFile", path }),
      RunNestedBuild: ({ name, configFile }) => ({ tag: "RunNestedBuild", name, configFile }),
    }),
  );

interface CloudflareStaticWorkerModule {
  readonly default: {
    readonly fetch: (
      request: Request,
      env: { readonly ASSETS: { readonly fetch: (request: Request) => Promise<Response> } },
    ) => Promise<Response>;
  };
}

const decodeCloudflareStaticWorkerModule = Schema.decodeUnknownSync(
  Schema.Struct({
    default: Schema.Struct({
      fetch: Schema.declare(
        (value: unknown): value is CloudflareStaticWorkerModule["default"]["fetch"] =>
          typeof value === "function",
      ),
    }),
  }),
);

const loadPlannedCloudflareWorker = Effect.gen(function* () {
  const artifactPlan = yield* plan({ output: "static", platform: "cloudflare" });
  const operation = artifactPlan.operations.find(
    (candidate) =>
      BuildArtifactOperation.$is("WriteFile")(candidate) &&
      candidate.path === ".trygg/worker-entry.js",
  );
  if (operation === undefined || !BuildArtifactOperation.$is("WriteFile")(operation)) {
    return assert.fail("Expected the planned Cloudflare Worker WriteFile operation");
  }

  const moduleUrl = `data:text/javascript,${encodeURIComponent(operation.contents)}`;
  const module = yield* Effect.promise(() => import(moduleUrl));
  return decodeCloudflareStaticWorkerModule(module);
});

describe("GeneratedArtifactPlanner", () => {
  it.effect("plans static generated shell without Worker artifact for non-Cloudflare targets", () =>
    Effect.gen(function* () {
      const artifactPlan = yield* plan({ output: "static", platform: "node" });

      assert.deepStrictEqual(operationDescriptors(artifactPlan.operations), [
        { tag: "WriteFile", path: ".trygg/index.html" },
        { tag: "RemoveFile", path: ".trygg/worker-entry.js" },
      ]);
    }),
  );

  it.effect("plans Cloudflare static SPA Worker artifact", () =>
    Effect.gen(function* () {
      const artifactPlan = yield* plan({ output: "static", platform: "cloudflare" });

      assert.deepStrictEqual(operationDescriptors(artifactPlan.operations), [
        { tag: "WriteFile", path: ".trygg/index.html" },
        { tag: "WriteFile", path: ".trygg/worker-entry.js" },
      ]);
    }),
  );

  it.effect("plans server output with cleanup and nested server build intent", () =>
    Effect.gen(function* () {
      const artifactPlan = yield* plan({ output: "server", platform: "bun" });

      assert.deepStrictEqual(operationDescriptors(artifactPlan.operations), [
        { tag: "WriteFile", path: ".trygg/index.html" },
        { tag: "RemoveFile", path: ".trygg/worker-entry.js" },
        { tag: "RunNestedBuild", name: "production-server", configFile: ".trygg/server-entry.ts" },
      ]);
    }),
  );

  it.effect("renders operation summaries", () =>
    Effect.gen(function* () {
      const artifactPlan = yield* plan({ output: "server", platform: "node" });
      const summary = yield* artifactPlanner.renderOperationSummary(artifactPlan);

      assert.deepStrictEqual(summary, [
        "write .trygg/index.html",
        "remove .trygg/worker-entry.js",
        "run production-server from .trygg/server-entry.ts",
      ]);
    }),
  );

  it.effect("executes the planned Worker contents for deep-route shell fallback", () =>
    Effect.gen(function* () {
      // Scope: exercises the exact WriteFile payload consumed by production artifact execution.
      // Assertion: a document route misses once, then loads the shell from / without /index.html.
      const worker = yield* loadPlannedCloudflareWorker;
      const requestedPaths: Array<string> = [];
      const env = {
        ASSETS: {
          fetch: (request: Request) => {
            const pathname = new URL(request.url).pathname;
            requestedPaths.push(pathname);
            return Promise.resolve(
              pathname === "/"
                ? new Response("<html>shell</html>", { status: 200 })
                : new Response("missing", { status: 404 }),
            );
          },
        },
      };

      const response = yield* Effect.promise(() =>
        worker.default.fetch(
          new Request("https://example.com/changelog/example?preview=true", {
            headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
          }),
          env,
        ),
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(yield* Effect.promise(() => response.text()), "<html>shell</html>");
      assert.deepStrictEqual(requestedPaths, ["/changelog/example", "/"]);
      assert.notInclude(requestedPaths, "/index.html");
    }),
  );

  it.effect("executes the planned Worker contents without hiding API or method 404s", () =>
    Effect.gen(function* () {
      // Scope: covers API and method boundaries in the emitted Worker.
      // Assertion: API GET and document POST requests retain their original 404.
      const worker = yield* loadPlannedCloudflareWorker;
      const requestedPaths: Array<string> = [];
      const env = {
        ASSETS: {
          fetch: (request: Request) => {
            requestedPaths.push(new URL(request.url).pathname);
            return Promise.resolve(new Response("missing", { status: 404 }));
          },
        },
      };

      const requests = [
        new Request("https://example.com/api/missing", {
          headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
        }),
        new Request("https://example.com/changelog/example", {
          method: "POST",
          headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
        }),
      ];
      const responses = yield* Effect.forEach(
        requests,
        (request) => Effect.promise(() => worker.default.fetch(request, env)),
        { concurrency: "unbounded" },
      );

      assert.deepStrictEqual(
        responses.map((response) => response.status),
        [404, 404],
      );
      assert.deepStrictEqual(requestedPaths, ["/api/missing", "/changelog/example"]);
    }),
  );

  it.effect("keeps every missing file-like request as a 404", () =>
    Effect.gen(function* () {
      // Scope: covers common assets and an extension unknown to the framework in the exact artifact.
      // Assertion: txt, pdf, font, map, image, and unknown extensions never become the SPA shell.
      const worker = yield* loadPlannedCloudflareWorker;
      const requestedPaths: Array<string> = [];
      const env = {
        ASSETS: {
          fetch: (request: Request) => {
            requestedPaths.push(new URL(request.url).pathname);
            return Promise.resolve(new Response("missing", { status: 404 }));
          },
        },
      };
      const paths = [
        "/robots.txt",
        "/manual.pdf",
        "/fonts/inter.woff2",
        "/assets/app.js.map",
        "/images/logo.png",
        "/downloads/archive.unknown-extension",
      ];

      const responses = yield* Effect.forEach(paths, (pathname) =>
        Effect.promise(() =>
          worker.default.fetch(
            new Request(`https://example.com${pathname}`, {
              headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
            }),
            env,
          ),
        ),
      );

      assert.deepStrictEqual(
        responses.map((response) => response.status),
        paths.map(() => 404),
      );
      assert.deepStrictEqual(requestedPaths, paths);
    }),
  );

  it.effect("uses document Accept semantics for extensionless SPA fallback", () =>
    Effect.gen(function* () {
      // Scope: distinguishes HTML navigation from JSON, wildcard, and explicitly disabled HTML.
      // Assertion: only extensionless requests that positively accept HTML fetch the shell.
      const worker = yield* loadPlannedCloudflareWorker;
      const cases = [
        {
          headers: { Accept: "text/html" },
          expectedStatus: 200,
        },
        {
          headers: { Accept: "application/xhtml+xml", "Sec-Fetch-Dest": "document" },
          expectedStatus: 200,
        },
        {
          headers: { Accept: "application/json", "Sec-Fetch-Dest": "document" },
          expectedStatus: 404,
        },
        {
          headers: { Accept: "*/*", "Sec-Fetch-Dest": "document" },
          expectedStatus: 404,
        },
        {
          headers: { Accept: "text/html;q=0, application/json", "Sec-Fetch-Dest": "document" },
          expectedStatus: 404,
        },
      ];

      for (const testCase of cases) {
        const requestedPaths: Array<string> = [];
        const env = {
          ASSETS: {
            fetch: (request: Request) => {
              const pathname = new URL(request.url).pathname;
              requestedPaths.push(pathname);
              return Promise.resolve(
                pathname === "/"
                  ? new Response("<html>shell</html>", { status: 200 })
                  : new Response("missing", { status: 404 }),
              );
            },
          },
        };
        const response = yield* Effect.promise(() =>
          worker.default.fetch(
            new Request("https://example.com/account/settings", {
              headers: testCase.headers,
            }),
            env,
          ),
        );

        assert.strictEqual(response.status, testCase.expectedStatus, testCase.headers.Accept);
        assert.deepStrictEqual(
          requestedPaths,
          testCase.expectedStatus === 200 ? ["/account/settings", "/"] : ["/account/settings"],
        );
      }
    }),
  );

  it.effect("classifies safely decoded path segments before SPA fallback", () =>
    Effect.gen(function* () {
      // Scope: exercises encoded dots, malformed escapes, and encoded separators in planned code.
      // Assertion: only safely decoded extensionless navigation reaches the shell.
      const worker = yield* loadPlannedCloudflareWorker;
      const cases = [
        { pathname: "/assets/app%2Ejs", expectedStatus: 404 },
        { pathname: "/assets/app%2eJS", expectedStatus: 404 },
        { pathname: "/downloads/archive%2Eunknown-extension", expectedStatus: 404 },
        { pathname: "/broken/%ZZ", expectedStatus: 404 },
        { pathname: "/docs%2Farchive/current", expectedStatus: 404 },
        { pathname: "/docs/archive%5Ccurrent", expectedStatus: 404 },
        { pathname: "/releases%2Earchive/current", expectedStatus: 200 },
        { pathname: "/releases/archive%2Ecurrent", expectedStatus: 404 },
        { pathname: "/account/settings", expectedStatus: 200 },
      ];

      for (const testCase of cases) {
        const requestedPaths: Array<string> = [];
        const env = {
          ASSETS: {
            fetch: (request: Request) => {
              const pathname = new URL(request.url).pathname;
              requestedPaths.push(pathname);
              return Promise.resolve(
                pathname === "/"
                  ? new Response("<html>shell</html>", { status: 200 })
                  : new Response("missing", { status: 404 }),
              );
            },
          },
        };
        const response = yield* Effect.promise(() =>
          worker.default.fetch(
            new Request(`https://example.com${testCase.pathname}`, {
              headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
            }),
            env,
          ),
        );

        assert.strictEqual(response.status, testCase.expectedStatus, testCase.pathname);
        assert.deepStrictEqual(
          requestedPaths,
          testCase.expectedStatus === 200 ? [testCase.pathname, "/"] : [testCase.pathname],
        );
      }
    }),
  );
});
