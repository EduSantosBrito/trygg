# Testing

## Mindset

- Follow SQLite's mentality: tests are part of the product, not cleanup after implementation.
- A bug is not fixed until a test reproduces it and prevents regression.
- Prefer many focused tests over a few broad tests.
- Cover boundary values aggressively. Bugs cluster at edges.
- For important paths, test hostile conditions, not just happy paths.
- No test should leak resources.

## Assertion Rule

- Follow the golden rule of assertions: a test must fail if, and only if, the intended behavior is broken.
- Assert outcomes, externally visible behavior, and contract boundaries.
- Do not assert implementation details unless the implementation detail is itself the contract.
- Ask of every assertion: when will this fail? If the answer includes harmless refactors, the assertion is wrong.
- Keep test scope tight. Mock or control dependencies that add noise without adding signal at that test level.

## TDD Loop

- Fix bugs and build behavior with red-green-refactor.
- Red: write the smallest failing test that captures the intended behavior.
- Green: make the test pass with the simplest correct implementation.
- Refactor: improve code and tests while keeping the suite green.
- After refactoring, rerun the relevant suite and keep the behavioral assertions unchanged.

## Required Test Structure

Every test should include these 3 parts, in code or immediately-adjacent comments:

- `Test`: `should X do <not> Y while Z`
- `Scope`: why this case matters and what boundary of the system it covers
- `Assertion`: the acceptance criteria and expected observable outcome

Example:

```ts
it.effect("should return cached value while network is unavailable", () =>
  Effect.gen(function* () {
    // Scope: verifies offline fallback at the cache/network boundary.
    // Assertion: returns the cached value and does not surface a transport failure.
  }),
)
```

## Required Patterns

- Use `@effect/vitest`.
- Use `TestClock`, not `Effect.sleep`, for time-based behavior.
- Test helpers should return `Effect`s.
- Cover both success and failure paths.
- Cover boundary values: empty, zero, one, negative, max, and `undefined` where relevant.
- For critical logic, add regression coverage for previously-fixed bugs.

## Stress Cases

- For resourceful or concurrent code, test interruption, cleanup, and failure paths.
- For I/O-heavy or stateful code, simulate partial failure where practical: OOM-like allocation failure, dropped or reordered I/O, and crash/recovery boundaries.
- For parser-like or boundary-heavy code, include malformed input coverage.
- For critical paths, include performance-sensitive coverage when regressions would matter.
