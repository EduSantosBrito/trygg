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
  scoreRoutePath,
  type RouteFile,
} from "../src/vite-plugin.js";

// Helper to create a temporary directory with route files
const createTempRoutes = (files: Record<string, string>): { dir: string; cleanup: () => void } => {
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
    it("should return a valid Vite plugin with default options", () => {
      const plugin = effectUI();

      assert.isDefined(plugin);
      assert.isString(plugin.name);
      assert.isDefined(plugin.config);
    });

    it("should have correct plugin name", () => {
      const plugin = effectUI();

      assert.strictEqual(plugin.name, "vite-plugin-effect-ui");
    });

    it("should accept custom jsxImportSource option", () => {
      const plugin = effectUI({ jsxImportSource: "custom-source" });

      // Plugin should be created without error
      assert.isDefined(plugin);
    });

    it("should suppress warnings when silent is true", () => {
      const plugin = effectUI({ silent: true });

      // Plugin should be created without error
      assert.isDefined(plugin);
    });

    it("should enable file-based routing when routes specified", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "export default () => <div>Home</div>",
      });

      try {
        const plugin = effectUI({ routes: dir });
        assert.isDefined(plugin);
      } finally {
        cleanup();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: config hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("config hook", () => {
    it("should set esbuild jsx to automatic mode", () => {
      const plugin = effectUI();
      const config = (plugin.config as Function)({}, { command: "serve" });

      assert.strictEqual(config.esbuild.jsx, "automatic");
    });

    it("should set jsxImportSource to effect-ui", () => {
      const plugin = effectUI();
      const config = (plugin.config as Function)({}, { command: "serve" });

      assert.strictEqual(config.esbuild.jsxImportSource, "effect-ui");
    });

    it("should include effect in optimizeDeps for build", () => {
      const plugin = effectUI();
      const config = (plugin.config as Function)({}, { command: "build" });

      assert.isDefined(config.optimizeDeps);
      assert.isTrue(config.optimizeDeps.include.includes("effect"));
    });

    it("should not set optimizeDeps for serve command", () => {
      const plugin = effectUI();
      const config = (plugin.config as Function)({}, { command: "serve" });

      assert.isUndefined(config.optimizeDeps);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: configResolved hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("configResolved hook", () => {
    it("should warn when React plugin detected", () => {
      const plugin = effectUI();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warnings.push(msg);

      try {
        (plugin.configResolved as Function)({
          root: process.cwd(),
          plugins: [{ name: "vite:react" }],
          esbuild: {},
          command: "serve",
        });

        assert.isTrue(warnings.some((w) => w.includes("React") || w.includes("Preact")));
      } finally {
        console.warn = originalWarn;
      }
    });

    it("should warn when Preact plugin detected", () => {
      const plugin = effectUI();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warnings.push(msg);

      try {
        (plugin.configResolved as Function)({
          root: process.cwd(),
          plugins: [{ name: "vite:preact" }],
          esbuild: {},
          command: "serve",
        });

        assert.isTrue(warnings.some((w) => w.includes("React") || w.includes("Preact")));
      } finally {
        console.warn = originalWarn;
      }
    });

    it("should warn about classic JSX mode", () => {
      const plugin = effectUI();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warnings.push(msg);

      try {
        (plugin.configResolved as Function)({
          root: process.cwd(),
          plugins: [],
          esbuild: { jsx: "transform", jsxFactory: "React.createElement" },
          command: "serve",
        });

        assert.isTrue(warnings.some((w) => w.includes("classic JSX")));
      } finally {
        console.warn = originalWarn;
      }
    });

    it("should warn about conflicting jsxImportSource", () => {
      const plugin = effectUI();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warnings.push(msg);

      try {
        (plugin.configResolved as Function)({
          root: process.cwd(),
          plugins: [],
          esbuild: { jsxImportSource: "react" },
          command: "serve",
        });

        assert.isTrue(warnings.some((w) => w.includes("jsxImportSource")));
      } finally {
        console.warn = originalWarn;
      }
    });

    it("should log success message in dev mode", () => {
      const plugin = effectUI();
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      try {
        (plugin.configResolved as Function)({
          root: process.cwd(),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        assert.isTrue(logs.some((l) => l.includes("JSX configured") || l.includes("effect-ui")));
      } finally {
        console.log = originalLog;
      }
    });

    it("should suppress logs when silent is true", () => {
      const plugin = effectUI({ silent: true });
      const logs: string[] = [];
      const warnings: string[] = [];
      const originalLog = console.log;
      const originalWarn = console.warn;
      console.log = (msg: string) => logs.push(msg);
      console.warn = (msg: string) => warnings.push(msg);

      try {
        (plugin.configResolved as Function)({
          root: process.cwd(),
          plugins: [{ name: "vite:react" }],
          esbuild: {},
          command: "serve",
        });

        // No effect-ui logs when silent
        assert.isFalse(logs.some((l) => l.includes("[effect-ui]")));
      } finally {
        console.log = originalLog;
        console.warn = originalWarn;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: transform hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("transform hook", () => {
    it("should only process TSX and JSX files", () => {
      const plugin = effectUI();
      const transform = plugin.transform as Function;

      // Non-JSX files should return null
      assert.isNull(transform("const x = 1", "file.ts"));
      assert.isNull(transform("const x = 1", "file.js"));
      assert.isNull(transform("const x = 1", "file.json"));
    });

    it("should warn about React imports in dev mode", () => {
      const plugin = effectUI();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV ?? "test";
      console.warn = (msg: string) => warnings.push(msg);
      process.env.NODE_ENV = "development";

      try {
        const transform = plugin.transform as Function;
        transform('import React from "react"', "test.tsx");

        assert.isTrue(warnings.some((w) => w.includes("React import")));
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("should warn about createElement usage", () => {
      const plugin = effectUI();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV ?? "test";
      console.warn = (msg: string) => warnings.push(msg);
      process.env.NODE_ENV = "development";

      try {
        const transform = plugin.transform as Function;
        transform("React.createElement('div')", "test.tsx");

        assert.isTrue(warnings.some((w) => w.includes("createElement")));
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("should suppress transform warnings when silent", () => {
      const plugin = effectUI({ silent: true });
      const warnings: string[] = [];
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV ?? "test";
      console.warn = (msg: string) => warnings.push(msg);
      process.env.NODE_ENV = "development";

      try {
        const transform = plugin.transform as Function;
        transform('import React from "react"', "test.tsx");

        assert.isFalse(warnings.some((w) => w.includes("React import")));
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("should not warn in production mode", () => {
      const plugin = effectUI();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV ?? "test";
      console.warn = (msg: string) => warnings.push(msg);
      process.env.NODE_ENV = "production";

      try {
        const transform = plugin.transform as Function;
        transform('import React from "react"', "test.tsx");

        assert.isFalse(warnings.some((w) => w.includes("React import")));
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: scanRoutes function
  // ─────────────────────────────────────────────────────────────────────────────
  describe("scanRoutes", () => {
    it("should return empty array for empty directory", () => {
      const { dir, cleanup } = createTempRoutes({});

      try {
        const routes = scanRoutes(dir);
        assert.deepStrictEqual(routes, []);
      } finally {
        cleanup();
      }
    });

    it("should return empty array for non-existent directory", () => {
      const routes = scanRoutes("/non/existent/path");
      assert.deepStrictEqual(routes, []);
    });

    it("should map index.tsx to parent path", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "export default () => <div>Home</div>",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        assert.strictEqual(routes[0]?.routePath, "/");
        assert.isTrue(routes[0]?.isIndex);
      } finally {
        cleanup();
      }
    });

    it("should map named file to /filename path", () => {
      const { dir, cleanup } = createTempRoutes({
        "about.tsx": "export default () => <div>About</div>",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        assert.strictEqual(routes[0]?.routePath, "/about");
      } finally {
        cleanup();
      }
    });

    it("should handle nested directory structure", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
        "users/index.tsx": "",
        "users/profile.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        const paths = routes.map((r) => r.routePath).sort();
        assert.deepStrictEqual(paths, ["/", "/users", "/users/profile"]);
      } finally {
        cleanup();
      }
    });

    it("should convert [param] directory to :param", () => {
      const { dir, cleanup } = createTempRoutes({
        "users/[id]/index.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes[0]?.routePath, "/users/:id");
      } finally {
        cleanup();
      }
    });

    it("should convert [param] file to :param", () => {
      const { dir, cleanup } = createTempRoutes({
        "users/[id].tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes[0]?.routePath, "/users/:id");
      } finally {
        cleanup();
      }
    });

    it("should convert [...rest] to * wildcard", () => {
      const { dir, cleanup } = createTempRoutes({
        "files/[...path].tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes[0]?.routePath, "/files/*");
      } finally {
        cleanup();
      }
    });

    it("should identify _layout files", () => {
      const { dir, cleanup } = createTempRoutes({
        "_layout.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        assert.isTrue(routes[0]?.isLayout);
        assert.strictEqual(routes[0]?.routePath, "/");
      } finally {
        cleanup();
      }
    });

    it("should identify _loading files", () => {
      const { dir, cleanup } = createTempRoutes({
        "_loading.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        assert.isTrue(routes[0]?.isLoading);
      } finally {
        cleanup();
      }
    });

    it("should identify _error files", () => {
      const { dir, cleanup } = createTempRoutes({
        "_error.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        assert.isTrue(routes[0]?.isError);
      } finally {
        cleanup();
      }
    });

    it("should ignore unknown underscore-prefixed files", () => {
      const { dir, cleanup } = createTempRoutes({
        "_helper.ts": "",
        "_utils.tsx": "",
        "index.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes.length, 1);
        assert.strictEqual(routes[0]?.routePath, "/");
      } finally {
        cleanup();
      }
    });

    it("should only process TypeScript and JavaScript files", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
        "page.ts": "",
        "component.jsx": "",
        "util.js": "",
        "style.css": "",
        "data.json": "",
        "readme.md": "",
      });

      try {
        const routes = scanRoutes(dir);
        // Should only have .tsx, .ts, .jsx, .js files
        assert.strictEqual(routes.length, 4);
      } finally {
        cleanup();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: RouteFile interface
  // ─────────────────────────────────────────────────────────────────────────────
  describe("RouteFile", () => {
    it("should have absolute filePath", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        assert.isTrue(path.isAbsolute(routes[0]?.filePath ?? ""));
      } finally {
        cleanup();
      }
    });

    it("should have routePath pattern", () => {
      const { dir, cleanup } = createTempRoutes({
        "users/[id].tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        assert.strictEqual(routes[0]?.routePath, "/users/:id");
      } finally {
        cleanup();
      }
    });

    it("should have isLayout flag", () => {
      const { dir, cleanup } = createTempRoutes({
        "_layout.tsx": "",
        "index.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        const layout = routes.find((r) => r.isLayout);
        const index = routes.find((r) => r.isIndex);

        assert.isTrue(layout?.isLayout);
        assert.isFalse(index?.isLayout);
      } finally {
        cleanup();
      }
    });

    it("should have isIndex flag", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
        "about.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        const index = routes.find((r) => r.routePath === "/");
        const about = routes.find((r) => r.routePath === "/about");

        assert.isTrue(index?.isIndex);
        assert.isFalse(about?.isIndex);
      } finally {
        cleanup();
      }
    });

    it("should have isLoading flag", () => {
      const { dir, cleanup } = createTempRoutes({
        "_loading.tsx": "",
        "index.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        const loading = routes.find((r) => r.isLoading);
        const index = routes.find((r) => r.isIndex);

        assert.isTrue(loading?.isLoading);
        assert.isFalse(index?.isLoading);
      } finally {
        cleanup();
      }
    });

    it("should have isError flag", () => {
      const { dir, cleanup } = createTempRoutes({
        "_error.tsx": "",
        "index.tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        const error = routes.find((r) => r.isError);
        const index = routes.find((r) => r.isIndex);

        assert.isTrue(error?.isError);
        assert.isFalse(index?.isError);
      } finally {
        cleanup();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: generateRoutesModule function
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateRoutesModule", () => {
    it("should generate valid JavaScript module", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      assert.include(code, "export const routes");
      assert.include(code, "export default routes");
    });

    it("should export routes array", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      assert.include(code, "export const routes = [");
    });

    it("should have default export", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      assert.include(code, "export default routes");
    });

    it("should include path property in routes", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/users.tsx",
          routePath: "/users",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      assert.include(code, 'path: "/users"');
    });

    it("should include lazy component loader", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      assert.include(code, "component: () => import(");
    });

    it("should include guard loader", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      assert.include(code, "guard: () => import(");
    });

    it("should include layout loader when layout exists", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/_layout.tsx",
          routePath: "/",
          isLayout: true,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      assert.include(code, "layout: () => import(");
    });

    it("should include loadingComponent when _loading exists", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/_loading.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: false,
          isLoading: true,
          isError: false,
        },
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      assert.include(code, "loadingComponent: () => import(");
    });

    it("should include errorComponent when _error exists", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/_error.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: true,
        },
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      assert.include(code, "errorComponent: () => import(");
    });

    it("should sort routes by specificity", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/[id].tsx",
          routePath: "/:id",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/users.tsx",
          routePath: "/users",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      // /users should come before /:id (more specific)
      const usersIndex = code.indexOf('"/users"');
      const idIndex = code.indexOf('"/:id"');
      assert.isBelow(usersIndex, idIndex);
    });

    it("should generate correct import paths", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/users/index.tsx",
          routePath: "/users",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      // Import path should be relative
      assert.include(code, 'import("./');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: scoreRoutePath function
  // ─────────────────────────────────────────────────────────────────────────────
  describe("scoreRoutePath", () => {
    it("should score static segments as 3", () => {
      const score = scoreRoutePath("/users");

      // 1 segment * 3 + length bonus
      assert.isAbove(score, 3);
    });

    it("should score dynamic segments as 2", () => {
      const staticScore = scoreRoutePath("/users");
      const dynamicScore = scoreRoutePath("/:id");

      assert.isAbove(staticScore, dynamicScore);
    });

    it("should score wildcard as 1", () => {
      const dynamicScore = scoreRoutePath("/:id");
      const wildcardScore = scoreRoutePath("/*");

      assert.isAbove(dynamicScore, wildcardScore);
    });

    it("should score longer paths higher", () => {
      const shortScore = scoreRoutePath("/a");
      const longScore = scoreRoutePath("/a/b");

      assert.isAbove(longScore, shortScore);
    });

    it("should handle mixed static and dynamic segments", () => {
      const score1 = scoreRoutePath("/users/:id");
      const score2 = scoreRoutePath("/users/:id/posts");

      // /users/:id/posts is longer, so higher score
      assert.isAbove(score2, score1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: extractParamNames function
  // ─────────────────────────────────────────────────────────────────────────────
  describe("extractParamNames", () => {
    it("should return empty array for static routes", () => {
      const params = extractParamNames("/users");

      assert.deepStrictEqual(params, []);
    });

    it("should extract single param name", () => {
      const params = extractParamNames("/users/:id");

      assert.deepStrictEqual(params, ["id"]);
    });

    it("should extract multiple param names", () => {
      const params = extractParamNames("/org/:orgId/user/:userId");

      assert.deepStrictEqual(params, ["orgId", "userId"]);
    });

    it("should extract params from mixed static/dynamic path", () => {
      const params = extractParamNames("/users/:id/posts/:postId/comments");

      assert.deepStrictEqual(params, ["id", "postId"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: generateParamType function
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateParamType", () => {
    it("should return empty object type for no params", () => {
      const type = generateParamType("/users");

      assert.strictEqual(type, "{}");
    });

    it("should generate type for single param", () => {
      const type = generateParamType("/users/:id");

      assert.include(type, "readonly id: string");
    });

    it("should generate type for multiple params", () => {
      const type = generateParamType("/org/:orgId/user/:userId");

      assert.include(type, "readonly orgId: string");
      assert.include(type, "readonly userId: string");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: generateRouteTypes function
  // ─────────────────────────────────────────────────────────────────────────────
  describe("generateRouteTypes", () => {
    it("should generate valid TypeScript declaration", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const types = generateRouteTypes(routes);

      assert.include(types, "declare module");
    });

    it("should augment RouteMap interface", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const types = generateRouteTypes(routes);

      assert.include(types, 'declare module "effect-ui/router"');
      assert.include(types, "interface RouteMap");
    });

    it("should include all page routes", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/users.tsx",
          routePath: "/users",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/about.tsx",
          routePath: "/about",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
      ];

      const types = generateRouteTypes(routes);

      assert.include(types, '"/": {}');
      assert.include(types, '"/users": {}');
      assert.include(types, '"/about": {}');
    });

    it("should exclude special files from RouteMap", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/_layout.tsx",
          routePath: "/",
          isLayout: true,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/_loading.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: false,
          isLoading: true,
          isError: false,
        },
        {
          filePath: "/routes/_error.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: true,
        },
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const types = generateRouteTypes(routes);

      // Should only have one entry for "/" (the index route)
      const matches = types.match(/readonly "\/": /g);
      assert.strictEqual(matches?.length, 1);
    });

    it("should generate correct param types for each route", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/users/[id].tsx",
          routePath: "/users/:id",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
      ];

      const types = generateRouteTypes(routes);

      assert.include(types, '"/users/:id": { readonly id: string }');
    });

    it("should include auto-generated comment", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const types = generateRouteTypes(routes);

      assert.include(types, "Auto-generated");
      assert.include(types, "DO NOT EDIT");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: resolveId hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("resolveId hook", () => {
    it("should resolve virtual routes module ID", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
      });

      try {
        const plugin = effectUI({ routes: dir });
        // Call configResolved to set up resolvedRoutesDir
        (plugin.configResolved as Function)({
          root: path.dirname(dir),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        const resolved = (plugin.resolveId as Function)("virtual:effect-ui-routes");

        assert.isNotNull(resolved);
        assert.include(resolved, "virtual:effect-ui-routes");
      } finally {
        cleanup();
      }
    });

    it("should throw error when routes not configured", () => {
      const plugin = effectUI();

      let error: Error | null = null;
      try {
        (plugin.resolveId as Function)("virtual:effect-ui-routes");
      } catch (e) {
        error = e as Error;
      }

      assert.isNotNull(error);
      assert.include(error?.message, "routes option not configured");
    });

    it("should let Vite resolve jsx-runtime", () => {
      const plugin = effectUI();
      const resolved = (plugin.resolveId as Function)("effect-ui/jsx-runtime");

      assert.isNull(resolved);
    });

    it("should let Vite resolve jsx-dev-runtime", () => {
      const plugin = effectUI();
      const resolved = (plugin.resolveId as Function)("effect-ui/jsx-dev-runtime");

      assert.isNull(resolved);
    });

    it("should return null for other modules", () => {
      const plugin = effectUI();
      const resolved = (plugin.resolveId as Function)("some-other-module");

      assert.isNull(resolved);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: load hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("load hook", () => {
    it("should load virtual routes module", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
        "about.tsx": "",
      });

      try {
        const plugin = effectUI({ routes: dir });
        // Call configResolved to set up resolvedRoutesDir
        (plugin.configResolved as Function)({
          root: path.dirname(dir),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        const code = (plugin.load as Function)("\0virtual:effect-ui-routes");

        assert.isString(code);
        assert.include(code, "export const routes");
      } finally {
        cleanup();
      }
    });

    it("should return null for other modules", () => {
      const plugin = effectUI();
      const result = (plugin.load as Function)("some-other-module");

      assert.isNull(result);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: configureServer hook
  // ─────────────────────────────────────────────────────────────────────────────
  describe("configureServer hook", () => {
    it("should watch routes directory", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
      });

      try {
        const plugin = effectUI({ routes: dir });
        (plugin.configResolved as Function)({
          root: path.dirname(dir),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        const watchedPaths: string[] = [];
        const mockServer = {
          watcher: {
            add: (p: string) => watchedPaths.push(p),
            on: () => {},
          },
          moduleGraph: {
            getModuleById: () => null,
          },
          ws: {
            send: () => {},
          },
        };

        (plugin.configureServer as Function)(mockServer);

        assert.isTrue(watchedPaths.includes(dir));
      } finally {
        cleanup();
      }
    });

    it("should regenerate routes when file added", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
      });

      try {
        const plugin = effectUI({ routes: dir, silent: true });
        (plugin.configResolved as Function)({
          root: path.dirname(dir),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        const callbacks: { add?: (file: string) => void } = {};
        const mockServer = {
          watcher: {
            add: () => {},
            on: (event: string, cb: (file: string) => void) => {
              if (event === "add") callbacks.add = cb;
            },
          },
          moduleGraph: {
            getModuleById: () => null,
          },
          ws: {
            send: () => {},
          },
        };

        (plugin.configureServer as Function)(mockServer);

        // Simulate file add
        if (callbacks.add !== undefined) {
          const newFile = path.join(dir, "new.tsx");
          fs.writeFileSync(newFile, "");
          callbacks.add(newFile);
        }

        // Just verify it doesn't throw
        assert.isDefined(callbacks.add);
      } finally {
        cleanup();
      }
    });

    it("should regenerate routes when file removed", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
        "about.tsx": "",
      });

      try {
        const plugin = effectUI({ routes: dir, silent: true });
        (plugin.configResolved as Function)({
          root: path.dirname(dir),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        const callbacks: { unlink?: (file: string) => void } = {};
        const mockServer = {
          watcher: {
            add: () => {},
            on: (event: string, cb: (file: string) => void) => {
              if (event === "unlink") callbacks.unlink = cb;
            },
          },
          moduleGraph: {
            getModuleById: () => null,
          },
          ws: {
            send: () => {},
          },
        };

        (plugin.configureServer as Function)(mockServer);

        // Simulate file removal
        if (callbacks.unlink !== undefined) {
          const fileToRemove = path.join(dir, "about.tsx");
          fs.unlinkSync(fileToRemove);
          callbacks.unlink(fileToRemove);
        }

        assert.isDefined(callbacks.unlink);
      } finally {
        cleanup();
      }
    });

    it("should invalidate module graph on change", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
      });

      try {
        const plugin = effectUI({ routes: dir, silent: true });
        (plugin.configResolved as Function)({
          root: path.dirname(dir),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        let invalidateCalled = false;
        let reloadSent = false;
        const callbacks: { add?: (file: string) => void } = {};

        const mockModule = { id: "\0virtual:effect-ui-routes" };
        const mockServer = {
          watcher: {
            add: () => {},
            on: (event: string, cb: (file: string) => void) => {
              if (event === "add") callbacks.add = cb;
            },
          },
          moduleGraph: {
            getModuleById: () => mockModule,
            invalidateModule: () => {
              invalidateCalled = true;
            },
          },
          ws: {
            send: (msg: { type: string }) => {
              if (msg.type === "full-reload") reloadSent = true;
            },
          },
        };

        (plugin.configureServer as Function)(mockServer);

        // Simulate file add
        if (callbacks.add !== undefined) {
          const newFile = path.join(dir, "new.tsx");
          fs.writeFileSync(newFile, "");
          callbacks.add(newFile);
        }

        assert.isTrue(invalidateCalled);
        assert.isTrue(reloadSent);
      } finally {
        cleanup();
      }
    });

    it("should only watch TypeScript and JavaScript files", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
      });

      try {
        const plugin = effectUI({ routes: dir, silent: true });
        (plugin.configResolved as Function)({
          root: path.dirname(dir),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        let invalidateCalled = false;
        const callbacks: { add?: (file: string) => void } = {};

        const mockServer = {
          watcher: {
            add: () => {},
            on: (event: string, cb: (file: string) => void) => {
              if (event === "add") callbacks.add = cb;
            },
          },
          moduleGraph: {
            getModuleById: () => ({ id: "test" }),
            invalidateModule: () => {
              invalidateCalled = true;
            },
          },
          ws: {
            send: () => {},
          },
        };

        (plugin.configureServer as Function)(mockServer);

        // CSS file should be ignored
        if (callbacks.add !== undefined) {
          callbacks.add(path.join(dir, "style.css"));
        }

        assert.isFalse(invalidateCalled);
      } finally {
        cleanup();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Logging utilities
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Logging", () => {
    it("should format warnings with effect-ui prefix", () => {
      const plugin = effectUI();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warnings.push(msg);

      try {
        (plugin.configResolved as Function)({
          root: process.cwd(),
          plugins: [{ name: "vite:react" }],
          esbuild: {},
          command: "serve",
        });

        assert.isTrue(warnings.some((w) => w.includes("[effect-ui]")));
      } finally {
        console.warn = originalWarn;
      }
    });

    it("should format info messages with effect-ui prefix", () => {
      const plugin = effectUI();
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      try {
        (plugin.configResolved as Function)({
          root: process.cwd(),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        assert.isTrue(logs.some((l) => l.includes("[effect-ui]")));
      } finally {
        console.log = originalLog;
      }
    });

    it("should use ANSI color codes", () => {
      const plugin = effectUI();
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      try {
        (plugin.configResolved as Function)({
          root: process.cwd(),
          plugins: [],
          esbuild: {},
          command: "serve",
        });

        // ANSI codes start with \x1b[
        assert.isTrue(logs.some((l) => l.includes("\x1b[")));
      } finally {
        console.log = originalLog;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Default export
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Default export", () => {
    it("should export effectUI as default", async () => {
      const module = await import("../src/vite-plugin.js");

      assert.strictEqual(module.default, effectUI);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope: Integration scenarios
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Integration", () => {
    it("should handle complex route directory structure", () => {
      const { dir, cleanup } = createTempRoutes({
        "index.tsx": "",
        "about.tsx": "",
        "_layout.tsx": "",
        "users/index.tsx": "",
        "users/[id].tsx": "",
        "users/[id]/settings.tsx": "",
        "admin/_layout.tsx": "",
        "admin/index.tsx": "",
        "admin/dashboard.tsx": "",
        "files/[...path].tsx": "",
      });

      try {
        const routes = scanRoutes(dir);
        const paths = routes.map((r) => r.routePath).sort();

        assert.isTrue(paths.includes("/"));
        assert.isTrue(paths.includes("/about"));
        assert.isTrue(paths.includes("/users"));
        assert.isTrue(paths.includes("/users/:id"));
        assert.isTrue(paths.includes("/users/:id/settings"));
        assert.isTrue(paths.includes("/admin"));
        assert.isTrue(paths.includes("/admin/dashboard"));
        assert.isTrue(paths.includes("/files/*"));
      } finally {
        cleanup();
      }
    });

    it("should match layouts to nested routes", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/_layout.tsx",
          routePath: "/",
          isLayout: true,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/users/index.tsx",
          routePath: "/users",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/users/[id].tsx",
          routePath: "/users/:id",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      // All routes should have the root layout
      const layoutMatches = code.match(/layout: \(\) => import\(/g);
      assert.strictEqual(layoutMatches?.length, 3); // 3 page routes
    });

    it("should match error boundaries to nested routes", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/_error.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: false,
          isLoading: false,
          isError: true,
        },
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/users/index.tsx",
          routePath: "/users",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      // All routes should have the root error boundary
      const errorMatches = code.match(/errorComponent: \(\) => import\(/g);
      assert.strictEqual(errorMatches?.length, 2); // 2 page routes
    });

    it("should match loading states to nested routes", () => {
      const routes: RouteFile[] = [
        {
          filePath: "/routes/_loading.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: false,
          isLoading: true,
          isError: false,
        },
        {
          filePath: "/routes/index.tsx",
          routePath: "/",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
        {
          filePath: "/routes/users/index.tsx",
          routePath: "/users",
          isLayout: false,
          isIndex: true,
          isLoading: false,
          isError: false,
        },
      ];

      const code = generateRoutesModule(routes, "/routes");

      // All routes should have the root loading component
      const loadingMatches = code.match(/loadingComponent: \(\) => import\(/g);
      assert.strictEqual(loadingMatches?.length, 2); // 2 page routes
    });
  });
});
