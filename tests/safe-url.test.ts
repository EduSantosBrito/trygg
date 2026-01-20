/**
 * Tests for SafeUrl (F-013)
 * 
 * Verifies:
 * 1. Unsafe URL schemes are rejected (javascript:)
 * 2. Safe schemes are allowed (http, https, mailto, etc.)
 * 3. Relative URLs are allowed
 * 4. Custom schemes can be added via allowSchemes()
 * 5. Renderer integration blocks unsafe href/src
 */
import { describe, expect, it, beforeEach, afterEach } from "@effect/vitest"
import { Effect, Exit, Option, Scope } from "effect"
import * as SafeUrl from "../src/SafeUrl.js"
import * as Renderer from "../src/Renderer.js"
import { intrinsic, text } from "../src/Element.js"
import type { Element } from "../src/Element.js"

/**
 * Helper to run renderer effects with a clean DOM container
 */
const withContainer = <A, E>(
  fn: (container: HTMLElement) => Effect.Effect<A, E, Scope.Scope>
): Effect.Effect<A, E, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const container = document.createElement("div")
      document.body.appendChild(container)
      
      try {
        const result = yield* fn(container)
        return result
      } finally {
        container.remove()
      }
    })
  )

/**
 * Helper to render an element and get the result
 */
const renderInContainer = Effect.fnUntraced(
  function* (container: HTMLElement, element: Element) {
    const renderer = yield* Renderer.Renderer
    return yield* renderer.render(element, container)
  },
  Effect.provide(Renderer.browserLayer)
)

describe("SafeUrl (F-013)", () => {
  beforeEach(() => {
    // Reset config before each test
    SafeUrl.resetConfig()
  })

  afterEach(() => {
    // Ensure config is reset after each test
    SafeUrl.resetConfig()
  })

  describe("SafeUrl validation", () => {
    describe("Unsafe schemes rejected", () => {
      it.effect('href="javascript:alert(1)" returns UnsafeUrlError', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("javascript:alert(1)")
          )

          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            const cause = result.cause
            expect(cause._tag).toBe("Fail")
            if (cause._tag === "Fail") {
              const error = cause.error as SafeUrl.UnsafeUrlError
              expect(error._tag).toBe("UnsafeUrlError")
              expect(error.reason).toBe("unsafe_scheme")
              expect(error.scheme).toBe("javascript")
              expect(error.url).toBe("javascript:alert(1)")
            }
          }
        })
      )

      it.effect('href="vbscript:msgbox" returns UnsafeUrlError', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("vbscript:msgbox")
          )

          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            const cause = result.cause
            if (cause._tag === "Fail") {
              const error = cause.error as SafeUrl.UnsafeUrlError
              expect(error.reason).toBe("unsafe_scheme")
              expect(error.scheme).toBe("vbscript")
            }
          }
        })
      )

      it.effect("empty URL returns UnsafeUrlError", () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(SafeUrl.validate(""))

          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            const cause = result.cause
            if (cause._tag === "Fail") {
              const error = cause.error as SafeUrl.UnsafeUrlError
              expect(error.reason).toBe("empty_url")
            }
          }
        })
      )

      it.effect("whitespace-only URL returns UnsafeUrlError", () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(SafeUrl.validate("   "))

          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            const cause = result.cause
            if (cause._tag === "Fail") {
              const error = cause.error as SafeUrl.UnsafeUrlError
              expect(error.reason).toBe("empty_url")
            }
          }
        })
      )
    })

    describe("Safe schemes allowed", () => {
      it.effect('href="https://example.com" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("https://example.com")
          )

          expect(Exit.isSuccess(result)).toBe(true)
          if (Exit.isSuccess(result)) {
            expect(result.value).toBe("https://example.com")
          }
        })
      )

      it.effect('href="http://example.com" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("http://example.com")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )

      it.effect('href="mailto:me@example.com" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("mailto:me@example.com")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )

      it.effect('href="tel:+1234567890" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("tel:+1234567890")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )

      it.effect('href="sms:+1234567890" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("sms:+1234567890")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )

      it.effect('src="blob:..." is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("blob:http://example.com/uuid")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )

      it.effect('src="data:text/html,..." is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("data:text/plain,hello")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )
    })

    describe("Relative URLs allowed", () => {
      it.effect('href="/page" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(SafeUrl.validate("/page"))

          expect(Exit.isSuccess(result)).toBe(true)
          if (Exit.isSuccess(result)) {
            expect(result.value).toBe("/page")
          }
        })
      )

      it.effect('href="./relative" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("./relative")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )

      it.effect('href="../parent" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("../parent")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )

      it.effect('href="page.html" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("page.html")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )

      it.effect('href="#anchor" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(SafeUrl.validate("#anchor"))

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )

      it.effect('href="?query=param" is allowed', () =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            SafeUrl.validate("?query=param")
          )

          expect(Exit.isSuccess(result)).toBe(true)
        })
      )
    })
  })

  describe("Custom schemes via allowSchemes()", () => {
    it.effect('adding "myapp" allows href="myapp://settings"', () =>
      Effect.gen(function* () {
        SafeUrl.allowSchemes(["myapp"])

        const result = yield* Effect.exit(
          SafeUrl.validate("myapp://settings")
        )

        expect(Exit.isSuccess(result)).toBe(true)
      })
    )

    it.effect('adding "web+myapp" allows href="web+myapp://page"', () =>
      Effect.gen(function* () {
        SafeUrl.allowSchemes(["web+myapp"])

        const result = yield* Effect.exit(
          SafeUrl.validate("web+myapp://page")
        )

        expect(Exit.isSuccess(result)).toBe(true)
      })
    )

    it.effect("adding scheme with colon normalizes it", () =>
      Effect.gen(function* () {
        SafeUrl.allowSchemes(["custom:"])

        const result = yield* Effect.exit(
          SafeUrl.validate("custom://test")
        )

        expect(Exit.isSuccess(result)).toBe(true)
      })
    )

    it.effect("adding schemes preserves existing defaults", () =>
      Effect.gen(function* () {
        SafeUrl.allowSchemes(["custom"])

        // Should still allow https
        const https = yield* Effect.exit(
          SafeUrl.validate("https://example.com")
        )
        expect(Exit.isSuccess(https)).toBe(true)

        // And custom
        const custom = yield* Effect.exit(
          SafeUrl.validate("custom://test")
        )
        expect(Exit.isSuccess(custom)).toBe(true)
      })
    )

    it.effect("reset removes custom schemes", () =>
      Effect.gen(function* () {
        SafeUrl.allowSchemes(["custom"])
        SafeUrl.resetConfig()

        const result = yield* Effect.exit(
          SafeUrl.validate("custom://test")
        )

        expect(Exit.isFailure(result)).toBe(true)
      })
    )
  })

  describe("Sync validation utilities", () => {
    it("validateSync returns Option.some for valid URL", () => {
      const result = SafeUrl.validateSync("https://example.com")
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value).toBe("https://example.com")
      }
    })

    it("validateSync returns Option.none for unsafe URL", () => {
      const result = SafeUrl.validateSync("javascript:alert(1)")
      expect(Option.isNone(result)).toBe(true)
    })

    it("isSafe returns true for valid URL", () => {
      expect(SafeUrl.isSafe("https://example.com")).toBe(true)
    })

    it("isSafe returns false for unsafe URL", () => {
      expect(SafeUrl.isSafe("javascript:alert(1)")).toBe(false)
    })

    it("validateOrThrow returns URL for valid input", () => {
      const result = SafeUrl.validateOrThrow("https://example.com")
      expect(result).toBe("https://example.com")
    })

    it("validateOrThrow throws UnsafeUrlError for invalid input", () => {
      expect(() => SafeUrl.validateOrThrow("javascript:alert(1)")).toThrow(
        SafeUrl.UnsafeUrlError
      )
    })
  })

  describe("Renderer integration", () => {
    it.effect("renders href with safe URL", () =>
      Effect.gen(function* () {
        let warnCalled = false
        const originalWarn = console.warn
        console.warn = () => { warnCalled = true }

        try {
          yield* withContainer((container) =>
            Effect.gen(function* () {
              const link = intrinsic(
                "a",
                { href: "https://example.com" },
                [text("Link")]
              )
              yield* renderInContainer(container, link)

              const anchor = container.querySelector("a")
              expect(anchor).not.toBeNull()
              expect(anchor?.getAttribute("href")).toBe("https://example.com")
            })
          )

          expect(warnCalled).toBe(false)
        } finally {
          console.warn = originalWarn
        }
      })
    )

    it.effect("blocks href with unsafe URL and emits warning", () =>
      Effect.gen(function* () {
        let warnMessage = ""
        const originalWarn = console.warn
        console.warn = (msg: string) => { warnMessage = msg }

        try {
          yield* withContainer((container) =>
            Effect.gen(function* () {
              const link = intrinsic(
                "a",
                { href: "javascript:alert(1)" },
                [text("Link")]
              )
              yield* renderInContainer(container, link)

              const anchor = container.querySelector("a")
              expect(anchor).not.toBeNull()
              // href should NOT be set
              expect(anchor?.getAttribute("href")).toBeNull()
            })
          )

          expect(warnMessage).toContain("Blocked unsafe href")
          expect(warnMessage).toContain("javascript:alert(1)")
        } finally {
          console.warn = originalWarn
        }
      })
    )

    it.effect("renders src with safe URL", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const img = intrinsic(
            "img",
            { src: "https://example.com/image.png", alt: "Test" },
            []
          )
          yield* renderInContainer(container, img)

          const imgEl = container.querySelector("img")
          expect(imgEl).not.toBeNull()
          expect(imgEl?.getAttribute("src")).toBe("https://example.com/image.png")
        })
      )
    )

    it.effect("blocks src with unsafe URL", () =>
      Effect.gen(function* () {
        let warnMessage = ""
        const originalWarn = console.warn
        console.warn = (msg: string) => { warnMessage = msg }

        try {
          yield* withContainer((container) =>
            Effect.gen(function* () {
              const img = intrinsic(
                "img",
                { src: "javascript:alert(1)", alt: "Test" },
                []
              )
              yield* renderInContainer(container, img)

              const imgEl = container.querySelector("img")
              expect(imgEl).not.toBeNull()
              // src should NOT be set
              expect(imgEl?.getAttribute("src")).toBeNull()
            })
          )

          expect(warnMessage).toContain("Blocked unsafe src")
        } finally {
          console.warn = originalWarn
        }
      })
    )

    it.effect("renders relative href", () =>
      withContainer((container) =>
        Effect.gen(function* () {
          const link = intrinsic("a", { href: "/page" }, [text("Link")])
          yield* renderInContainer(container, link)

          const anchor = container.querySelector("a")
          expect(anchor?.getAttribute("href")).toBe("/page")
        })
      )
    )
  })

  describe("Docs validation (test assertions)", () => {
    it.effect("error message includes allowed schemes list", () =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(
          SafeUrl.validate("javascript:x")
        )

        if (Exit.isFailure(result)) {
          const cause = result.cause
          if (cause._tag === "Fail") {
            const error = cause.error as SafeUrl.UnsafeUrlError
            expect(error.message).toContain("http")
            expect(error.message).toContain("https")
            expect(error.message).toContain("mailto")
            expect(error.message).toContain("SafeUrl.allowSchemes")
          }
        }
      })
    )

    it.effect("error message includes the unsafe scheme", () =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(
          SafeUrl.validate("javascript:alert(1)")
        )

        if (Exit.isFailure(result)) {
          const cause = result.cause
          if (cause._tag === "Fail") {
            const error = cause.error as SafeUrl.UnsafeUrlError
            expect(error.message).toContain('Unsafe URL scheme "javascript"')
          }
        }
      })
    )
  })
})
