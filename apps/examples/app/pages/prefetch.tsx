/**
 * Prefetch Demo
 *
 * Demonstrates Link prefetch strategies. Routes use static imports — the
 * Vite plugin transforms them to lazy `import()` at build time. In dev,
 * prefetch fires debug events. In production, it triggers actual chunk fetches.
 */
import { Component } from "trygg";
import * as Router from "trygg/router";

const strategies = [
  {
    label: "Intent (default)",
    prefetch: "intent" as const,
    to: "/counter" as const,
    linkText: "Counter →",
    description: "Fires on hover (50ms debounce) or focus via JS event handlers.",
    inspect: "Hover over the link → console shows router.prefetch.start event.",
  },
  {
    label: "Viewport",
    prefetch: "viewport" as const,
    to: "/todo" as const,
    linkText: "Todo List →",
    description: "Fires when the link enters the viewport via IntersectionObserver.",
    inspect:
      'Elements panel → data-trygg-prefetch="viewport" and data-trygg-prefetch-path on the <a>.',
  },
  {
    label: "Render",
    prefetch: "render" as const,
    to: "/form" as const,
    linkText: "Form →",
    description: "Fires immediately when the Link component renders.",
    inspect: "Console shows router.prefetch.start on page load — no hover needed.",
  },
  {
    label: "Disabled",
    prefetch: false as const,
    to: "/theme" as const,
    linkText: "Theme →",
    description: "No prefetching.",
    inspect: "No data attributes, no prefetch events on hover or render.",
  },
];

const PrefetchPage = Component.gen(function* () {
  return (
    <div>
      <h1 className="text-2xl m-0 mb-2">Prefetch Strategies</h1>
      <p className="text-gray-500 mt-0 mb-4">
        Verifies Link prefetch wiring. Open DevTools to inspect.
      </p>
      <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
        <strong>Dev:</strong> Prefetch fires debug events (check Console). In production, the Vite
        plugin transforms routes to lazy imports — prefetch triggers chunk fetches (Network tab).
      </div>

      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        What to check
      </h3>
      <ul className="mb-6 text-sm text-gray-600 list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Elements panel:</strong> Viewport link has{" "}
          <code>data-trygg-prefetch="viewport"</code> attribute
        </li>
        <li>
          <strong>Console:</strong> Filter by <code>router.prefetch</code> to see strategy-triggered
          events
        </li>
        <li>
          <strong>Intent:</strong> Hover a link for 50ms+ → <code>router.prefetch.start</code>
        </li>
        <li>
          <strong>Render:</strong> Event fires on page load without interaction
        </li>
        <li>
          <strong>Disabled:</strong> No events, no attributes
        </li>
      </ul>

      <div className="flex flex-col gap-4">
        {strategies.map((s) => (
          <div key={s.label} className="p-5 bg-white rounded-lg border border-gray-200">
            <div className="flex items-baseline gap-3 mb-2">
              <h2 className="m-0 text-lg text-blue-600">{s.label}</h2>
              <code className="text-xs text-gray-400">
                prefetch=
                {typeof s.prefetch === "string" ? `"${s.prefetch}"` : "false"}
              </code>
            </div>
            <p className="m-0 mb-2 text-sm text-gray-500">{s.description}</p>
            <p className="m-0 mb-3 text-xs text-gray-400 italic">{s.inspect}</p>
            <Router.Link
              to={s.to}
              prefetch={s.prefetch}
              className="inline-block px-4 py-2 bg-blue-50 text-blue-700 rounded border border-blue-200 no-underline hover:bg-blue-100 transition-colors"
            >
              {s.linkText}
            </Router.Link>
          </div>
        ))}
      </div>

      {/* Spacer to push viewport link below the fold */}
      <div className="mt-12 p-4 bg-amber-50 border border-amber-200 rounded text-center text-amber-800">
        There's another one! Scroll down.
      </div>
      <div style={{ height: "100vh" }} />
      <div className="p-5 bg-white rounded-lg border border-gray-200">
        <div className="flex items-baseline gap-3 mb-2">
          <h2 className="m-0 text-lg text-blue-600">Viewport (below fold)</h2>
          <code className="text-xs text-gray-400">prefetch="viewport"</code>
        </div>
        <p className="m-0 mb-2 text-sm text-gray-500">
          This link was below the fold. Prefetch fires only when you scroll it into view.
        </p>
        <p className="m-0 mb-3 text-xs text-gray-400 italic">
          Console shows router.prefetch.start when this section becomes visible.
        </p>
        <Router.Link
          to="/dashboard"
          prefetch={"viewport"}
          className="inline-block px-4 py-2 bg-blue-50 text-blue-700 rounded border border-blue-200 no-underline hover:bg-blue-100 transition-colors"
        >
          Dashboard →
        </Router.Link>
      </div>
    </div>
  );
});

export default PrefetchPage;
