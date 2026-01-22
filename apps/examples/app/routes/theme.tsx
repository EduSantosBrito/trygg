/**
 * Theme (Dependency Injection) Example
 *
 * Demonstrates:
 * - Context.Tag for defining services
 * - Component.provide for dependency injection
 * - Layer for service implementation
 * - Swapping layers at runtime
 * - Component.gen API with explicit Component.provide
 */
import { Context, Effect, Layer } from "effect";
import { Signal, Component, type ComponentProps } from "effect-ui";

// Define a Theme service using Context.Tag
interface ThemeConfig {
  readonly name: string;
  readonly background: string;
  readonly text: string;
  readonly primary: string;
  readonly border: string;
}

class Theme extends Context.Tag("Theme")<Theme, ThemeConfig>() {}

// Light theme layer
const LightTheme = Layer.succeed(Theme, {
  name: "Light",
  background: "#ffffff",
  text: "#333333",
  primary: "#0066cc",
  border: "#e0e0e0",
});

// Dark theme layer
const DarkTheme = Layer.succeed(Theme, {
  name: "Dark",
  background: "#1a1a2e",
  text: "#eaeaea",
  primary: "#4da6ff",
  border: "#333355",
});

// =============================================================================
// Approach 1: Component.gen (no props)
// =============================================================================

// A component that uses the Theme service
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme;

  return (
    <div
      className="themed"
      style={{
        background: theme.background,
        color: theme.text,
        border: `2px solid ${theme.border}`,
        padding: "1.5rem",
        borderRadius: "8px",
      }}
    >
      <h3 style={{ color: theme.primary, marginTop: 0 }}>{theme.name} Theme</h3>
      <p>This card uses the injected theme service.</p>
      <p>Click "Switch to Dark/Light Theme" above to see the theme change.</p>
    </div>
  );
});

// =============================================================================
// Approach 2: Component.gen with props (auto layer inference)
// =============================================================================

// Component with typed props - Theme requirement from context
const ThemedTitle = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props;
  const theme = yield* Theme;
  return (
    <h3
      style={{
        color: theme.primary,
        background: theme.background,
        padding: "0.5rem 1rem",
        borderRadius: "4px",
        display: "inline-block",
      }}
    >
      {title}
    </h3>
  );
});

// Main app that switches between themes
const ThemeApp = Component.gen(function* () {
  const isDark = yield* Signal.make(false);

  // Get current value for rendering
  const isDarkValue = yield* Signal.get(isDark);

  // Provide different layers based on state
  const currentTheme = isDarkValue ? DarkTheme : LightTheme;

  const toggleTheme = () => Signal.update(isDark, (v) => !v);

  return Effect.gen(function* () {
    return (
      <div className="example">
        <h2>Theme (Dependency Injection)</h2>
        <p className="description">Dependency injection with Component.provide, swappable layers</p>

        <div className="theme-switcher">
          <button onClick={toggleTheme}>Switch to {isDarkValue ? "Light" : "Dark"} Theme</button>
        </div>

        <ThemedCard />
        <div style={{ marginTop: "1rem" }}>
          <ThemedTitle title="Using Component API" />
        </div>

        <div className="code-example">
          <h3>Two Approaches</h3>

          <h4>1. Component.gen (no props)</h4>
          <pre>{`// Component reads Theme from context
const ThemedCard = Component.gen(function* () {
  const theme = yield* Theme
  return <div style={{ color: theme.text }}>...</div>
})

 return Effect.gen(function* () {
   return <ThemedCard />
 }).pipe(Component.provide(themeLayer))`}</pre>

          <h4 style={{ marginTop: "1rem" }}>2. Component.gen with props</h4>
          <pre>{`// Component with typed props
const ThemedTitle = Component.gen(function* (Props: ComponentProps<{ title: string }>) {
  const { title } = yield* Props
  const theme = yield* Theme
  return <h3 style={{ color: theme.primary }}>{title}</h3>
})

 return Effect.gen(function* () {
   return <ThemedTitle title="Hello" />
 }).pipe(Component.provide(themeLayer))`}</pre>
        </div>
      </div>
    );
  }).pipe(Component.provide(currentTheme));
});

export default ThemeApp;
