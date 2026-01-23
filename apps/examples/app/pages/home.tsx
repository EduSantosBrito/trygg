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
    concepts: ["Layout", "Router.Outlet", "NavLink exact", "Nested routes"],
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
    concepts: ["Error boundary", "currentError", "Error recovery", "Reset effect"],
  },
];

const HomePage = Component.gen(function* () {
  return (
    <div className="pb-8">
      <div className="text-center py-8 pb-12">
        <h1 className="text-2xl m-0">effect-ui Examples</h1>
        <p className="text-gray-500 mt-2 text-lg">An Effect-native UI framework with JSX support</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4 mb-8">
        {features.map((feature) => (
          <Router.Link
            key={feature.path}
            to={feature.path}
            className="block p-5 bg-white rounded-lg border border-gray-200 no-underline transition-all hover:border-blue-600 hover:shadow-[0_2px_8px_rgba(0,102,204,0.15)]"
          >
            <h2 className="m-0 mb-2 text-lg text-blue-600">{feature.title}</h2>
            <p className="m-0 mb-3 text-gray-500 text-sm">{feature.description}</p>
            <div className="flex flex-wrap gap-1">
              {feature.concepts.map((concept) => (
                <span
                  key={concept}
                  className="py-0.5 px-2 bg-gray-100 rounded text-xs text-gray-600"
                >
                  {concept}
                </span>
              ))}
            </div>
          </Router.Link>
        ))}
      </div>
    </div>
  );
});

export default HomePage;
