/**
 * Tests for Component<P>() API with automatic layer prop inference
 */
import { describe, it, expect } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { Component, type ComponentProps, type PropsMarker } from "../src/index.js"
import { render } from "../src/testing.js"

// =============================================================================
// Test Services
// =============================================================================

class Theme extends Context.Tag("Theme")<Theme, { primary: string; secondary: string }>() {}
class Logger extends Context.Tag("Logger")<Logger, { log: (msg: string) => void }>() {}

const lightTheme = Layer.succeed(Theme, { primary: "#333", secondary: "#666" })
const darkTheme = Layer.succeed(Theme, { primary: "#fff", secondary: "#ccc" })

// =============================================================================
// Type-Level Tests - Debug actual types
// =============================================================================

// Test 1: Component with props and one service requirement
const Card = Component<{ title: string }>()(Props =>
  Effect.gen(function* () {
    const { title } = yield* Props
    const theme = yield* Theme
    void theme
    return <div>{title}</div>
  })
)

// Debug: What type does Card accept?
type CardProps = Parameters<typeof Card>[0]

// Check if CardProps has the expected shape
type HasTitle = CardProps extends { title: string } ? true : false
type HasThemeLayer = CardProps extends { readonly theme: Layer.Layer<Theme> } ? true : false

// These should both be true - void to suppress unused warnings
void (true satisfies HasTitle)
void (true satisfies HasThemeLayer)

// =============================================================================
// Test 2: Component with multiple services
// =============================================================================

const Dashboard = Component<{ userId: string }>()(Props =>
  Effect.gen(function* () {
    const { userId } = yield* Props
    const theme = yield* Theme
    const logger = yield* Logger
    void theme
    void logger
    return <div>User: {userId}</div>
  })
)

type DashboardProps = Parameters<typeof Dashboard>[0]
type DashboardHasUserId = DashboardProps extends { userId: string } ? true : false
type DashboardHasTheme = DashboardProps extends { readonly theme: Layer.Layer<Theme> } ? true : false  
type DashboardHasLogger = DashboardProps extends { readonly logger: Layer.Layer<Logger> } ? true : false

void (true satisfies DashboardHasUserId)
void (true satisfies DashboardHasTheme)
void (true satisfies DashboardHasLogger)

// =============================================================================
// Test 3: Component with no service requirements
// =============================================================================

const SimpleCard = Component<{ message: string }>()(Props =>
  Effect.gen(function* () {
    const { message } = yield* Props
    return <div>{message}</div>
  })
)

type SimpleCardProps = Parameters<typeof SimpleCard>[0]
type SimpleHasMessage = SimpleCardProps extends { message: string } ? true : false

void (true satisfies SimpleHasMessage)

// =============================================================================
// Runtime Tests
// =============================================================================

describe("Component API", () => {
  it.scoped("renders component with props and layer", () =>
    Effect.gen(function* () {
      const TestCard = Component<{ title: string }>()(Props =>
        Effect.gen(function* () {
          const { title } = yield* Props
          const theme = yield* Theme
          return <div data-testid="card" style={{ color: theme.primary }}>{title}</div>
        })
      )

      const { getByTestId } = yield* render(
        <TestCard title="Hello World" theme={lightTheme} />
      )

      const card = getByTestId("card")
      expect(card.textContent).toBe("Hello World")
      expect(card.style.color).toBe("#333")
    })
  )

  it.scoped("renders component with multiple layer requirements", () =>
    Effect.gen(function* () {
      const logs: string[] = []
      const loggerLayer = Layer.succeed(Logger, {
        log: (msg: string) => { logs.push(msg) }
      })

      const LoggingCard = Component<{ title: string }>()(Props =>
        Effect.gen(function* () {
          const { title } = yield* Props
          const theme = yield* Theme
          const logger = yield* Logger
          logger.log(`Rendering: ${title}`)
          return <div data-testid="card" style={{ color: theme.primary }}>{title}</div>
        })
      )

      const { getByTestId } = yield* render(
        <LoggingCard title="Test" theme={lightTheme} logger={loggerLayer} />
      )

      expect(getByTestId("card").textContent).toBe("Test")
      expect(logs).toContain("Rendering: Test")
    })
  )

  it.scoped("renders component with no service requirements", () =>
    Effect.gen(function* () {
      const SimpleDiv = Component<{ message: string }>()(Props =>
        Effect.gen(function* () {
          const { message } = yield* Props
          return <div data-testid="simple">{message}</div>
        })
      )

      const { getByTestId } = yield* render(
        <SimpleDiv message="No layers needed" />
      )

      expect(getByTestId("simple").textContent).toBe("No layers needed")
    })
  )

  it.scoped("component uses different theme layers", () =>
    Effect.gen(function* () {
      const ThemeDisplay = Component()(Props =>
        Effect.gen(function* () {
          yield* Props
          const theme = yield* Theme
          return <span data-testid="color">{theme.primary}</span>
        })
      )

      // Render with light theme
      const result1 = yield* render(<ThemeDisplay theme={lightTheme} />)
      expect(result1.getByTestId("color").textContent).toBe("#333")

      // Render with dark theme (new render)
      const result2 = yield* render(<ThemeDisplay theme={darkTheme} />)
      expect(result2.getByTestId("color").textContent).toBe("#fff")
    })
  )
})

// =============================================================================
// Component.gen API Tests
// =============================================================================

// Test: Component.gen without props - just a generator
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{theme.secondary}</div>
})

void ThemedCard

// Test: Component.gen with props
const TitledCard = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})

void TitledCard

// Test: Component.gen inference via ComponentProps
const InferredCardViaProps = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props
  const theme = yield* Theme
  return <div style={{ color: theme.primary }}>{title}</div>
})

void InferredCardViaProps



// Test: Component.gen with no requirements
const PlainCard = Component.gen(function* () {
  return <div>Just a div</div>
})

type PlainCardProps = Parameters<typeof PlainCard>[0]
// Should have no required props (empty object or Record<string, never>)
void ({} satisfies PlainCardProps)

describe("Component.gen API", () => {
  it.scoped("renders Component.gen without props", () =>
    Effect.gen(function* () {
      const TestCard = Component.gen(function* () {
        const theme = yield* Theme
        return <div data-testid="themed">{theme.primary}</div>
      })

      const { getByTestId } = yield* render(<TestCard theme={lightTheme} />)
      expect(getByTestId("themed").textContent).toBe("#333")
    })
  )

  it.scoped("renders Component.gen with props", () =>
    Effect.gen(function* () {
      const TestCard = Component.gen(function* (Props: ComponentProps<{ title: string; subtitle: string }>) {
        const { title, subtitle } = yield* Props
        const theme = yield* Theme
        return (
          <div data-testid="card" style={{ color: theme.primary }}>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
        )
      })

      const { getByTestId } = yield* render(
        <TestCard title="Hello" subtitle="World" theme={lightTheme} />
      )
      
      const card = getByTestId("card")
      expect(card.querySelector("h1")?.textContent).toBe("Hello")
      expect(card.querySelector("p")?.textContent).toBe("World")
    })
  )

  it.scoped("renders Component.gen with no requirements", () =>
    Effect.gen(function* () {
      const TestCard = Component.gen(function* () {
        return <div data-testid="plain">No requirements</div>
      })

      const { getByTestId } = yield* render(<TestCard />)
      expect(getByTestId("plain").textContent).toBe("No requirements")
    })
  )

  it.scoped("renders Component.gen with multiple layers", () =>
    Effect.gen(function* () {
      const logs: string[] = []
      const loggerLayer = Layer.succeed(Logger, {
        log: (msg: string) => { logs.push(msg) }
      })

      const TestCard = Component.gen(function* (Props: ComponentProps<{ name: string }>) {
        const { name } = yield* Props
        const theme = yield* Theme
        const logger = yield* Logger
        logger.log(`Rendering ${name}`)
        return <div data-testid="multi" style={{ color: theme.primary }}>{name}</div>
      })

      const { getByTestId } = yield* render(
        <TestCard name="TestUser" theme={lightTheme} logger={loggerLayer} />
      )
      
      expect(getByTestId("multi").textContent).toBe("TestUser")
      expect(logs).toContain("Rendering TestUser")
    })
  )
})

// =============================================================================
// Export type tests to ensure they compile
// =============================================================================

export type { ComponentProps, PropsMarker }
