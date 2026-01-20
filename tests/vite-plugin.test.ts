/**
 * F-027: Vite plugin route scanning tests
 * Tests route scanning and routes.d.ts generation/regeneration
 */
import { describe, it, expect, beforeEach, afterEach } from "@effect/vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  scanRoutes,
  generateRouteTypes,
  generateRoutesModule,
  scoreRoutePath,
  extractParamNames,
  generateParamType
} from "../src/vite-plugin"

// Create a temp directory for test routes
let tempDir: string

const createTempDir = (): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), "effect-ui-vite-test-"))
}

const removeTempDir = (dir: string): void => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const createRouteFile = (routesDir: string, relativePath: string, content = "export default {}") => {
  const fullPath = path.join(routesDir, relativePath)
  const dir = path.dirname(fullPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(fullPath, content)
}

describe("Vite plugin route scanning (F-027)", () => {
  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    removeTempDir(tempDir)
  })

  describe("Initial route scan output", () => {
    it("routes in filesystem are discovered", () => {
      // Create test routes
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "about.tsx")
      createRouteFile(tempDir, "users/index.tsx")
      createRouteFile(tempDir, "users/[id].tsx")

      const routes = scanRoutes(tempDir)

      // Should find all route files
      expect(routes.length).toBe(4)
      
      // Extract just the route paths for easier assertion
      const routePaths = routes.map(r => r.routePath).sort()
      expect(routePaths).toContain("/")
      expect(routePaths).toContain("/about")
      expect(routePaths).toContain("/users")
      expect(routePaths).toContain("/users/:id")
    })

    it("routes.d.ts generated with expected entries", () => {
      // Create test routes
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "users/[id].tsx")
      createRouteFile(tempDir, "posts/[postId]/comments/[commentId].tsx")

      const routes = scanRoutes(tempDir)
      const typesContent = generateRouteTypes(routes)

      // Should contain interface declaration
      expect(typesContent).toContain("declare module \"effect-ui/router\"")
      expect(typesContent).toContain("interface RouteMap")
      
      // Should contain route entries with correct types
      expect(typesContent).toContain('readonly "/": {}')
      expect(typesContent).toContain('readonly "/users/:id": { readonly id: string }')
      expect(typesContent).toContain('readonly "/posts/:postId/comments/:commentId": { readonly postId: string; readonly commentId: string }')
    })

    it("no extra routes included", () => {
      // Create routes and some non-route files
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "_utils.tsx")  // Should be skipped (underscore prefix)
      createRouteFile(tempDir, "_layout.tsx") // Layout file, tracked but not a page route
      fs.writeFileSync(path.join(tempDir, "styles.css"), "body {}")  // Non-route file
      fs.writeFileSync(path.join(tempDir, "data.json"), "{}")  // Non-route file

      const routes = scanRoutes(tempDir)
      const pageRoutes = routes.filter(r => !r.isLayout && !r.isLoading && !r.isError)

      // Only index should be a page route
      expect(pageRoutes.length).toBe(1)
      expect(pageRoutes[0]?.routePath).toBe("/")
    })

    it("special files (_layout, _loading, _error) are tracked separately", () => {
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "_layout.tsx")
      createRouteFile(tempDir, "_loading.tsx")
      createRouteFile(tempDir, "_error.tsx")
      createRouteFile(tempDir, "settings/index.tsx")
      createRouteFile(tempDir, "settings/_layout.tsx")

      const routes = scanRoutes(tempDir)

      const layouts = routes.filter(r => r.isLayout)
      const loadings = routes.filter(r => r.isLoading)
      const errors = routes.filter(r => r.isError)
      const pages = routes.filter(r => !r.isLayout && !r.isLoading && !r.isError)

      expect(layouts.length).toBe(2)
      expect(loadings.length).toBe(1)
      expect(errors.length).toBe(1)
      expect(pages.length).toBe(2) // index and settings/index
    })

    it("nested routes are correctly discovered", () => {
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "settings/index.tsx")
      createRouteFile(tempDir, "settings/profile.tsx")
      createRouteFile(tempDir, "settings/security/index.tsx")
      createRouteFile(tempDir, "settings/security/two-factor.tsx")

      const routes = scanRoutes(tempDir)
      const routePaths = routes.map(r => r.routePath).sort()

      expect(routePaths).toContain("/")
      expect(routePaths).toContain("/settings")
      expect(routePaths).toContain("/settings/profile")
      expect(routePaths).toContain("/settings/security")
      expect(routePaths).toContain("/settings/security/two-factor")
    })
  })

  describe("Regeneration on route changes", () => {
    it("add route file -> routes.d.ts updates", () => {
      // Initial state
      createRouteFile(tempDir, "index.tsx")
      
      let routes = scanRoutes(tempDir)
      let types = generateRouteTypes(routes)
      expect(types).toContain('readonly "/": {}')
      expect(types).not.toContain("/about")

      // Add new route
      createRouteFile(tempDir, "about.tsx")
      
      routes = scanRoutes(tempDir)
      types = generateRouteTypes(routes)
      expect(types).toContain('readonly "/": {}')
      expect(types).toContain('readonly "/about": {}')
    })

    it("remove route file -> routes.d.ts updates", () => {
      // Initial state with multiple routes
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "about.tsx")
      createRouteFile(tempDir, "contact.tsx")
      
      let routes = scanRoutes(tempDir)
      let types = generateRouteTypes(routes)
      expect(types).toContain('readonly "/about": {}')

      // Remove a route
      fs.unlinkSync(path.join(tempDir, "about.tsx"))
      
      routes = scanRoutes(tempDir)
      types = generateRouteTypes(routes)
      expect(types).toContain('readonly "/": {}')
      expect(types).toContain('readonly "/contact": {}')
      expect(types).not.toContain('readonly "/about"')
    })

    it("rename route file -> routes.d.ts updates", () => {
      // Initial state
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "old-name.tsx")
      
      let routes = scanRoutes(tempDir)
      let types = generateRouteTypes(routes)
      expect(types).toContain('readonly "/old-name": {}')
      expect(types).not.toContain("/new-name")

      // Rename route (remove old, add new)
      fs.unlinkSync(path.join(tempDir, "old-name.tsx"))
      createRouteFile(tempDir, "new-name.tsx")
      
      routes = scanRoutes(tempDir)
      types = generateRouteTypes(routes)
      expect(types).toContain('readonly "/new-name": {}')
      expect(types).not.toContain("/old-name")
    })
  })

  describe("Route path conversion", () => {
    it("[param] bracket syntax converts to :param", () => {
      createRouteFile(tempDir, "users/[id].tsx")
      createRouteFile(tempDir, "posts/[postId]/comments/[commentId].tsx")

      const routes = scanRoutes(tempDir)
      const routePaths = routes.map(r => r.routePath)

      expect(routePaths).toContain("/users/:id")
      expect(routePaths).toContain("/posts/:postId/comments/:commentId")
    })

    it("[...rest] catch-all converts to *", () => {
      createRouteFile(tempDir, "docs/[...slug].tsx")

      const routes = scanRoutes(tempDir)
      const route = routes.find(r => r.routePath.includes("docs"))

      expect(route).toBeDefined()
      expect(route?.routePath).toBe("/docs/*")
    })

    it("index files map to parent path", () => {
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "settings/index.tsx")
      createRouteFile(tempDir, "users/profile/index.tsx")

      const routes = scanRoutes(tempDir)
      const indexRoutes = routes.filter(r => r.isIndex)

      expect(indexRoutes.length).toBe(3)
      expect(indexRoutes.map(r => r.routePath).sort()).toEqual([
        "/",
        "/settings",
        "/users/profile"
      ])
    })
  })

  describe("Param extraction", () => {
    it("extracts single param", () => {
      const params = extractParamNames("/users/:id")
      expect(params).toEqual(["id"])
    })

    it("extracts multiple params", () => {
      const params = extractParamNames("/orgs/:orgId/repos/:repoId/issues/:issueId")
      expect(params).toEqual(["orgId", "repoId", "issueId"])
    })

    it("returns empty array for static paths", () => {
      const params = extractParamNames("/about")
      expect(params).toEqual([])
    })

    it("handles root path", () => {
      const params = extractParamNames("/")
      expect(params).toEqual([])
    })
  })

  describe("Param type generation", () => {
    it("generates empty object for no params", () => {
      const type = generateParamType("/about")
      expect(type).toBe("{}")
    })

    it("generates single param type", () => {
      const type = generateParamType("/users/:id")
      expect(type).toBe("{ readonly id: string }")
    })

    it("generates multiple param types", () => {
      const type = generateParamType("/orgs/:orgId/repos/:repoId")
      expect(type).toBe("{ readonly orgId: string; readonly repoId: string }")
    })
  })

  describe("Route scoring", () => {
    it("static segments score higher than params", () => {
      const staticScore = scoreRoutePath("/users/me")
      const paramScore = scoreRoutePath("/users/:id")
      expect(staticScore).toBeGreaterThan(paramScore)
    })

    it("params score higher than wildcards", () => {
      const paramScore = scoreRoutePath("/files/:filename")
      const wildcardScore = scoreRoutePath("/files/*")
      expect(paramScore).toBeGreaterThan(wildcardScore)
    })

    it("longer paths score higher (same segment types)", () => {
      const shortScore = scoreRoutePath("/a")
      const longScore = scoreRoutePath("/a/b/c")
      expect(longScore).toBeGreaterThan(shortScore)
    })
  })

  describe("Route module generation", () => {
    it("generates valid module structure", () => {
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "about.tsx")

      const routes = scanRoutes(tempDir)
      const module = generateRoutesModule(routes, tempDir)

      expect(module).toContain("export const routes = [")
      expect(module).toContain("export default routes")
      expect(module).toContain('path: "/"')
      expect(module).toContain('path: "/about"')
    })

    it("includes layout imports when present", () => {
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "_layout.tsx")

      const routes = scanRoutes(tempDir)
      const module = generateRoutesModule(routes, tempDir)

      expect(module).toContain("layout: () => import")
      expect(module).toContain("_layout.tsx")
    })

    it("includes loading imports when present", () => {
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "_loading.tsx")

      const routes = scanRoutes(tempDir)
      const module = generateRoutesModule(routes, tempDir)

      expect(module).toContain("loadingComponent: () => import")
      expect(module).toContain("_loading.tsx")
    })

    it("includes error imports when present", () => {
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "_error.tsx")

      const routes = scanRoutes(tempDir)
      const module = generateRoutesModule(routes, tempDir)

      expect(module).toContain("errorComponent: () => import")
      expect(module).toContain("_error.tsx")
    })

    it("matches nearest special file for nested routes", () => {
      createRouteFile(tempDir, "index.tsx")
      createRouteFile(tempDir, "_layout.tsx")
      createRouteFile(tempDir, "settings/index.tsx")
      createRouteFile(tempDir, "settings/_layout.tsx")

      const routes = scanRoutes(tempDir)
      const module = generateRoutesModule(routes, tempDir)

      // Both routes should have layouts, but settings should use its own
      const lines = module.split("\n")
      
      // Find the settings route entry
      const settingsStart = lines.findIndex(l => l.includes('path: "/settings"'))
      expect(settingsStart).toBeGreaterThan(-1)
      
      // Settings layout should reference settings/_layout.tsx
      const settingsLayoutLine = lines.slice(settingsStart, settingsStart + 10)
        .find(l => l.includes("layout:"))
      expect(settingsLayoutLine).toContain("settings/_layout.tsx")
    })
  })

  describe("Edge cases", () => {
    it("handles empty routes directory", () => {
      const routes = scanRoutes(tempDir)
      expect(routes).toEqual([])
    })

    it("handles non-existent routes directory", () => {
      const routes = scanRoutes("/non/existent/path")
      expect(routes).toEqual([])
    })

    it("ignores non-route file extensions", () => {
      createRouteFile(tempDir, "index.tsx")
      fs.writeFileSync(path.join(tempDir, "styles.css"), "body {}")
      fs.writeFileSync(path.join(tempDir, "data.json"), "{}")
      fs.writeFileSync(path.join(tempDir, "README.md"), "# Readme")

      const routes = scanRoutes(tempDir)
      expect(routes.length).toBe(1)
      expect(routes[0]?.routePath).toBe("/")
    })

    it("handles deeply nested routes", () => {
      createRouteFile(tempDir, "a/b/c/d/e/f/deep.tsx")

      const routes = scanRoutes(tempDir)
      expect(routes.length).toBe(1)
      expect(routes[0]?.routePath).toBe("/a/b/c/d/e/f/deep")
    })

    it("handles mixed file extensions", () => {
      createRouteFile(tempDir, "page1.tsx")
      createRouteFile(tempDir, "page2.ts")
      createRouteFile(tempDir, "page3.jsx")
      createRouteFile(tempDir, "page4.js")

      const routes = scanRoutes(tempDir)
      expect(routes.length).toBe(4)
    })
  })
})
