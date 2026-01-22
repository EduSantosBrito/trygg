/**
 * Tests for Vite plugin
 * @module
 */
import { assert, describe, it } from "@effect/vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
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
} from "../src/vite-plugin.js";

// Helper to create a temporary directory with route files
const createTempDir = (files: Record<string, string>): { dir: string; cleanup: () => void } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "effect-ui-test-"));

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  return {
    dir,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
};

describe("Vite Plugin", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Plugin initialization
  // ─────────────────────────────────────────────────────────────────────────────
  describe("effectUI function", () => {
    it("should return a valid Vite plugin", () => {
      const plugin = effectUI();

      assert.isDefined(plugin);
      assert.isString(plugin.name);
      assert.strictEqual(plugin.name, "effect-ui");
      assert.isDefined(plugin.config);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: config hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("config hook", () => {
    it("should set esbuild jsx to automatic mode", () => {
      const plugin = effectUI();
      const config = (plugin.config as Function)({}, { command: "serve" });

      assert.isDefined(config);
      assert.strictEqual(config.esbuild.jsx, "automatic");
      assert.strictEqual(config.esbuild.jsxImportSource, "effect-ui");
    });

    it("should configure optimizeDeps for effect-ui", () => {
      const plugin = effectUI();
      const config = (plugin.config as Function)({}, { command: "serve" });

      assert.isTrue(config.optimizeDeps.include.includes("effect-ui"));
      assert.strictEqual(config.optimizeDeps.esbuildOptions.jsx, "automatic");
      assert.strictEqual(config.optimizeDeps.esbuildOptions.jsxImportSource, "effect-ui");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Route scanning
  // ─────────────────────────────────────────────────────────────────────────────
  describe("scanRoutes", () => {
    it("should return empty array for non-existent directory", () => {
      const routes = scanRoutes("/non/existent/path");
      assert.deepStrictEqual(routes, []);
    });

    it("should scan index file as root route", () => {
      const { dir, cleanup } = createTempDir({
        "index.tsx": "export default () => <div>Home</div>",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        const route = routes[0]!;
        assert.strictEqual(route.routePath, "/");
        assert.strictEqual(route.type, "page");
      } finally {
        cleanup();
      }
    });

    it("should scan nested routes", () => {
      const { dir, cleanup } = createTempDir({
        "index.tsx": "export default () => <div>Home</div>",
        "users/index.tsx": "export default () => <div>Users</div>",
        "users/profile.tsx": "export default () => <div>Profile</div>",
      });

      try {
        const routes = scanRoutes(dir);
        const paths = routes.map((r) => r.routePath).sort();
        assert.deepStrictEqual(paths, ["/", "/users", "/users/profile"]);
      } finally {
        cleanup();
      }
    });

    it("should convert [param] to :param", () => {
      const { dir, cleanup } = createTempDir({
        "users/[id].tsx": "export default () => <div>User</div>",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        assert.strictEqual(routes[0]!.routePath, "/users/:id");
      } finally {
        cleanup();
      }
    });

    it("should convert [...rest] to *", () => {
      const { dir, cleanup } = createTempDir({
        "[...slug].tsx": "export default () => <div>Catchall</div>",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        assert.strictEqual(routes[0]!.routePath, "/*");
      } finally {
        cleanup();
      }
    });

    it("should identify layout files", () => {
      const { dir, cleanup } = createTempDir({
        "layout.tsx": "export default () => <div>Layout</div>",
        "_layout.tsx": "export default () => <div>Alt Layout</div>",
        "index.tsx": "export default () => <div>Home</div>",
      });

      try {
        const routes = scanRoutes(dir);
        const layouts = routes.filter((r) => r.type === "layout");
        assert.strictEqual(layouts.length, 2);
      } finally {
        cleanup();
      }
    });

    it("should identify loading files", () => {
      const { dir, cleanup } = createTempDir({
        "_loading.tsx": "export default () => <div>Loading...</div>",
        "index.tsx": "export default () => <div>Home</div>",
      });

      try {
        const routes = scanRoutes(dir);
        const loading = routes.find((r) => r.type === "loading");
        assert.isDefined(loading);
        assert.strictEqual(loading!.routePath, "/");
      } finally {
        cleanup();
      }
    });

    it("should identify error files", () => {
      const { dir, cleanup } = createTempDir({
        "_error.tsx": "export default () => <div>Error!</div>",
        "index.tsx": "export default () => <div>Home</div>",
      });

      try {
        const routes = scanRoutes(dir);
        const error = routes.find((r) => r.type === "error");
        assert.isDefined(error);
        assert.strictEqual(error!.routePath, "/");
      } finally {
        cleanup();
      }
    });

    it("should ignore other underscore-prefixed files", () => {
      const { dir, cleanup } = createTempDir({
        "_utils.tsx": "export const foo = 1",
        "_helpers.ts": "export const bar = 2",
        "index.tsx": "export default () => <div>Home</div>",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        assert.strictEqual(routes[0]!.routePath, "/");
      } finally {
        cleanup();
      }
    });

    it("should track depth for nested routes", () => {
      const { dir, cleanup } = createTempDir({
        "index.tsx": "export default () => <div>Home</div>",
        "a/index.tsx": "export default () => <div>A</div>",
        "a/b/index.tsx": "export default () => <div>B</div>",
        "a/b/c/index.tsx": "export default () => <div>C</div>",
      });

      try {
        const routes = scanRoutes(dir);
        const root = routes.find((r) => r.routePath === "/");
        const a = routes.find((r) => r.routePath === "/a");
        const b = routes.find((r) => r.routePath === "/a/b");
        const c = routes.find((r) => r.routePath === "/a/b/c");

        assert.strictEqual(root!.depth, 0);
        assert.strictEqual(a!.depth, 1);
        assert.strictEqual(b!.depth, 2);
        assert.strictEqual(c!.depth, 3);
      } finally {
        cleanup();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Param extraction
  // ─────────────────────────────────────────────────────────────────────────────
  describe("extractParamNames", () => {
    it("should return empty array for static route", () => {
      const params = extractParamNames("/users/profile");
      assert.deepStrictEqual(params, []);
    });

    it("should extract single param", () => {
      const params = extractParamNames("/users/:id");
      assert.deepStrictEqual(params, ["id"]);
    });

    it("should extract multiple params", () => {
      const params = extractParamNames("/users/:userId/posts/:postId");
      assert.deepStrictEqual(params, ["userId", "postId"]);
    });
  });

  describe("generateParamType", () => {
    it("should return empty object for static route", () => {
      const type = generateParamType("/users/profile");
      assert.strictEqual(type, "{}");
    });

    it("should generate type for single param", () => {
      const type = generateParamType("/users/:id");
      assert.strictEqual(type, "{ readonly id: string }");
    });

    it("should generate type for multiple params", () => {
      const type = generateParamType("/users/:userId/posts/:postId");
      assert.strictEqual(type, "{ readonly userId: string; readonly postId: string }");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Route types generation
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateRouteTypes", () => {
    it("should generate empty RouteMap for no routes", () => {
      const types = generateRouteTypes([]);
      assert.isTrue(types.includes('declare module "effect-ui/router"'));
      assert.isTrue(types.includes("interface RouteMap"));
    });

    it("should generate RouteMap entries for page routes", () => {
      const routes: RouteFile[] = [
        { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
        { filePath: "/app/routes/users.tsx", routePath: "/users", type: "page", depth: 0 },
      ];
      const types = generateRouteTypes(routes);

      assert.isTrue(types.includes('readonly "/": {}'));
      assert.isTrue(types.includes('readonly "/users": {}'));
    });

    it("should generate param types for dynamic routes", () => {
      const routes: RouteFile[] = [
        { filePath: "/app/routes/users/[id].tsx", routePath: "/users/:id", type: "page", depth: 1 },
      ];
      const types = generateRouteTypes(routes);

      assert.isTrue(types.includes('readonly "/users/:id": { readonly id: string }'));
    });

    it("should exclude non-page routes from RouteMap", () => {
      const routes: RouteFile[] = [
        { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
        { filePath: "/app/routes/layout.tsx", routePath: "/", type: "layout", depth: 0 },
        { filePath: "/app/routes/_loading.tsx", routePath: "/", type: "loading", depth: 0 },
        { filePath: "/app/routes/_error.tsx", routePath: "/", type: "error", depth: 0 },
      ];
      const types = generateRouteTypes(routes);

      // Should only have one entry (the page route)
      const matches = types.match(/readonly "\//g);
      assert.strictEqual(matches?.length, 1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Routes module generation
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateRoutesModule", () => {
    it("should generate empty routes array for no routes", () => {
      const module = generateRoutesModule([], "/app/routes");
      assert.isTrue(module.includes("export const routes = ["));
      assert.isTrue(module.includes("];"));
    });

    it("should generate route entries with component imports", () => {
      const routes: RouteFile[] = [
        { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
      ];
      const module = generateRoutesModule(routes, "/app/routes");

      assert.isTrue(module.includes('path: "/"'));
      assert.isTrue(module.includes('component: () => import("/app/routes/index.tsx")'));
    });

    it("should include layout for routes with matching layout", () => {
      const routes: RouteFile[] = [
        { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
        { filePath: "/app/routes/layout.tsx", routePath: "/", type: "layout", depth: 0 },
      ];
      const module = generateRoutesModule(routes, "/app/routes");

      assert.isTrue(module.includes('layout: () => import("/app/routes/layout.tsx")'));
    });

    it("should include loading component for routes with matching loading", () => {
      const routes: RouteFile[] = [
        { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
        { filePath: "/app/routes/_loading.tsx", routePath: "/", type: "loading", depth: 0 },
      ];
      const module = generateRoutesModule(routes, "/app/routes");

      assert.isTrue(module.includes('loadingComponent: () => import("/app/routes/_loading.tsx")'));
    });

    it("should include error component for routes with matching error", () => {
      const routes: RouteFile[] = [
        { filePath: "/app/routes/index.tsx", routePath: "/", type: "page", depth: 0 },
        { filePath: "/app/routes/_error.tsx", routePath: "/", type: "error", depth: 0 },
      ];
      const module = generateRoutesModule(routes, "/app/routes");

      assert.isTrue(module.includes('errorComponent: () => import("/app/routes/_error.tsx")'));
    });

    it("should match nested routes to parent special files", () => {
      const routes: RouteFile[] = [
        { filePath: "/app/routes/users/index.tsx", routePath: "/users", type: "page", depth: 1 },
        { filePath: "/app/routes/layout.tsx", routePath: "/", type: "layout", depth: 0 },
      ];
      const module = generateRoutesModule(routes, "/app/routes");

      // /users should pick up the root layout
      assert.isTrue(module.includes('path: "/users"'));
      assert.isTrue(module.includes('layout: () => import("/app/routes/layout.tsx")'));
    });

    it("should prefer more specific layouts for nested routes", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/app/routes/users/profile.tsx",
          routePath: "/users/profile",
          type: "page",
          depth: 2,
        },
        { filePath: "/app/routes/layout.tsx", routePath: "/", type: "layout", depth: 0 },
        { filePath: "/app/routes/users/layout.tsx", routePath: "/users", type: "layout", depth: 1 },
      ];
      const module = generateRoutesModule(routes, "/app/routes");

      // Should use /users/layout.tsx, not /layout.tsx
      assert.isTrue(module.includes('layout: () => import("/app/routes/users/layout.tsx")'));
      assert.isFalse(module.includes('layout: () => import("/app/routes/layout.tsx")'));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: API types generation
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateApiTypes", () => {
    it("should generate placeholder when no api.ts exists", () => {
      const { dir, cleanup } = createTempDir({});

      try {
        const types = generateApiTypes(dir);
        assert.isTrue(types.includes("No API file found"));
        assert.isTrue(types.includes("export const client: never"));
      } finally {
        cleanup();
      }
    });

    it("should generate types when api.ts exists", () => {
      const { dir, cleanup } = createTempDir({
        "api.ts": "export class Api {} export const ApiLive = {}",
      });

      try {
        const types = generateApiTypes(dir);
        assert.isTrue(types.includes('import type { HttpApiClient } from "@effect/platform"'));
        assert.isTrue(types.includes("import type { Api } from"));
      } finally {
        cleanup();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: App structure validation
  // ─────────────────────────────────────────────────────────────────────────────
  describe("validateAppStructure", () => {
    it("should require layout.tsx", () => {
      const { dir, cleanup } = createTempDir({
        "routes/index.tsx": "export default () => <div>Home</div>",
      });

      try {
        const errors = validateAppStructure(dir);
        const layoutError = errors.find((e) => e.message.includes("Root layout"));
        assert.isDefined(layoutError);
      } finally {
        cleanup();
      }
    });

    it("should require routes directory", () => {
      const { dir, cleanup } = createTempDir({
        "layout.tsx": "export default () => <div>Layout</div>",
      });

      try {
        const errors = validateAppStructure(dir);
        const routesError = errors.find((e) => e.message.includes("Routes directory"));
        assert.isDefined(routesError);
      } finally {
        cleanup();
      }
    });

    it("should pass when both layout.tsx and routes exist", () => {
      const { dir, cleanup } = createTempDir({
        "layout.tsx": "export default () => <div>Layout</div>",
        "routes/index.tsx": "export default () => <div>Home</div>",
      });

      try {
        const errors = validateAppStructure(dir);
        assert.strictEqual(errors.length, 0);
      } finally {
        cleanup();
      }
    });
  });
});
