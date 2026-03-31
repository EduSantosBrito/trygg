# Resource

## When to use

Use `Resource` when async data should be cached by key, deduplicated across callers, and exposed as reactive state to components.

## Behavior

`Resource.make` defines a keyed fetch descriptor. `Resource.fetch` returns a signal of `Pending`, `Success`, or `Failure`, and reactive params can swap the backing resource key without replacing the output signal. `Resource.invalidate` keeps stale data visible during background refetch; `Resource.refresh` forces a hard pending transition.

## Related exports

- `Resource.make`
- `Resource.fetch`
- `Resource.match`
- `Resource.invalidate`
- `Resource.refresh`
- `Resource.clear`
