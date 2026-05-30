# Debug

## When to use

Use `Debug` when you want human-readable console output for Trygg's trace catalog. Framework internals emit through `Trace.emit`; `Debug` installs ordinary Effect loggers that format those catalog records for people.

## Behavior

`Debug` has no process-global enable flag and no plugin registry. Output is scoped by Effect context:

- `Debug.consoleLogger` pretty-prints trace records and passes non-trace `Effect.log` messages through plainly.
- `Debug.layer(options)` installs the console logger for a component subtree or Effect program while preserving ambient trace recorders/tracers.
- `options.minLevel` controls which trace levels are observed.
- `options.filter` keeps only catalog names matching one or more prefixes.
- `options.batchWindow` batches console writes over an Effect duration.

Console writes are best-effort: a failing or patched `console.log` must not break framework work.

For tests and machine assertions, use `Trace.makeRecorder` with `Trace.record` or `trygg/testing.withRecording` instead of the console logger.

## Related exports

- `Debug.consoleLogger`
- `Debug.layer`
- `Debug.DebugOptions`
- `Debug.DebugFilter`
