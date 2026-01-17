/**
 * Router tests - route matching, param extraction, navigation
 */
import { describe, test, expect } from "vitest"
import { createMatcher, parsePath, buildPath } from "../src/router/matching"
import { buildPathWithParams } from "../src/router/types"
import type { ExtractRouteParams } from "../src/router/types"

describe("Route matching", () => {
  describe("parsePath", () => {
    test("parses path without query", () => {
      const result = parsePath("/users")
      expect(result.path).toBe("/users")
      expect(result.query.toString()).toBe("")
    })

    test("parses path with query", () => {
      const result = parsePath("/search?q=effect&page=1")
      expect(result.path).toBe("/search")
      expect(result.query.get("q")).toBe("effect")
      expect(result.query.get("page")).toBe("1")
    })

    test("handles root path", () => {
      const result = parsePath("/")
      expect(result.path).toBe("/")
    })

    test("handles empty path", () => {
      const result = parsePath("")
      expect(result.path).toBe("")
    })
  })

  describe("buildPath", () => {
    test("builds path without query", () => {
      expect(buildPath("/users")).toBe("/users")
    })

    test("builds path with query", () => {
      expect(buildPath("/search", { q: "effect", page: "1" })).toBe(
        "/search?q=effect&page=1"
      )
    })

    test("handles empty query object", () => {
      expect(buildPath("/users", {})).toBe("/users")
    })
  })

  describe("createMatcher", () => {
    test("matches static routes", () => {
      const matcher = createMatcher([
        { path: "/about", component: async () => ({ default: {} as any }) }
      ])
      
      const match = matcher.match("/about")
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({})
    })

    test("matches dynamic :param routes", () => {
      const matcher = createMatcher([
        { path: "/users/:id", component: async () => ({ default: {} as any }) }
      ])
      
      const match = matcher.match("/users/123")
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({ id: "123" })
    })

    test("matches [param] file-based syntax", () => {
      const matcher = createMatcher([
        { path: "/posts/[postId]", component: async () => ({ default: {} as any }) }
      ])
      
      const match = matcher.match("/posts/456")
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({ postId: "456" })
    })

    test("matches multiple params", () => {
      const matcher = createMatcher([
        { path: "/posts/:postId/comments/:commentId", component: async () => ({ default: {} as any }) }
      ])
      
      const match = matcher.match("/posts/1/comments/2")
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({ postId: "1", commentId: "2" })
    })

    test("matches wildcard * routes", () => {
      const matcher = createMatcher([
        { path: "/files/*", component: async () => ({ default: {} as any }) }
      ])
      
      const match = matcher.match("/files/docs/api/router")
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({ "*": "docs/api/router" })
    })

    test("matches [...rest] catch-all syntax", () => {
      const matcher = createMatcher([
        { path: "/files/[...path]", component: async () => ({ default: {} as any }) }
      ])
      
      const match = matcher.match("/files/docs/api/router")
      expect(match).not.toBeNull()
      expect(match?.params).toEqual({ path: "docs/api/router" })
    })

    test("returns null for non-matching paths", () => {
      const matcher = createMatcher([
        { path: "/users", component: async () => ({ default: {} as any }) }
      ])
      
      expect(matcher.match("/posts")).toBeNull()
      expect(matcher.match("/users/extra")).toBeNull()
    })

    test("prioritizes more specific routes", () => {
      const matcher = createMatcher([
        { path: "/users/:id", component: async () => ({ default: {} as any }) },
        { path: "/users/me", component: async () => ({ default: {} as any }) }
      ])
      
      // /users/me should match the static route, not the dynamic one
      const match = matcher.match("/users/me")
      expect(match).not.toBeNull()
      expect(match?.route.path).toBe("/users/me")
      expect(match?.params).toEqual({})
    })

    test("strips query string before matching", () => {
      const matcher = createMatcher([
        { path: "/search", component: async () => ({ default: {} as any }) }
      ])
      
      const match = matcher.match("/search?q=effect")
      expect(match).not.toBeNull()
    })
  })
})

describe("Type-safe routing", () => {
  describe("buildPathWithParams", () => {
    test("builds path with single param", () => {
      const result = buildPathWithParams("/users/:id", { id: "123" })
      expect(result).toBe("/users/123")
    })

    test("builds path with multiple params", () => {
      const result = buildPathWithParams(
        "/posts/:postId/comments/:commentId",
        { postId: "1", commentId: "2" }
      )
      expect(result).toBe("/posts/1/comments/2")
    })

    test("handles path without params", () => {
      const result = buildPathWithParams("/about", {})
      expect(result).toBe("/about")
    })
  })

  describe("ExtractRouteParams type", () => {
    test("extracts single param", () => {
      type Params = ExtractRouteParams<"/users/:id">
      // Type-level test: this should compile
      const params: Params = { id: "123" }
      expect(params.id).toBe("123")
    })

    test("extracts multiple params", () => {
      type Params = ExtractRouteParams<"/posts/:postId/comments/:commentId">
      // Type-level test: this should compile
      const params: Params = { postId: "1", commentId: "2" }
      expect(params.postId).toBe("1")
      expect(params.commentId).toBe("2")
    })

    test("returns empty object for static paths", () => {
      type Params = ExtractRouteParams<"/about">
      // Type-level test: this should be {}
      const params: Params = {}
      expect(Object.keys(params)).toHaveLength(0)
    })
  })
})
