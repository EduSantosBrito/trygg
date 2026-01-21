/**
 * Landing Page
 *
 * Overview of all effect-ui examples and what they demonstrate.
 */
import { Component } from "effect-ui";
import * as Router from "effect-ui/router";

const features = [
  {
    title: "Counter",
    path: "/counter",
    description: "Basic state with Signal, event handlers as Effects",
    concepts: ["Signal.make", "Signal.update", "Component.gen", "Event handlers"],
  },
  {
    title: "Suspend",
    path: "/suspend",
    description: "Async component rendering with Signal.suspend",
    concepts: ["Signal.suspend", "Pending/Failure/Success", "Dep-based caching", "Stale content"],
  },
  {
    title: "Todo List",
    path: "/todo",
    description: "List operations, multiple signals, nested state",
    concepts: ["Signal.each", "Signal.derive", "Stable nested state", "Option type"],
  },
  {
    title: "Theme (DI)",
    path: "/theme",
    description: "Dependency injection with Component.provide, swappable layers",
    concepts: ["Context.Tag", "Layer.succeed", "Component.provide", "Runtime switching"],
  },
  {
    title: "Form Validation",
    path: "/form",
    description: "Typed errors, validation Effects, form state",
    concepts: ["Data.TaggedError", "Effect.either", "Typed validation", "Option for UI"],
  },
  {
    title: "Error Boundary",
    path: "/error-boundary",
    description: "Typed error handling, Cause inspection, recovery UI",
    concepts: ["ErrorBoundary", "Typed errors", "Fallback rendering", "Error recovery"],
  },
  {
    title: "Portal",
    path: "/portal",
    description: "Render content outside the component DOM hierarchy",
    concepts: ["Portal", "Modal dialogs", "Escape overflow", "Nested portals"],
  },
  {
    title: "Dashboard",
    path: "/dashboard",
    description: "Component.gen with multiple services, real-world patterns",
    concepts: ["Multiple services", "Composable layers", "Analytics tracking", "Logger"],
  },
  {
    title: "Users (Routing)",
    path: "/users",
    description: "Type-safe routing with dynamic params",
    concepts: ["Router.Link", "Router.params", "Type inference", "Dynamic routes"],
  },
  {
    title: "Settings (Layouts)",
    path: "/settings",
    description: "Nested layouts with shared navigation sidebar",
    concepts: ["_layout.tsx", "Router.Outlet", "NavLink exact", "Nested routes"],
  },
  {
    title: "Protected (Guards)",
    path: "/protected",
    description: "Route guards for authentication with redirect",
    concepts: ["Route guard", "Router.redirect", "Auth state", "Conditional access"],
  },
  {
    title: "Error Demo",
    path: "/error-demo",
    description: "Error boundary demo - trigger and catch route errors",
    concepts: ["_error.tsx", "currentError", "Error recovery", "Reset effect"],
  },
];

const LandingPage = Component.gen(function* () {
  return (
    <div className="landing">
      <div className="hero">
        <h1>effect-ui Examples</h1>
        <p>An Effect-native UI framework with JSX support</p>
      </div>

      <div className="features-grid">
        {features.map((feature) => (
          <Router.Link key={feature.path} to={feature.path} className="feature-card">
            <h2>{feature.title}</h2>
            <p>{feature.description}</p>
            <div className="concepts">
              {feature.concepts.map((concept) => (
                <span key={concept} className="concept-tag">
                  {concept}
                </span>
              ))}
            </div>
          </Router.Link>
        ))}
      </div>

      <div className="quick-start">
        <h2>Quick Start</h2>
        <pre>{`import { Effect } from "effect"
import { mount, Signal, Component } from "effect-ui"

const App = Component.gen(function* () {
  const count = yield* Signal.make(0)
  return (
    <button onClick={() => Signal.update(count, n => n + 1)}>
      Count: {count}
    </button>
  )
})

mount(document.getElementById("root")!, <App />)`}</pre>
      </div>
    </div>
  );
});

export default LandingPage;
