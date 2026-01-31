# Production Readiness Remediation Spec

## Overview

Fix critical production blockers from review-prod.md. Work is split into themed PRs with no cross-dependencies.

**Status**: Ready for implementation  
**Total Effort**: 5 PRs (3x M, 2x L)  
**Execution Order**: PR 1 → PR 2 → PR 3 → PR 4 → PR 5

---

## PR 1: ErrorBoundary Critical Fixes (P0)

**Effort**: M (2-3 hours)  
**Files**: `packages/core/src/primitives/error-boundary.ts`, tests

### Deliverables

#### D1. Fix .provide regression
**Problem**: Wrapped component copies .provide from original, dropping error boundary when called.

**Change**:
- Build wrapped component using `Component.gen` instead of manual function
- Remove copying of `._layers` and `._requirements` from original
- Let `tagComponent` attach proper `.provide` method to wrapper

**Acceptance**:
- Calling `.provide(...)` on safe component preserves boundary behavior
- Child errors still render fallback after `.provide()` called
- Services provided via `.provide()` available inside wrapped tree
- `Component.isEffectComponent(SafeComponent)` remains true

**Test** (in `packages/core/src/primitives/__tests__/error-boundary.test.tsx`):
```typescript
it.scoped("provide preserves error boundary wrapper", () =>
  Effect.gen(function* () {
    const FailingComponent = Component.gen(function* () {
      yield* Effect.fail(new TestError());
      return <div>should not render</div>;
    });
    
    const SafeComponent = yield* ErrorBoundary
      .catch(FailingComponent)
      .catchAll(() => <div>fallback</div>);
    
    const ProvidedComponent = SafeComponent.provide(TestLayer);
    const element = ProvidedComponent({});
    
    // Render and assert fallback shown, not crash
  })
);
```

#### D2. Propagate handler requirements
**Problem**: Handler components requiring services (e.g., `ErrorTheme`) don't propagate to safe component type.

**Change**:
- Track handler requirements in builder state at runtime (currently only tracked in types)
- Merge requirements: original component R + all handler requirements
- Update `tagComponent` call to include merged requirements

**Acceptance**:
- `SafeRiskyComponent` type includes `ErrorTheme` when handler requires it
- Rendering without `ErrorTheme` fails early with tagged error
- Rendering with `ErrorTheme` works for both success and fallback paths

**Test**:
```typescript
it.scoped("propagates handler service requirements", () =>
  Effect.gen(function* () {
    const ErrorTheme = Context.GenericTag<string>("ErrorTheme");
    
    const RiskyComponent = Component.gen(function* () {
      yield* Effect.fail(new NetworkError());
      return <div />;
    });
    
    const ThemedFallback = Component.gen(function* () {
      const theme = yield* ErrorTheme;
      return <div class={theme}>error</div>;
    });
    
    const SafeComponent = yield* ErrorBoundary
      .catch(RiskyComponent)
      .on("NetworkError", () => <ThemedFallback />)
      .catchAll(() => <div>generic</div>);
    
    // Type check: SafeComponent should require ErrorTheme
    // Runtime: rendering without ErrorTheme fails with MissingServiceError
  })
);
```

#### D3. Replace sync throws with tagged errors
**Problem**: Builder uses `throw new Error` for invalid chains.

**Change**:
```typescript
// Instead of:
throw new Error("Cannot add .on() handler after .catchAll()");

// Use:
class ErrorBoundaryBuilderError extends Data.TaggedError("ErrorBoundaryBuilderError")<{
  reason: "after-catchall" | "duplicate-handler" | "multiple-catchall";
  tag?: string;
}> {}

return Effect.fail(new ErrorBoundaryBuilderError({ reason: "after-catchall" }));
```

**Acceptance**:
- `catchAll()` returns `Effect<Component, ErrorBoundaryBuilderError, Scope>`
- Invalid builder chains yield `Exit.Failure` with tagged error, not throw
- No `throw new Error` remains in error-boundary.ts

---

## PR 2: Type Safety & Cast Removal (P0)

**Effort**: M (2-3 hours)  
**Files**: `packages/core/src/primitives/component.ts`, `signal.ts`, `resource.ts`, `jsx-runtime.ts`, `router/outlet.ts`, `router/outlet-services.ts`

### Deliverables

#### D1. Remove type casting from component.ts
**Location**: Line 92 (per review)

**Change**: Replace `as` with proper type narrowing or explicit type parameters.

**Acceptance**: No `\bas\b` matches in component.ts (excluding test files).

#### D2. Fix Signal.suspend fallback
**Location**: Line 935 - `_textElementImpl!` usage

**Change**:
```typescript
// Instead of:
return _textElementImpl!({ content: "[Error: ...]" });

// Use:
if (!_textElementImpl) {
  return Effect.fail(new SignalInitError({ 
    reason: "element.ts not imported" 
  }));
}
return _textElementImpl({ content: "..." });
```

Or return a safe sentinel element without non-null assertion.

**Acceptance**: No `!` non-null assertions in signal.ts error paths.

#### D3. Remove cast from resource.ts  
**Location**: Line 421 - `error as E`

**Change**: Widen `Failure` to `unknown` or decode errors explicitly. Remove cast.

**Acceptance**: No `\bas\b` matches in resource.ts.

#### D4. Remove casts from router files
**Locations**: outlet.ts:679, outlet-services.ts:291

**Change**: Replace `as` assertions with proper type guards or tagged errors.

**Acceptance**: No `\bas\b` matches in router files.

---

## PR 3: JSX & Component Namespace (P0)

**Effort**: M (2-3 hours)  
**Files**: `packages/core/src/jsx-runtime.ts`, `index.ts`, `primitives/component.ts`, `primitives/renderer.ts`

### Deliverables

#### D1. Restore key propagation for Components
**Location**: jsx-runtime.ts line 96, 127

**Change**:
```typescript
// After line 127, wrap with keyed():
const element = type(resolvedProps);
return keyed(resolvedKey, element) as ElementFor<Type>;
```

**Acceptance**:
- `<MyComponent key="x" />` yields element where `getKey(element) === "x"`
- Keyed list reordering preserves DOM nodes for same key

**Test** (in `packages/core/src/primitives/__tests__/renderer.test.tsx`):
```typescript
it.scoped("preserves DOM nodes on keyed component reorder", () =>
  Effect.gen(function* () {
    const items = Signal.create([{ id: "a" }, { id: "b" }]);
    const Item = (props: { id: string }) => <div data-id={props.id} />;
    
    const List = Component.gen(function* () {
      const current = yield* Signal.get(items);
      return (
        <div>
          {current.map(item => <Item key={item.id} id={item.id} />)}
        </div>
      );
    });
    
    // Render, get DOM refs, reorder, assert same refs
  })
);
```

#### D2. Fix Component namespace export
**Problem**: `Component.gen` and `Component.Type` can't be used together.

**Change** in `packages/core/src/index.ts`:
```typescript
// Merge value and namespace properly
export declare namespace Component {
  export interface Type<Props = never, _E = never, _R = never> {
    readonly _tag: "EffectComponent";
    readonly _layers: ReadonlyArray<Layer.Layer.Any>;
    readonly _requirements: ReadonlyArray<Context.Tag<any, any>>;
    (props: [Props] extends [never] ? {} : Props): Element;
    
    provide<ROut, E2, RIn>(...): Component.Type<...>;
    provide<const Layers extends readonly [...]>(...): Component.Type<...>;
  }
}

// Ensure gen is available on the namespace
export interface ComponentApi {
  readonly gen: typeof componentGen;
  readonly isEffectComponent: typeof isEffectComponent;
}

export const Component: ComponentApi = Object.assign(ComponentFn, {
  gen: componentGen,
  isEffectComponent,
});
```

**Acceptance**:
```typescript
import { Component } from "trygg";

// Both should work without TS errors:
const MyComp: Component.Type<Props, Error, Req> = ...;
const Generated = Component.gen(function* () { ... });
```

**Test**: Add type-only test file that imports and uses both.

#### D3. Fix Provide context merging
**Location**: renderer.ts line 597

**Change**:
```typescript
Match.tag("Provide", ({ context: providedContext, child }) =>
  Effect.gen(function* () {
    // Merge parent context with provided context
    // provided wins on conflicts
    const mergedContext = Context.merge(parentContext, providedContext);
    return yield* renderElement(child, parent, runtime, mergedContext, options);
  })
),
```

**Acceptance**:
- Nested providers preserve parent services
- Child Provide adds without removing existing
- Same service overridden: inner wins

**Test**:
```typescript
it.scoped("merges parent and child contexts", () =>
  Effect.gen(function* () {
    const ServiceA = Context.GenericTag<number>("ServiceA");
    const ServiceB = Context.GenericTag<string>("ServiceB");
    
    const Child = Component.gen(function* () {
      const a = yield* ServiceA;
      const b = yield* ServiceB;
      return <div data-a={a} data-b={b} />;
    });
    
    const Parent = Component.gen(function* () {
      return (
        <Provide context={Context.make(ServiceA, 1)}>
          <Provide context={Context.make(ServiceB, "b")}>
            <Child />
          </Provide>
        </Provide>
      );
    });
    
    // Assert Child receives both services
  })
);
```

---

## PR 4: Router Error Handling (P1)

**Effort**: L (1-2 days)  
**Files**: `packages/core/src/router/outlet.ts`, `outlet-services.ts`

### Deliverables

#### D1. Replace decodeUnknownSync
**Locations**: outlet.ts:121, outlet-services.ts (toRouteParams)

**Change**:
```typescript
// Instead of:
const result = Schema.decodeUnknownSync(RouteParamsSchema)(decodedParams);

// Use:
yield* Schema.decodeUnknown(RouteParamsSchema)(decodedParams).pipe(
  Effect.mapError((parseError) => new RenderLoadError({ cause: parseError }))
);
```

**Acceptance**:
- No `Schema.decodeUnknownSync` in router files
- Invalid params surface as `Exit.Failure` with `RenderLoadError`

#### D2. Replace Effect.die/dieMessage
**Locations**: 6 occurrences across outlet.ts and outlet-services.ts

**Change**:
```typescript
// Instead of:
return Effect.dieMessage("Invalid RouteComponent...");

// Use:
class InvalidRouteComponentError extends Data.TaggedError("InvalidRouteComponentError")<{
  received: unknown;
  expected: "Component" | "Effect<Element>";
}> {}

return Effect.fail(new InvalidRouteComponentError({ received: comp, expected: "Component" }));
```

**Acceptance**:
- No `Effect.die` or `Effect.dieMessage` in router runtime code
- Invalid route components yield tagged errors, not defects

**Test**:
```typescript
it.scoped("invalid route component yields RenderLoadError, not defect", () =>
  Effect.gen(function* () {
    const route = { 
      path: "/test", 
      component: "not-a-component" // invalid
    };
    
    const exit = yield* Effect.exit(renderRoute(route));
    
    assertTrue(Exit.isFailure(exit));
    assertTrue(Cause.isFail(Exit.cause(exit)));
    // Not Cause.isDie
  })
);
```

---

## PR 5: Tests & Tooling (P1)

**Effort**: L (1-2 days)  
**Files**: Tests across packages, `.oxlintrc.json`, docs

### Deliverables

#### D1. Add missing tests
**Coverage needed**:
- SafeComponent.provide retains error boundary (PR 1)
- Handler requirements propagation (PR 1)
- SignalInitError/fallback paths (PR 2)
- Key propagation on Component JSX (PR 3)
- Invalid route params handling (PR 4)
- Context merge in nested Provide (PR 3)

#### D2. Fix scope leaks in tests
**Location**: `packages/core/src/primitives/__tests__/component.test.tsx:540`

**Change**: Convert `it(...)` to `it.scoped(...)` where `render` is used.

**Acceptance**: No `render(` usage inside plain `it(...)` blocks.

#### D3. Fix oxlint portability
**Changes**:
- `.oxlintrc.json`: Use relative path `./packages/oxlint-plugin/dist/index.js`
- Add to `.gitignore`: `packages/oxlint-plugin/dist/`, `packages/oxlint-plugin/node_modules/`

**Acceptance**:
- `oxlint` runs from repo root without editing paths
- `git status` clean after building plugin

#### D4. Remove effect-ui naming
**Search and replace** in:
- All docs (`docs/*.md`)
- Templates
- README files
- CLI output

**Acceptance**: `rg "effect-ui"` yields zero matches in user-facing files.

---

## Execution Order

1. **PR 1**: ErrorBoundary fixes (highest risk behavior regressions)
2. **PR 2**: Type safety/cast removal (foundational)
3. **PR 3**: JSX & Component namespace (user-facing APIs)
4. **PR 4**: Router error handling (can be parallel with PR 3)
5. **PR 5**: Tests & tooling (depends on PR 1-4 for test coverage)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Component namespace export complexity | Test type inference in both core and examples before merging |
| Context merge edge cases | Document precedence rule; test override scenarios |
| Handler requirements over-declaration | Acceptable trade-off per user direction; document |
| Test coverage gaps | Each PR includes specific acceptance tests |

---

## Open Questions

None remaining. Spec approved for implementation.
