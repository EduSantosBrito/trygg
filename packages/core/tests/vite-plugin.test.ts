/**
 * Tests for Vite plugin
 * @module
 */
import { assert, describe, it } from "@effect/vitest"
import { FileSystem } from "@effect/platform"
import { layer as NodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem"
import { Effect, Schema, Scope } from "effect"
import * as path from "path"
import {
  effectUI,
  scanRoutes,
  generateRoutesModule,
  extractParamNames,
  generateParamType,
  generateRouteTypes,
  generateApiTypes,
  validateAppStructure,
  type RouteFile,
} from "../src/vite-plugin.js"

/**
 * Create a scoped temporary directory with route files.
 * Cleanup is handled by Effect's Scope (finalizer removes dir on scope close).
 */
const makeTempDir = (
  files: Record<string, string>
): Effect.Effect<string, never, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* fs.makeTempDirectory({ prefix: "effect-ui-test-" }).pipe(
      Effect.orDie
    )
    yield* Effect.addFinalizer(() =>
      fs.remove(dir, { recursive: true }).pipe(Effect.ignore)
    )
    yield* Effect.forEach(Object.entries(files), ([filePath, content]) =>
      Effect.gen(function* () {
        const fullPath = path.join(dir, filePath)
        yield* fs.makeDirectory(path.dirname(fullPath), { recursive: true }).pipe(
          Effect.catchTag("SystemError", (e) =>
            e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e)
          ),
          Effect.orDie
        )
        yield* fs.writeFileString(fullPath, content).pipe(Effect.orDie)
      })
    )
    return dir
  })

describe("Vite Plugin", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Plugin initialization
  // ─────────────────────────────────────────────────────────────────────────────
  describe("effectUI function", () => {
    it("should return a valid Vite plugin", () => {
      const plugin = effectUI()

      assert.isDefined(plugin)
      assert.isString(plugin.name)
      assert.strictEqual(plugin.name, "effect-ui")
      assert.isDefined(plugin.config)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: config hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("config hook", () => {
    // Schema for validating the config hook is a callable function
    const ConfigHookSchema = Schema.declare(
      (u: unknown): u is (...args: ReadonlyArray<unknown>) => unknown =>
        typeof u === "function"
    )

    // Schema for the expected esbuild config shape
    const EsbuildConfigSchema = Schema.Struct({
      esbuild: Schema.Struct({
        jsx: Schema.String,
        jsxImportSource: Schema.String,
      }),
    })

    // Schema for the expected optimizeDeps config shape
    const OptimizeDepsConfigSchema = Schema.Struct({
      optimizeDeps: Schema.Struct({
        include: Schema.Array(Schema.String),
        esbuildOptions: Schema.Struct({
          jsx: Schema.String,
          jsxImportSource: Schema.String,
        }),
      }),
    })

    it("should set esbuild jsx to automatic mode", () => {
      const plugin = effectUI()
      const configHook = Schema.decodeUnknownSync(ConfigHookSchema)(plugin.config)
      const result = configHook({}, { command: "serve", mode: "development" })
      const config = Schema.decodeUnknownSync(EsbuildConfigSchema)(result)
      assert.strictEqual(config.esbuild.jsx, "automatic")
      assert.strictEqual(config.esbuild.jsxImportSource, "effect-ui")
    })

    it("should configure optimizeDeps for effect-ui", () => {
      const plugin = effectUI()
      const configHook = Schema.decodeUnknownSync(ConfigHookSchema)(plugin.config)
      const result = configHook({}, { command: "serve", mode: "development" })
      const config = Schema.decodeUnknownSync(OptimizeDepsConfigSchema)(result)
      assert.isTrue(config.optimizeDeps.include.includes("effect-ui"))
      assert.strictEqual(config.optimizeDeps.esbuildOptions.jsx, "automatic")
      assert.strictEqual(config.optimizeDeps.esbuildOptions.jsxImportSource, "effect-ui")
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Route scanning
  // ─────────────────────────────────────────────────────────────────────────────
  describe("scanRoutes", () => {
    it.effect("should return empty array for non-existent directory", () =>
      Effect.gen(function* () {
        const routes = yield* scanRoutes("/non/existent/path")
        assert.deepStrictEqual([...routes], [])
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should scan index file as root route", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "index.tsx": "export default () => <div>Home</div>",
        })
        const routes = yield* scanRoutes(dir)
        assert.strictEqual(routes.length, 1)
        const route = routes[0]
        if (route === undefined) return assert.fail("expected route")
        assert.strictEqual(route.routePath, "/")
        assert.strictEqual(route.type, "page")
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should scan nested routes", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "index.tsx": "export default () => <div>Home</div>",
          "users/index.tsx": "export default () => <div>Users</div>",
          "users/profile.tsx": "export default () => <div>Profile</div>",
        })
        const routes = yield* scanRoutes(dir)
        const paths = [...routes].map((r) => r.routePath).sort()
        assert.deepStrictEqual(paths, ["/", "/users", "/users/profile"])
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should convert [param] to :param", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "users/[id].tsx": "export default () => <div>User</div>",
        })
        const routes = yield* scanRoutes(dir)
        assert.strictEqual(routes.length, 1)
        const route = routes[0]
        if (route === undefined) return assert.fail("expected route")
        assert.strictEqual(route.routePath, "/users/:id")
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should convert [...rest] to *", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "[...slug].tsx": "export default () => <div>Catchall</div>",
        })
        const routes = yield* scanRoutes(dir)
        assert.strictEqual(routes.length, 1)
        const route = routes[0]
        if (route === undefined) return assert.fail("expected route")
        assert.strictEqual(route.routePath, "/*")
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should identify layout files", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "layout.tsx": "export default () => <div>Layout</div>",
          "_layout.tsx": "export default () => <div>Alt Layout</div>",
          "index.tsx": "export default () => <div>Home</div>",
        })
        const routes = yield* scanRoutes(dir)
        const layouts = [...routes].filter((r) => r.type === "layout")
        assert.strictEqual(layouts.length, 2)
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should identify loading files", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "_loading.tsx": "export default () => <div>Loading...</div>",
          "index.tsx": "export default () => <div>Home</div>",
        })
        const routes = yield* scanRoutes(dir)
        const loading = [...routes].find((r) => r.type === "loading")
        if (loading === undefined) return assert.fail("expected loading route")
        assert.strictEqual(loading.routePath, "/")
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should identify error files", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "_error.tsx": "export default () => <div>Error!</div>",
          "index.tsx": "export default () => <div>Home</div>",
        })
        const routes = yield* scanRoutes(dir)
        const error = [...routes].find((r) => r.type === "error")
        if (error === undefined) return assert.fail("expected error route")
        assert.strictEqual(error.routePath, "/")
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should ignore other underscore-prefixed files", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "_utils.tsx": "export const foo = 1",
          "_helpers.ts": "export const bar = 2",
          "index.tsx": "export default () => <div>Home</div>",
        })
        const routes = yield* scanRoutes(dir)
        assert.strictEqual(routes.length, 1)
        const route = routes[0]
        if (route === undefined) return assert.fail("expected route")
        assert.strictEqual(route.routePath, "/")
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should track depth for nested routes", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "index.tsx": "export default () => <div>Home</div>",
          "a/index.tsx": "export default () => <div>A</div>",
          "a/b/index.tsx": "export default () => <div>B</div>",
          "a/b/c/index.tsx": "export default () => <div>C</div>",
        })
        const routes = yield* scanRoutes(dir)
        const routeArray = [...routes]
        const root = routeArray.find((r) => r.routePath === "/")
        const a = routeArray.find((r) => r.routePath === "/a")
        const b = routeArray.find((r) => r.routePath === "/a/b")
        const c = routeArray.find((r) => r.routePath === "/a/b/c")
        if (!root || !a || !b || !c) return assert.fail("expected all routes")
        assert.strictEqual(root.depth, 0)
        assert.strictEqual(a.depth, 1)
        assert.strictEqual(b.depth, 2)
        assert.strictEqual(c.depth, 3)
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Param extraction
  // ─────────────────────────────────────────────────────────────────────────────
  describe("extractParamNames", () => {
    it.effect("should return empty array for static route", () =>
      Effect.gen(function* () {
        const params = yield* extractParamNames("/users/profile")
        assert.deepStrictEqual([...params], [])
      })
    )

    it.effect("should extract single param", () =>
      Effect.gen(function* () {
        const params = yield* extractParamNames("/users/:id")
        assert.deepStrictEqual([...params], ["id"])
      })
    )

    it.effect("should extract multiple params", () =>
      Effect.gen(function* () {
        const params = yield* extractParamNames("/users/:userId/posts/:postId")
        assert.deepStrictEqual([...params], ["userId", "postId"])
      })
    )
  })

  describe("generateParamType", () => {
    it.effect("should return empty object for static route", () =>
      Effect.gen(function* () {
        const type = yield* generateParamType("/users/profile")
        assert.strictEqual(type, "{}")
      })
    )

    it.effect("should generate type for single param", () =>
      Effect.gen(function* () {
        const type = yield* generateParamType("/users/:id")
        assert.strictEqual(type, "{ readonly id: string }")
      })
    )

    it.effect("should generate type for multiple params", () =>
      Effect.gen(function* () {
        const type = yield* generateParamType("/users/:userId/posts/:postId")
        assert.strictEqual(type, "{ readonly userId: string; readonly postId: string }")
      })
    )
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Route types generation
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateRouteTypes", () => {
    it.effect("should generate empty RouteMap for no routes", () =>
      Effect.gen(function* () {
        const types = yield* generateRouteTypes([])
        assert.isTrue(types.includes('declare module "virtual:effect-ui/routes"'))
        assert.isTrue(types.includes("interface RouteMap"))
      })
    )

    it.effect("should generate RouteMap entries for page routes", () =>
      Effect.gen(function* () {
        const routes: RouteFile[] = [
          { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
          { filePath: "/app/routes/users.tsx", routePath: "/users", type: "page", depth: 0 },
        ]
        const types = yield* generateRouteTypes(routes)

        assert.isTrue(types.includes('readonly "/": {}'))
        assert.isTrue(types.includes('readonly "/users": {}'))
      })
    )

    it.effect("should generate param types for dynamic routes", () =>
      Effect.gen(function* () {
        const routes: RouteFile[] = [
          { filePath: "/app/routes/users/[id].tsx", routePath: "/users/:id", type: "page", depth: 1 },
        ]
        const types = yield* generateRouteTypes(routes)

        assert.isTrue(types.includes('readonly "/users/:id": { readonly id: string }'))
      })
    )

    it.effect("should exclude non-page routes from RouteMap", () =>
      Effect.gen(function* () {
        const routes: RouteFile[] = [
          { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
          { filePath: "/app/routes/layout.tsx", routePath: "/", type: "layout", depth: 0 },
          { filePath: "/app/routes/_loading.tsx", routePath: "/", type: "loading", depth: 0 },
          { filePath: "/app/routes/_error.tsx", routePath: "/", type: "error", depth: 0 },
        ]
        const types = yield* generateRouteTypes(routes)

        // Should only have one entry (the page route)
        const matches = types.match(/readonly "\//g)
        assert.strictEqual(matches?.length, 1)
      })
    )
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Routes module generation
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateRoutesModule", () => {
    it.effect("should generate empty routes array for no routes", () =>
      Effect.gen(function* () {
        const module = yield* generateRoutesModule([], "/app/routes")
        assert.isTrue(module.includes("export const routes = ["))
        assert.isTrue(module.includes("];"))
      })
    )

    it.effect("should generate route entries with component imports", () =>
      Effect.gen(function* () {
        const routes: RouteFile[] = [
          { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
        ]
        const module = yield* generateRoutesModule(routes, "/app/routes")

        assert.isTrue(module.includes('path: "/"'))
        assert.isTrue(module.includes('component: () => import("/app/routes/index.tsx")'))
      })
    )

    it.effect("should include layout for routes with matching layout", () =>
      Effect.gen(function* () {
        const routes: RouteFile[] = [
          { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
          { filePath: "/app/routes/layout.tsx", routePath: "/", type: "layout", depth: 0 },
        ]
        const module = yield* generateRoutesModule(routes, "/app/routes")

        assert.isTrue(module.includes('layout: () => import("/app/routes/layout.tsx")'))
      })
    )

    it.effect("should include loading component for routes with matching loading", () =>
      Effect.gen(function* () {
        const routes: RouteFile[] = [
          { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
          { filePath: "/app/routes/_loading.tsx", routePath: "/", type: "loading", depth: 0 },
        ]
        const module = yield* generateRoutesModule(routes, "/app/routes")

        assert.isTrue(module.includes('loadingComponent: () => import("/app/routes/_loading.tsx")'))
      })
    )

    it.effect("should include error component for routes with matching error", () =>
      Effect.gen(function* () {
        const routes: RouteFile[] = [
          { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
          { filePath: "/app/routes/_error.tsx", routePath: "/", type: "error", depth: 0 },
        ]
        const module = yield* generateRoutesModule(routes, "/app/routes")

        assert.isTrue(module.includes('errorComponent: () => import("/app/routes/_error.tsx")'))
      })
    )

    it.effect("should match nested routes to parent special files", () =>
      Effect.gen(function* () {
        const routes: RouteFile[] = [
          { filePath: "/app/routes/users/index.tsx", routePath: "/users", type: "page", depth: 1 },
          { filePath: "/app/routes/layout.tsx", routePath: "/", type: "layout", depth: 0 },
        ]
        const module = yield* generateRoutesModule(routes, "/app/routes")

        // /users should pick up the root layout
        assert.isTrue(module.includes('path: "/users"'))
        assert.isTrue(module.includes('layout: () => import("/app/routes/layout.tsx")'))
      })
    )

    it.effect("should prefer more specific layouts for nested routes", () =>
      Effect.gen(function* () {
        const routes: RouteFile[] = [
          {
            filePath: "/app/routes/users/profile.tsx",
            routePath: "/users/profile",
            type: "page",
            depth: 2,
          },
          { filePath: "/app/routes/layout.tsx", routePath: "/", type: "layout", depth: 0 },
          { filePath: "/app/routes/users/layout.tsx", routePath: "/users", type: "layout", depth: 1 },
        ]
        const module = yield* generateRoutesModule(routes, "/app/routes")

        // Should use /users/layout.tsx, not /layout.tsx
        assert.isTrue(module.includes('layout: () => import("/app/routes/users/layout.tsx")'))
        assert.isFalse(module.includes('layout: () => import("/app/routes/layout.tsx")'))
      })
    )
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: API types generation
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateApiTypes", () => {
    it.scoped("should generate placeholder when no api.ts exists", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({})
        const types = yield* generateApiTypes(dir)
        assert.isTrue(types.includes("No API file found"))
        assert.isTrue(types.includes("export const client: never"))
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should generate types when api.ts exists", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "api.ts": "export class Api {} export const ApiLive = {}",
        })
        const types = yield* generateApiTypes(dir)
        assert.isTrue(types.includes('import type { HttpApiClient } from "@effect/platform"'))
        assert.isTrue(types.includes("import type { Api } from"))
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: App structure validation
  // ─────────────────────────────────────────────────────────────────────────────
  describe("validateAppStructure", () => {
    it.scoped("should require layout.tsx", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "routes/index.tsx": "export default () => <div>Home</div>",
        })
        const result = yield* validateAppStructure(dir).pipe(Effect.either)
        assert.strictEqual(result._tag, "Left")
        if (result._tag === "Left") {
          const layoutError = result.left.errors.find((e) => e.message.includes("layout"))
          assert.isDefined(layoutError)
        }
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should require routes directory", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "layout.tsx": "export default () => <div>Layout</div>",
        })
        const result = yield* validateAppStructure(dir).pipe(Effect.either)
        assert.strictEqual(result._tag, "Left")
        if (result._tag === "Left") {
          const routesError = result.left.errors.find((e) => e.message.includes("routes"))
          assert.isDefined(routesError)
        }
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )

    it.scoped("should pass when both layout.tsx and routes exist", () =>
      Effect.gen(function* () {
        const dir = yield* makeTempDir({
          "layout.tsx": "export default () => <div>Layout</div>",
          "routes/index.tsx": "export default () => <div>Home</div>",
        })
        const result = yield* validateAppStructure(dir).pipe(Effect.either)
        assert.strictEqual(result._tag, "Right")
      }).pipe(Effect.provide(NodeFileSystemLayer))
    )
  })
})
