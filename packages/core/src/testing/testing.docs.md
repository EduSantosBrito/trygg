# Testing

Render a Component in an `@effect/vitest` suite, drive interactions, and assert on the resulting DOM and on the ordered framework events an interaction triggers — without a real browser.

```tsx
import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { Component, Signal } from "trygg";
import { render, click } from "trygg/testing";

const Counter = Component.gen(function* () {
  const count = yield* Signal.make(0);
  return <button onClick={() => Signal.update(count, (n) => n + 1)}>Count: {count}</button>;
});

describe("Counter", () => {
  it.scoped("increments on click", () =>
    Effect.gen(function* () {
      const result = yield* render(<Counter />);
      const button = yield* result.getByText("Count: 0");
      yield* click(button);
      expect((yield* result.queryByText("Count: 1"))._tag).toBe("Some");
    }),
  );
});
```

## When to use

Reach for `trygg/testing` whenever a test needs to mount trygg UI, dispatch DOM events, and assert on rendered output inside the Effect runtime.

- Pass `render` an `Element` — JSX such as `<Counter />` or `<div>…</div>` — for the common case; the rendered Component re-renders reactively as its Signals change.
- Pass `render` a bare `Effect` that yields an `Element` when you build the element inline; `render` wraps it in a Component so it still re-renders reactively.
- Use `renderElement` plus `testLayer` only when a test must control where the `Renderer` layer is provided; `render` provides it for you.
- Use `withRecording` when an assertion is about the ordered framework steps an interaction triggers, not the final DOM.

## Behavior

`render` and `renderElement` mount into a fresh container appended to `document.body` and return `TestRenderResult` query helpers. The container is removed by a finalizer when the test scope closes, so `it.scoped` is required — `render` reuses that scope rather than opening its own.

- Queries split by failure mode: `getBy*` (by `text`, `testId` — the `data-testid` attribute — or `role`) fail with a typed `ElementNotFoundError`, while the matching `queryBy*` return `Option`. For CSS selectors use `querySelector` (fails with `ElementNotFoundError`) or `queryBySelector` (returns `Option`); `querySelectorAll` returns a `ReadonlyArray`.
- `click` dispatches through the real DOM, then drains the scheduler, so handlers and the Signal updates they trigger settle before the next assertion. `type` sets `value` and fires `input` then `change`.
- `waitFor` retries on an Effect `Schedule` instead of wall-clock timers, so it composes with `TestClock`. Fork it, then advance `TestClock` to resolve a pending condition; it fails with `WaitForTimeoutError` when the budget runs out.
- `withRecording` installs a fresh in-memory `Trace.Recorder` for its scope only and resolves with the ordered `ReadonlyArray<Trace.TraceRecord>` the wrapped effect produced. Assert on `records.map((r) => r.name)` to lock the sequence of framework steps. The recorder is scope-local, so concurrent tests stay isolated.

## Related exports

- `render` — mount an Element or Effect, returning query helpers
- `renderElement` — mount when a test controls `Renderer` layer placement
- `testLayer` — the `Renderer` layer for manual provision
- `click` — dispatch a DOM click, then drain the scheduler
- `type` — set `value` and fire `input` then `change`
- `waitFor` — retry a condition on an Effect `Schedule`
- `withRecording` — record the ordered framework events an effect produces
- `Trace` — test-only event recorder re-export for manual recording

## Troubleshooting

- `render` called outside `it.scoped` leaks the container: the cleanup finalizer never runs without a closing scope. Use `it.scoped` (or provide a `Scope`) so the container is removed.
- A `getBy*` query fails with `ElementNotFoundError` right after `click`: the handler enqueued async work the helper did not await. Prefer the bundled `click`/`type`, which drain the scheduler, over calling `element.click()` directly.
- `waitFor` never resolves under `TestClock`: real time is frozen. Fork the `waitFor` effect, then call `TestClock.adjust` to advance past its interval.
- Need to assert names mid-scenario or reuse a recorder across steps: `withRecording` only yields its snapshot once it completes. Import `Trace` from `trygg/testing` and build the recorder yourself with `Trace.makeRecorder` and `Trace.record`, then read `recorder.records()` between steps.