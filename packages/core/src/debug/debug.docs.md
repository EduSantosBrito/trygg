# Debug

See framework lifecycle events — renders, signal writes, navigations — as readable console output scoped to one subtree, instead of reaching for a global debug flag.

```tsx
import { Component, Debug } from "trygg";
import { App } from "./app.js";

// Stream trace records for this subtree to the console, signal events only.
const Debugged = App.pipe(Component.provide(Debug.layer({ minLevel: "Trace", filter: "signal" })));
```

## When to use

Use `Debug` when you want human-readable console output for Trygg's lifecycle events. Framework internals emit these records; `Debug` installs ordinary Effect loggers that format them for people.

## Behavior

`Debug` has no process-global enable flag and no plugin registry. Output is scoped by Effect context:

- `Debug.consoleLogger` pretty-prints trace records and passes non-trace `Effect.log` messages through plainly.
- `Debug.layer(options)` replaces the nearest Debug-owned console logger for a component subtree while preserving independent trace recorders, tracers, and application loggers. Nested filters therefore override outer Debug output instead of duplicating or leaking events.
- `options.minLevel` controls which trace levels are observed.
- `options.filter` keeps only catalog names matching one or more prefixes.
- `options.batchWindow` batches console writes over an Effect duration.

Console writes are best-effort: a failing or patched `console.log` must not break framework work.
Debug receives only immutable, Schema-validated Trace records. Application values are rendered as primitive type classifications, and replaying a captured Trace annotation does not duplicate console output.

For tests and machine assertions, use `trygg/testing.withRecording` instead of the console logger.

## Related exports

- `Debug.consoleLogger` — pretty-prints trace records, passes other logs through
- `Debug.layer` — installs the console logger for a subtree
- `Debug.DebugOptions` — options for `layer`: minLevel, filter, batchWindow
- `Debug.DebugFilter` — catalog-name prefixes kept by `options.filter`
