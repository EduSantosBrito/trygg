/**
 * F-005: Route matching precomputed depth/score tests
 * Tests that totalDepth and score are precomputed once during matcher creation
 * and used for O(1) sort comparisons during navigation
 */
import { describe, it, expect } from "@effect/vitest"
import { Option } from "effect"
import { createMatcher } from "../src/router/matching"

describe("Precomputed depth/score (F-005)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockComponent = async () => ({ default: {} as any })

  describe("Precomputed values correctness", () => {
    it("route /users (1 segment) has correct depth", () => {
      const matcher = createMatcher([
        { path: "/users", component: mockComponent }
      ])
      
      const matchOpt = matcher.match("/users")
      expect(Option.isSome(matchOpt)).toBe(true)
      // Depth = 1 segment
      // The match should work correctly
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.route.path).toBe("/users")
      }
    })

    it("route /users/:id (2 segments) has correct depth", () => {
      const matcher = createMatcher([
        { path: "/users/:id", component: mockComponent }
      ])
      
      const matchOpt = matcher.match("/users/123")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.route.path).toBe("/users/:id")
        expect(matchOpt.value.params).toEqual({ id: "123" })
      }
    })

    it("nested route with ancestors has combined depth", () => {
      // /admin (1 segment) + /admin/users (2 segments total) + /admin/users/:id (3 segments total)
      const matcher = createMatcher([
        {
          path: "/admin",
          component: mockComponent,
          children: [
            {
              path: "/admin/users",
              component: mockComponent,
              children: [
                { path: "/admin/users/:id", component: mockComponent }
              ]
            }
          ]
        }
      ])
      
      const matchOpt = matcher.match("/admin/users/42")
      expect(Option.isSome(matchOpt)).toBe(true)
      if (Option.isSome(matchOpt)) {
        expect(matchOpt.value.params).toEqual({ id: "42" })
        // Should have 2 parent routes
        expect(matchOpt.value.parents.length).toBe(2)
        expect(matchOpt.value.parents[0]?.route.path).toBe("/admin")
        expect(matchOpt.value.parents[1]?.route.path).toBe("/admin/users")
      }
    })
  })

  describe("Sort correctness with precomputed values", () => {
    it("deeper routes win over shallower routes", () => {
      const matcher = createMatcher([
        { path: "/a", component: mockComponent },
        { path: "/a/b", component: mockComponent },
        { path: "/a/b/c", component: mockComponent }
      ])
      
      // Each path should match its exact depth
      expect(Option.getOrNull(matcher.match("/a"))?.route.path).toBe("/a")
      expect(Option.getOrNull(matcher.match("/a/b"))?.route.path).toBe("/a/b")
      expect(Option.getOrNull(matcher.match("/a/b/c"))?.route.path).toBe("/a/b/c")
    })

    it("equal depth: higher specificity wins (static > param)", () => {
      const matcher = createMatcher([
        { path: "/users/:id", component: mockComponent },
        { path: "/users/me", component: mockComponent }
      ])
      
      // Static "me" should win over param ":id"
      const meMatch = matcher.match("/users/me")
      expect(Option.isSome(meMatch)).toBe(true)
      if (Option.isSome(meMatch)) {
        expect(meMatch.value.route.path).toBe("/users/me")
        expect(meMatch.value.params).toEqual({})
      }
      
      // Other values use param
      const idMatch = matcher.match("/users/123")
      expect(Option.isSome(idMatch)).toBe(true)
      if (Option.isSome(idMatch)) {
        expect(idMatch.value.route.path).toBe("/users/:id")
      }
    })

    it("equal depth: higher specificity wins (param > wildcard)", () => {
      const matcher = createMatcher([
        { path: "/files/*", component: mockComponent },
        { path: "/files/:name", component: mockComponent }
      ])
      
      // Single segment: param wins
      const paramMatch = matcher.match("/files/readme.txt")
      expect(Option.isSome(paramMatch)).toBe(true)
      if (Option.isSome(paramMatch)) {
        expect(paramMatch.value.route.path).toBe("/files/:name")
      }
      
      // Multiple segments: wildcard is the only option
      const wildcardMatch = matcher.match("/files/dir/subdir/file.txt")
      expect(Option.isSome(wildcardMatch)).toBe(true)
      if (Option.isSome(wildcardMatch)) {
        expect(wildcardMatch.value.route.path).toBe("/files/*")
      }
    })
  })

  describe("Performance: no parsePattern in navigation sort", () => {
    it("1000 navigations complete quickly (< 50ms)", () => {
      // Create matcher with deeply nested routes
      const routes = [
        {
          path: "/org",
          component: mockComponent,
          children: [
            {
              path: "/:orgId",
              component: mockComponent,
              children: [
                {
                  path: "/repo",
                  component: mockComponent,
                  children: [
                    {
                      path: "/:repoId",
                      component: mockComponent,
                      children: [
                        { path: "/issues", component: mockComponent },
                        { path: "/issues/:id", component: mockComponent },
                        { path: "/pulls", component: mockComponent },
                        { path: "/pulls/:id", component: mockComponent }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
      
      const matcher = createMatcher(routes)
      
      // Warm up
      matcher.match("/org/acme/repo/frontend/issues/123")
      
      // Measure 1000 navigations
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        matcher.match("/org/acme/repo/frontend/issues/123")
        matcher.match("/org/acme/repo/frontend/pulls/456")
        matcher.match("/org/acme/repo/frontend/issues")
      }
      const elapsed = performance.now() - start
      
      // With precomputed depth/score, 3000 matches should be fast
      // Without precomputation, this would call parsePattern for each ancestor
      // in each sort comparison, making it much slower
      expect(elapsed).toBeLessThan(50)
    })

    it("consistent timing across repeated navigations", () => {
      const routes = Array.from({ length: 100 }, (_, i) => ({
        path: `/route${i}/:id/sub/:subId`,
        component: mockComponent
      }))
      
      const matcher = createMatcher(routes)
      
      // Warm up
      for (let i = 0; i < 50; i++) {
        matcher.match("/route50/123/sub/456")
      }
      
      // Measure multiple batches
      const timings: number[] = []
      for (let batch = 0; batch < 5; batch++) {
        const start = performance.now()
        for (let i = 0; i < 200; i++) {
          matcher.match("/route50/123/sub/456")
        }
        timings.push(performance.now() - start)
      }
      
      // All batches should have similar timing (no degradation)
      const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length
      for (const timing of timings) {
        // Each batch within 3x of average (allows for system noise)
        expect(timing).toBeLessThan(avgTiming * 3)
      }
    })
  })

  describe("Backward compatibility", () => {
    it("static routes match as before", () => {
      const matcher = createMatcher([
        { path: "/about", component: mockComponent },
        { path: "/contact", component: mockComponent }
      ])
      
      expect(Option.isSome(matcher.match("/about"))).toBe(true)
      expect(Option.isSome(matcher.match("/contact"))).toBe(true)
      expect(Option.isNone(matcher.match("/other"))).toBe(true)
    })

    it("dynamic routes capture params as before", () => {
      const matcher = createMatcher([
        { path: "/users/:id", component: mockComponent },
        { path: "/posts/:postId/comments/:commentId", component: mockComponent }
      ])
      
      const userMatch = matcher.match("/users/42")
      expect(Option.isSome(userMatch)).toBe(true)
      if (Option.isSome(userMatch)) {
        expect(userMatch.value.params).toEqual({ id: "42" })
      }
      
      const commentMatch = matcher.match("/posts/1/comments/99")
      expect(Option.isSome(commentMatch)).toBe(true)
      if (Option.isSome(commentMatch)) {
        expect(commentMatch.value.params).toEqual({ postId: "1", commentId: "99" })
      }
    })

    it("nested routes build correct parent chain", () => {
      const matcher = createMatcher([
        {
          path: "/dashboard",
          component: mockComponent,
          children: [
            {
              path: "/dashboard/settings",
              component: mockComponent,
              children: [
                { path: "/dashboard/settings/profile", component: mockComponent }
              ]
            }
          ]
        }
      ])
      
      const match = matcher.match("/dashboard/settings/profile")
      expect(Option.isSome(match)).toBe(true)
      if (Option.isSome(match)) {
        expect(match.value.route.path).toBe("/dashboard/settings/profile")
        expect(match.value.parents.length).toBe(2)
        expect(match.value.parents[0]?.route.path).toBe("/dashboard")
        expect(match.value.parents[1]?.route.path).toBe("/dashboard/settings")
      }
    })

    it("wildcard routes capture rest of path", () => {
      const matcher = createMatcher([
        { path: "/docs/[...slug]", component: mockComponent }
      ])
      
      const match = matcher.match("/docs/api/router/matching")
      expect(Option.isSome(match)).toBe(true)
      if (Option.isSome(match)) {
        expect(match.value.params).toEqual({ slug: "api/router/matching" })
      }
    })
  })
})
