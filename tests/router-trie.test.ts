/**
 * F-011: Route matching trie tests
 * Tests trie-based O(path-depth) matching with precedence rules
 */
import { describe, it, expect } from "@effect/vitest"
import { Option } from "effect"
import { createMatcher } from "../src/router/matching"

describe("Trie matching (F-011)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockComponent = async () => ({ default: {} as any })

  describe("Trie matching correctness", () => {
    it("static vs param conflict -> static wins", () => {
      const matcher = createMatcher([
        { path: "/users/:id", component: mockComponent },
        { path: "/users/me", component: mockComponent }
      ])
      
      const matchOpt = matcher.match("/users/me")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.route.path).toBe("/users/me")
        expect(matchOpt.value.params).toEqual({})
      }
      
      // Dynamic should still work for other values
      const dynamicOpt = matcher.match("/users/123")
      expect(Option.isSome(dynamicOpt)).toBe(true)
      if (Option.isSome(dynamicOpt)) {
        expect(dynamicOpt.value.route.path).toBe("/users/:id")
        expect(dynamicOpt.value.params).toEqual({ id: "123" })
      }
    })

    it("param vs wildcard -> param wins", () => {
      const matcher = createMatcher([
        { path: "/files/*", component: mockComponent },
        { path: "/files/:filename", component: mockComponent }
      ])
      
      // Single segment after /files/ should match param
      const matchOpt = matcher.match("/files/readme.txt")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.route.path).toBe("/files/:filename")
        expect(matchOpt.value.params).toEqual({ filename: "readme.txt" })
      }
      
      // Multiple segments should match wildcard
      const wildcardOpt = matcher.match("/files/docs/api/readme.txt")
      expect(Option.isSome(wildcardOpt)).toBe(true)
      if (Option.isSome(wildcardOpt)) {
        expect(wildcardOpt.value.route.path).toBe("/files/*")
        expect(wildcardOpt.value.params).toEqual({ "*": "docs/api/readme.txt" })
      }
    })

    it("duplicate patterns -> preserve original order", () => {
      const component1 = mockComponent
      const component2 = async () => ({ default: {} as unknown })
      
      const matcher = createMatcher([
        { path: "/api/:version", component: component1 },
        { path: "/api/:version", component: component2 }
      ])
      
      // First registered route should win
      const matchOpt = matcher.match("/api/v1")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.route.component).toBe(component1)
      }
    })

    it("deep static vs shallow param -> more specific wins", () => {
      const matcher = createMatcher([
        { path: "/api/:version", component: mockComponent },
        { path: "/api/v1/users", component: mockComponent }
      ])
      
      // Deep static path should match
      const matchOpt = matcher.match("/api/v1/users")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.route.path).toBe("/api/v1/users")
      }
      
      // Shallow param should still work
      const paramOpt = matcher.match("/api/v2")
      expect(Option.isSome(paramOpt)).toBe(true)
      if (Option.isSome(paramOpt)) {
        expect(paramOpt.value.route.path).toBe("/api/:version")
      }
    })
  })

  describe("Param extraction", () => {
    it("/users/:id with /users/42 -> params.id == '42'", () => {
      const matcher = createMatcher([
        { path: "/users/:id", component: mockComponent }
      ])
      
      const matchOpt = matcher.match("/users/42")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params.id).toBe("42")
      }
    })

    it("nested params -> all segments captured", () => {
      const matcher = createMatcher([
        { path: "/orgs/:orgId/repos/:repoId/issues/:issueId", component: mockComponent }
      ])
      
      const matchOpt = matcher.match("/orgs/acme/repos/frontend/issues/123")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({
          orgId: "acme",
          repoId: "frontend",
          issueId: "123"
        })
      }
    })

    it("[param] bracket syntax works same as :param", () => {
      const matcher = createMatcher([
        { path: "/posts/[postId]/comments/[commentId]", component: mockComponent }
      ])
      
      const matchOpt = matcher.match("/posts/42/comments/99")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({
          postId: "42",
          commentId: "99"
        })
      }
    })

    it("[...rest] catch-all captures remaining path", () => {
      const matcher = createMatcher([
        { path: "/docs/[...slug]", component: mockComponent }
      ])
      
      const matchOpt = matcher.match("/docs/api/router/navigation")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({
          slug: "api/router/navigation"
        })
      }
    })
  })

  describe("Performance smoke", () => {
    it("1k routes -> matching is fast", () => {
      // Generate 1000 routes
      const routes = Array.from({ length: 1000 }, (_, i) => ({
        path: `/route${i}/:id`,
        component: mockComponent
      }))
      
      const matcher = createMatcher(routes)
      
      // Time matching
      const start = performance.now()
      const iterations = 100
      
      for (let i = 0; i < iterations; i++) {
        matcher.match("/route500/123")
        matcher.match("/route999/456")
        matcher.match("/route0/789")
      }
      
      const elapsed = performance.now() - start
      const avgMs = elapsed / (iterations * 3)
      
      // Should be sub-millisecond per match
      expect(avgMs).toBeLessThan(1)
    })

    it("deep path -> O(depth) not O(routes)", () => {
      // Many routes at different depths
      const routes = [
        ...Array.from({ length: 100 }, (_, i) => ({
          path: `/shallow${i}`,
          component: mockComponent
        })),
        { path: "/a/b/c/d/e/f/g/h/i/j", component: mockComponent }
      ]
      
      const matcher = createMatcher(routes)
      
      // Deep path matching should still be fast
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        matcher.match("/a/b/c/d/e/f/g/h/i/j")
      }
      const elapsed = performance.now() - start
      
      // 1000 matches should complete quickly (< 100ms)
      expect(elapsed).toBeLessThan(100)
    })

    it("mixed static/param/wildcard -> correct precedence at scale", () => {
      const routes = [
        { path: "/api/*", component: mockComponent },
        { path: "/api/:version", component: mockComponent },
        { path: "/api/v1", component: mockComponent },
        { path: "/api/v1/users", component: mockComponent },
        { path: "/api/v1/users/:id", component: mockComponent },
        { path: "/api/v1/users/me", component: mockComponent }
      ]
      
      const matcher = createMatcher(routes)
      
      // Most specific static wins
      const meMatch = matcher.match("/api/v1/users/me")
      expect(Option.isSome(meMatch)).toBe(true)
      if (Option.isSome(meMatch)) {
        expect(meMatch.value.route.path).toBe("/api/v1/users/me")
      }
      
      // Param beats wildcard for single segment
      const v2Match = matcher.match("/api/v2")
      expect(Option.isSome(v2Match)).toBe(true)
      if (Option.isSome(v2Match)) {
        expect(v2Match.value.route.path).toBe("/api/:version")
      }
      
      // Wildcard catches deeply nested
      const deepMatch = matcher.match("/api/v2/some/deep/path")
      expect(Option.isSome(deepMatch)).toBe(true)
      if (Option.isSome(deepMatch)) {
        expect(deepMatch.value.route.path).toBe("/api/*")
      }
    })
  })
})
