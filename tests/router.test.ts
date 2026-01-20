/**
 * Router tests - route matching, param extraction, navigation
 */
import { describe, it, expect } from "@effect/vitest"
import { Option } from "effect"
import { createMatcher, parsePath, buildPath } from "../src/router/matching"
import { buildPathWithParams } from "../src/router/types"
import type { ExtractRouteParams } from "../src/router/types"

describe("Route matching", () => {
  describe("parsePath", () => {
    it("parses path without query", () => {
      const result = parsePath("/users")
      expect(result.path).toBe("/users")
      expect(result.query.toString()).toBe("")
    })

    it("parses path with query", () => {
      const result = parsePath("/search?q=effect&page=1")
      expect(result.path).toBe("/search")
      expect(result.query.get("q")).toBe("effect")
      expect(result.query.get("page")).toBe("1")
    })

    it("handles root path", () => {
      const result = parsePath("/")
      expect(result.path).toBe("/")
    })

    it("handles empty path", () => {
      const result = parsePath("")
      expect(result.path).toBe("")
    })
  })

  describe("buildPath", () => {
    it("builds path without query", () => {
      expect(buildPath("/users")).toBe("/users")
    })

    it("builds path with query", () => {
      expect(buildPath("/search", { q: "effect", page: "1" })).toBe(
        "/search?q=effect&page=1"
      )
    })

    it("handles empty query object", () => {
      expect(buildPath("/users", {})).toBe("/users")
    })
  })

  describe("createMatcher", () => {
    it("matches static routes", () => {
      const matcher = createMatcher([
        { path: "/about", component: async () => ({ default: {} as any }) }
      ])
      
      const matchOpt = matcher.match("/about")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({})
      }
    })

    it("matches dynamic :param routes", () => {
      const matcher = createMatcher([
        { path: "/users/:id", component: async () => ({ default: {} as any }) }
      ])
      
      const matchOpt = matcher.match("/users/123")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({ id: "123" })
      }
    })

    it("matches [param] file-based syntax", () => {
      const matcher = createMatcher([
        { path: "/posts/[postId]", component: async () => ({ default: {} as any }) }
      ])
      
      const matchOpt = matcher.match("/posts/456")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({ postId: "456" })
      }
    })

    it("matches multiple params", () => {
      const matcher = createMatcher([
        { path: "/posts/:postId/comments/:commentId", component: async () => ({ default: {} as any }) }
      ])
      
      const matchOpt = matcher.match("/posts/1/comments/2")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({ postId: "1", commentId: "2" })
      }
    })

    it("matches wildcard * routes", () => {
      const matcher = createMatcher([
        { path: "/files/*", component: async () => ({ default: {} as any }) }
      ])
      
      const matchOpt = matcher.match("/files/docs/api/router")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({ "*": "docs/api/router" })
      }
    })

    it("matches [...rest] catch-all syntax", () => {
      const matcher = createMatcher([
        { path: "/files/[...path]", component: async () => ({ default: {} as any }) }
      ])
      
      const matchOpt = matcher.match("/files/docs/api/router")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({ path: "docs/api/router" })
      }
    })

    it("returns Option.none() for non-matching paths", () => {
      const matcher = createMatcher([
        { path: "/users", component: async () => ({ default: {} as any }) }
      ])
      
      expect(Option.isNone(matcher.match("/posts"))).toBe(true)
      expect(Option.isNone(matcher.match("/users/extra"))).toBe(true)
    })

    it("prioritizes more specific routes", () => {
      const matcher = createMatcher([
        { path: "/users/:id", component: async () => ({ default: {} as any }) },
        { path: "/users/me", component: async () => ({ default: {} as any }) }
      ])
      
      // /users/me should match the static route, not the dynamic one
      const matchOpt = matcher.match("/users/me")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.route.path).toBe("/users/me")
        expect(matchOpt.value.params).toEqual({})
      }
    })

    it("strips query string before matching", () => {
      const matcher = createMatcher([
        { path: "/search", component: async () => ({ default: {} as any }) }
      ])
      
      const matchOpt = matcher.match("/search?q=effect")
      expect(Option.isSome(matchOpt)).toBe(true)
    })
  })
})

describe("Nested route matching", () => {
  const mockComponent = async () => ({ default: {} as any })
  const mockLayout = async () => ({ default: {} as any })
  const mockError = async () => ({ default: {} as any })

  describe("parent chain population", () => {
    it("flat routes have empty parents array", () => {
      const matcher = createMatcher([
        { path: "/users", component: mockComponent }
      ])
      
      const matchOpt = matcher.match("/users")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.parents).toEqual([])
      }
    })

    it("nested route has parent in parents array", () => {
      const matcher = createMatcher([
        { 
          path: "/parent",
          component: mockComponent,
          layout: mockLayout,
          children: [
            { path: "/parent/child", component: mockComponent }
          ]
        }
      ])
      
      const matchOpt = matcher.match("/parent/child")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.parents.length).toBe(1)
        expect(matchOpt.value.parents[0]?.route.path).toBe("/parent")
      }
    })

    it("deeply nested routes have full parent chain (root first)", () => {
      const matcher = createMatcher([
        { 
          path: "/a",
          component: mockComponent,
          layout: mockLayout,
          children: [
            { 
              path: "/a/b",
              component: mockComponent,
              layout: mockLayout,
              children: [
                { path: "/a/b/c", component: mockComponent }
              ]
            }
          ]
        }
      ])
      
      const matchOpt = matcher.match("/a/b/c")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.parents.length).toBe(2)
        expect(matchOpt.value.parents[0]?.route.path).toBe("/a")
        expect(matchOpt.value.parents[1]?.route.path).toBe("/a/b")
        expect(matchOpt.value.route.path).toBe("/a/b/c")
      }
    })
  })

  describe("params propagation across stack", () => {
    it("child route gets its own params", () => {
      const matcher = createMatcher([
        { 
          path: "/users",
          component: mockComponent,
          children: [
            { path: "/users/:id", component: mockComponent }
          ]
        }
      ])
      
      const matchOpt = matcher.match("/users/42")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({ id: "42" })
      }
    })

    it("nested params are captured at each level", () => {
      const matcher = createMatcher([
        { 
          path: "/orgs/:orgId",
          component: mockComponent,
          children: [
            { 
              path: "/orgs/:orgId/projects/:projectId",
              component: mockComponent,
              children: [
                { path: "/orgs/:orgId/projects/:projectId/tasks/:taskId", component: mockComponent }
              ]
            }
          ]
        }
      ])
      
      const matchOpt = matcher.match("/orgs/acme/projects/123/tasks/456")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({ orgId: "acme", projectId: "123", taskId: "456" })
        // Parent routes also capture their params
        expect(matchOpt.value.parents[0]?.params).toEqual({ orgId: "acme" })
        expect(matchOpt.value.parents[1]?.params).toEqual({ orgId: "acme", projectId: "123" })
      }
    })
  })

  describe("layout/error inheritance tracking", () => {
    it("parent layout is accessible in parent chain", () => {
      const parentLayout = mockLayout
      const matcher = createMatcher([
        { 
          path: "/settings",
          component: mockComponent,
          layout: parentLayout,
          children: [
            { path: "/settings/profile", component: mockComponent }
          ]
        }
      ])
      
      const matchOpt = matcher.match("/settings/profile")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.parents[0]?.route.layout).toBe(parentLayout)
      }
    })

    it("parent error boundary is accessible in parent chain", () => {
      const parentError = mockError
      const matcher = createMatcher([
        { 
          path: "/admin",
          component: mockComponent,
          errorComponent: parentError,
          children: [
            { path: "/admin/users", component: mockComponent }
          ]
        }
      ])
      
      const matchOpt = matcher.match("/admin/users")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.parents[0]?.route.errorComponent).toBe(parentError)
      }
    })

    it("child error overrides parent (nearest wins)", () => {
      const parentError = mockError
      const childError = async () => ({ default: {} as any })
      
      const matcher = createMatcher([
        { 
          path: "/dashboard",
          component: mockComponent,
          errorComponent: parentError,
          children: [
            { 
              path: "/dashboard/reports", 
              component: mockComponent,
              errorComponent: childError
            }
          ]
        }
      ])
      
      const matchOpt = matcher.match("/dashboard/reports")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        // Child has its own error component
        expect(matchOpt.value.route.errorComponent).toBe(childError)
        // Parent also has its error component (for fallback)
        expect(matchOpt.value.parents[0]?.route.errorComponent).toBe(parentError)
      }
    })
  })

  describe("specificity ordering", () => {
    it("deeper nested routes take priority over shallow routes", () => {
      const matcher = createMatcher([
        { path: "/users", component: mockComponent },
        { 
          path: "/users",
          component: mockComponent,
          children: [
            { path: "/users/:id", component: mockComponent }
          ]
        }
      ])
      
      const matchOpt = matcher.match("/users/123")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({ id: "123" })
      }
    })

    it("static child routes beat dynamic parent routes", () => {
      const staticComponent = mockComponent
      const dynamicComponent = async () => ({ default: {} as any })
      
      const matcher = createMatcher([
        { 
          path: "/items",
          component: mockComponent,
          children: [
            { path: "/items/special", component: staticComponent },
            { path: "/items/:id", component: dynamicComponent }
          ]
        }
      ])
      
      const specialMatchOpt = matcher.match("/items/special")
      expect(Option.isSome(specialMatchOpt)).toBe(true)
      if (Option.isSome(specialMatchOpt)) {
        expect(specialMatchOpt.value.route.path).toBe("/items/special")
      }
      
      const dynamicMatchOpt = matcher.match("/items/123")
      expect(Option.isSome(dynamicMatchOpt)).toBe(true)
      if (Option.isSome(dynamicMatchOpt)) {
        expect(dynamicMatchOpt.value.route.path).toBe("/items/:id")
        expect(dynamicMatchOpt.value.params).toEqual({ id: "123" })
      }
    })
  })
})

describe("Type-safe routing", () => {
  describe("buildPathWithParams", () => {
    it("builds path with single param", () => {
      const result = buildPathWithParams("/users/:id", { id: "123" })
      expect(result).toBe("/users/123")
    })

    it("builds path with multiple params", () => {
      const result = buildPathWithParams(
        "/posts/:postId/comments/:commentId",
        { postId: "1", commentId: "2" }
      )
      expect(result).toBe("/posts/1/comments/2")
    })

    it("handles path without params", () => {
      const result = buildPathWithParams("/about", {})
      expect(result).toBe("/about")
    })
  })

  describe("ExtractRouteParams type", () => {
    it("extracts single param", () => {
      type Params = ExtractRouteParams<"/users/:id">
      // Type-level test: this should compile
      const params: Params = { id: "123" }
      expect(params.id).toBe("123")
    })

    it("extracts multiple params", () => {
      type Params = ExtractRouteParams<"/posts/:postId/comments/:commentId">
      // Type-level test: this should compile
      const params: Params = { postId: "1", commentId: "2" }
      expect(params.postId).toBe("1")
      expect(params.commentId).toBe("2")
    })

    it("returns empty object for static paths", () => {
      type Params = ExtractRouteParams<"/about">
      // Type-level test: this should be {}
      const params: Params = {}
      expect(Object.keys(params)).toHaveLength(0)
    })
  })
})
