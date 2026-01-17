/**
 * Dashboard Example
 *
 * A comprehensive example demonstrating:
 * - Component.gen with multiple services
 * - Composing components with different layer requirements
 * - Multiple services (Theme, Analytics, Logger)
 * - Real-world component patterns
 */
import { Context, Effect, Layer } from "effect"
import { Signal, Component } from "effect-ui"

// =============================================================================
// Services
// =============================================================================

// Theme Service
interface ThemeConfig {
  readonly name: string
  readonly primary: string
  readonly secondary: string
  readonly background: string
  readonly cardBackground: string
  readonly text: string
  readonly textMuted: string
}

class Theme extends Context.Tag("Theme")<Theme, ThemeConfig>() {}

const lightTheme = Layer.succeed(Theme, {
  name: "Light",
  primary: "#0066cc",
  secondary: "#6c757d",
  background: "#f8f9fa",
  cardBackground: "#ffffff",
  text: "#212529",
  textMuted: "#6c757d"
})

const darkTheme = Layer.succeed(Theme, {
  name: "Dark",
  primary: "#4da6ff",
  secondary: "#adb5bd",
  background: "#1a1a2e",
  cardBackground: "#16213e",
  text: "#e9ecef",
  textMuted: "#adb5bd"
})

// Analytics Service
interface AnalyticsService {
  readonly track: (event: string, data?: Record<string, unknown>) => Effect.Effect<void>
}

class Analytics extends Context.Tag("Analytics")<Analytics, AnalyticsService>() {}

const analyticsLayer = Layer.succeed(Analytics, {
  track: (event, data) => Effect.log(`[Analytics] ${event}`, data)
})

// Logger Service
interface LoggerService {
  readonly info: (message: string) => Effect.Effect<void>
  readonly warn: (message: string) => Effect.Effect<void>
}

class Logger extends Context.Tag("Logger")<Logger, LoggerService>() {}

const loggerLayer = Layer.succeed(Logger, {
  info: (message) => Effect.log(`[INFO] ${message}`),
  warn: (message) => Effect.log(`[WARN] ${message}`)
})

// =============================================================================
// Dashboard Components
// =============================================================================

// StatCard - displays a statistic with theme
const StatCard = Component.gen<{
  title: string
  value: number | string
  change?: string
}>()(Props => function* () {
  const { title, value, change } = yield* Props
  const theme = yield* Theme
  
  return (
    <div style={{
      background: theme.cardBackground,
      padding: "1.5rem",
      borderRadius: "8px",
      boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
    }}>
      <h3 style={{ margin: 0, color: theme.textMuted, fontSize: "0.875rem", fontWeight: "normal" }}>
        {title}
      </h3>
      <div style={{ fontSize: "2rem", fontWeight: "bold", color: theme.text, marginTop: "0.5rem" }}>
        {value}
      </div>
      {change && (
        <div style={{ 
          color: change.startsWith("+") ? "#28a745" : change.startsWith("-") ? "#dc3545" : theme.textMuted,
          fontSize: "0.875rem",
          marginTop: "0.25rem"
        }}>
          {change} from last month
        </div>
      )}
    </div>
  )
})

// ActivityItem - displays an activity with theme and analytics
const ActivityItem = Component.gen<{
  text: string
  time: string
}>()(Props => function* () {
  const { text, time } = yield* Props
  const theme = yield* Theme
  const analytics = yield* Analytics
  
  const onClick = () => analytics.track("activity_clicked", { text })
  
  return (
    <div 
      onClick={onClick}
      style={{
        padding: "0.75rem",
        borderBottom: `1px solid ${theme.secondary}20`,
        cursor: "pointer"
      }}
    >
      <div style={{ color: theme.text }}>{text}</div>
      <div style={{ color: theme.textMuted, fontSize: "0.75rem" }}>{time}</div>
    </div>
  )
})

// ActionButton - button with analytics tracking
const ActionButton = Component.gen<{
  label: string
  variant: "primary" | "secondary"
  onClick: () => Effect.Effect<void>
}>()(Props => function* () {
  const { label, variant, onClick } = yield* Props
  const theme = yield* Theme
  const analytics = yield* Analytics
  
  const handleClick = () =>
    Effect.gen(function* () {
      yield* analytics.track("button_clicked", { label, variant })
      yield* onClick()
    })
  
  return (
    <button
      onClick={handleClick}
      style={{
        background: variant === "primary" ? theme.primary : "transparent",
        color: variant === "primary" ? "#fff" : theme.text,
        border: variant === "secondary" ? `1px solid ${theme.secondary}` : "none",
        padding: "0.5rem 1rem",
        borderRadius: "4px",
        cursor: "pointer"
      }}
    >
      {label}
    </button>
  )
})

// Header - uses theme and logger
const Header = Component.gen<{
  userName: string
}>()(Props => function* () {
  const { userName } = yield* Props
  const theme = yield* Theme
  const logger = yield* Logger
  
  yield* logger.info(`Header rendered for ${userName}`)
  
  return (
    <header style={{
      background: theme.cardBackground,
      borderBottom: `1px solid ${theme.secondary}20`
    }}>
      <div style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "1rem 1.5rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <h1 style={{ margin: 0, color: theme.primary, fontSize: "1.5rem" }}>
          Dashboard
        </h1>
        <div style={{ color: theme.text }}>
          Welcome, {userName}!
        </div>
      </div>
    </header>
  )
})

// SectionTitle - simple themed section title
const SectionTitle = Component.gen<{ title: string }>()(Props => function* () {
  const { title } = yield* Props
  const theme = yield* Theme
  
  return (
    <h2 style={{ color: theme.text, marginBottom: "1rem" }}>
      {title}
    </h2>
  )
})

// =============================================================================
// Main Dashboard App
// =============================================================================

const DashboardApp = Component.gen(function* () {
  const isDark = yield* Signal.make(false)
  const isDarkValue = yield* Signal.get(isDark)
  
  const currentTheme = isDarkValue ? darkTheme : lightTheme
  const theme = isDarkValue 
    ? { name: "Dark", primary: "#4da6ff", background: "#1a1a2e", text: "#e9ecef", cardBackground: "#16213e" }
    : { name: "Light", primary: "#0066cc", background: "#f8f9fa", text: "#212529", cardBackground: "#ffffff" }
  
  const toggleTheme = () => Signal.update(isDark, (v) => !v)
  
  // Sample data
  const activities = [
    { text: "New user registered", time: "2 minutes ago" },
    { text: "Order #1234 completed", time: "15 minutes ago" },
    { text: "Payment received", time: "1 hour ago" },
    { text: "Report generated", time: "3 hours ago" }
  ]
  
  return (
    <div style={{ 
      minHeight: "100vh", 
      background: theme.background,
      fontFamily: "system-ui, -apple-system, sans-serif",
      margin: "-1.5rem",
      padding: "0"
    }}>
      <Header userName="Developer" theme={currentTheme} logger={loggerLayer} />
      
      <main style={{ padding: "1.5rem", maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <SectionTitle title="Overview" theme={currentTheme} />
          <ActionButton 
            label={`Switch to ${isDarkValue ? "Light" : "Dark"}`}
            variant="secondary"
            onClick={toggleTheme}
            theme={currentTheme}
            analytics={analyticsLayer}
          />
        </div>
        
        {/* Stats Grid */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem"
        }}>
          <StatCard title="Total Users" value="12,345" change="+12%" theme={currentTheme} />
          <StatCard title="Revenue" value="$45,678" change="+8%" theme={currentTheme} />
          <StatCard title="Orders" value="1,234" change="-3%" theme={currentTheme} />
          <StatCard title="Conversion" value="3.2%" change="+0.5%" theme={currentTheme} />
        </div>
        
        {/* Recent Activity */}
        <SectionTitle title="Recent Activity" theme={currentTheme} />
        <div style={{
          background: theme.cardBackground,
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
        }}>
          {activities.map((activity, i) => (
            <ActivityItem 
              key={i}
              text={activity.text} 
              time={activity.time}
              theme={currentTheme}
              analytics={analyticsLayer}
            />
          ))}
        </div>
        
        {/* Actions */}
        <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
          <ActionButton 
            label="Generate Report"
            variant="primary"
            onClick={() => Effect.log("Generating report...")}
            theme={currentTheme}
            analytics={analyticsLayer}
          />
          <ActionButton 
            label="Export Data"
            variant="secondary"
            onClick={() => Effect.log("Exporting data...")}
            theme={currentTheme}
            analytics={analyticsLayer}
          />
        </div>
      </main>
      
      <div style={{ 
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "0 1.5rem 2rem"
      }}>
        <div className="code-example" style={{
          background: theme.cardBackground,
        }}>
          <h3 style={{ color: theme.text }}>Component.gen with Multiple Services</h3>
        <pre style={{ 
          background: theme.background,
          color: theme.text,
        }}>{`// Component requiring Theme + Analytics
const ActionButton = Component.gen<{
  label: string
  onClick: () => Effect<void>
}>()(Props => function* () {
  const { label, onClick } = yield* Props
  const theme = yield* Theme       // Service 1
  const analytics = yield* Analytics  // Service 2
  
  const handleClick = () =>
    Effect.gen(function* () {
      yield* analytics.track("click", { label })
      yield* onClick()
    })
  
  return (
    <button 
      onClick={handleClick}
      style={{ background: theme.primary }}
    >
      {label}
    </button>
  )
})

// TypeScript infers props:
// { label, onClick, theme: Layer<Theme>, analytics: Layer<Analytics> }
<ActionButton 
  label="Click me"
  onClick={() => Effect.log("clicked")}
  theme={themeLayer}
  analytics={analyticsLayer}
/>`}</pre>
        </div>
      </div>
    </div>
  )
})

export default DashboardApp
