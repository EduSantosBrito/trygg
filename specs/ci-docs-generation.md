# CI/CD Documentation Generation Spec

**Status**: Ready for implementation  
**Effort**: L (1-2 days)  
**Type**: Feature (documentation system)

---

## Problem

Currently, trygg has zero auto-generated API documentation. The codebase has some JSDoc comments but they're not extracted or rendered anywhere. Developers must read source code directly to understand the API.

**Cost of not solving**: 
- New users can't discover APIs without reading source
- No searchable reference documentation
- Documentation becomes stale as code changes
- No "single source of truth" for API contracts

---

## Discovery

### Existing System

- **Framework**: Effect-native UI framework with JSX
- **Source structure**: `packages/core/src/` contains framework code
- **Build**: Rolldown + TypeScript, outputs to `dist/`
- **Comments**: ~100+ JSDoc blocks already in codebase (jsx-runtime.ts, renderer.ts, element.ts, error-boundary.ts, etc.)
- **Path mapping**: Uses `#jsx/*` aliases and `effect-ui/*` exports

### Reference: SST Documentation Pipeline

SST (https://sst.dev) uses:
1. **TypeDoc** - Parses TypeScript source, outputs reflection JSON
2. **Custom generator** (~2300 lines) - Transforms TypeDoc AST → MDX
3. **Astro Starlight** - Static site generation
4. **Auto-deploy** - Via SST Console on every push

**Key insight**: TypeDoc is parser-only. SST doesn't use TypeDoc's HTML output. They extract the reflection tree and render custom MDX with their own components.

### TSDoc vs JSDoc

**Use TSDoc** (Microsoft's TypeScript doc standard):
- No redundant `@param {type}` annotations (TypeScript knows types)
- Native support for `@typeParam` (generics)
- Better tool interoperability
- TypeDoc has full TSDoc support

---

## Constraints

| Constraint | Value |
|------------|-------|
| **Output** | trygg app in `apps/docs/` |
| **CI/CD** | Generate on push to main |
| **Versions** | Latest only (no versioning yet) |
| **Source** | `packages/core/src/` only |
| **Search** | Optional (deferred for now) |
| **Quality** | C# docs level (comprehensive, well-organized) |
| **Style** | Similar to Elixir Hex docs structure |
| **Mandatory** | All public APIs must have docs (CI fails without) |

---

## Solution Space

### Option A: TypeDoc + Custom MDX → trygg render (Recommended)

**Flow:**
```
packages/core/src/**/*.ts 
    → TypeDoc (reflection.json)
    → Custom generator (transform to TS/JSON)
    → apps/docs/src/generated/
    → trygg build → Static site
```

**Pros:**
- Full control over output format
- Can use trygg components for rendering
- Easy to customize for Effect-specific types
- No external SSG dependency

**Cons:**
- Need to write custom generator (~500-1000 lines)
- More initial setup

**Effort**: L (1-2 days)

### Option B: TypeDoc HTML output + iframe

Use TypeDoc's built-in HTML generation, embed in trygg app via iframe.

**Pros:**
- Minimal code to write
- TypeDoc handles all rendering

**Cons:**
- Ugly, doesn't match trygg branding
- No full-text search integration
- Can't customize for Effect types

**Effort**: S (< 1 day)
**Verdict**: ❌ Rejected - doesn't meet quality bar

### Option C: VitePress + TypeDoc plugin

Use VitePress with typedoc-plugin-markdown.

**Pros:**
- Mature ecosystem
- Built-in search

**Cons:**
- Not a trygg app (violates constraint)
- Extra dependency
- Less control over rendering

**Effort**: S (< 1 day)
**Verdict**: ❌ Rejected - must be trygg app

---

## Recommendation

**Option A**: TypeDoc + Custom generator → trygg app

**Rationale:**
- Only option that satisfies all constraints
- Allows us to build docs *with* trygg (dogfooding)
- Custom generator lets us handle Effect-specific types (Layer, Effect, Stream, etc.)
- Full control over UI/UX for C#-level quality

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CI/CD Pipeline                           │
│  Push to main → GitHub Action → Generate docs → Deploy       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Documentation Generator                     │
│                                                              │
│  1. Run TypeDoc on packages/core/src                         │
│     → outputs reflection.json (AST of all types/docs)        │
│                                                              │
│  2. Custom generator scripts/generate-docs.ts                │
│     → Parse reflection.json                                  │
│     → Extract JSDoc/TSDoc comments                           │
│     → Transform to typed structures                          │
│     → Generate (flat API structure):                         │
│       - apps/docs/src/generated/api/*.ts (one per export)    │
│       - apps/docs/src/generated/navigation.json              │
│                                                              │
│  3. Validate: Fail CI if public API lacks docs               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Documentation App (trygg)                 │
│                                                              │
│  apps/docs/                                                  │
│  ├── src/                                                    │
│  │   ├── generated/          ← Auto-generated (don't edit)   │
│  │   │   ├── api/                                            │
│  │   │   │   ├── Component.ts                                │
│  │   │   │   ├── Renderer.ts                                 │
│  │   │   │   ├── Router.ts                                   │
│  │   │   │   ├── Signal.ts                                   │
│  │   │   │   └── ... (flat structure: one file per export)   │
│  │   │   └── navigation.json.ts                              │
│  │   ├── components/                                         │
│  │   │   ├── DocLayout.ts      ← Page layout                 │
│  │   │   ├── Sidebar.ts        ← Navigation sidebar          │
│  │   │   ├── TypeSignature.ts  ← Renders Effect types        │
│  │   │   └── DocComment.ts     ← Renders JSDoc/TSDoc         │
│  │   ├── pages/                                              │
│  │   │   ├── index.ts          ← Home page                   │
│  │   │   └── api/                                            │
│  │   │       ├── index.ts      ← API reference index         │
│  │   │       └── [name].ts     ← Dynamic route for each API  │
│  │   └── main.ts                                             │
│  ├── package.json                                            │
│  └── sst.config.ts (or deployment config)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Deliverables (Ordered)

### Phase 1: Foundation (Day 1)

**[D1] Documentation generator package** (M) — depends on: -

Create `packages/docs-generator/`:
- `src/typedoc-extractor.ts` - Run TypeDoc, get reflection.json
- `src/transformer.ts` - Transform TypeDoc AST to our format
- `src/generator.ts` - Write generated files to apps/docs/src/generated/
- `src/validator.ts` - Ensure all public exports have docs

Handle trygg-specific types:
- Effect types (Effect<A, E, R>)
- Layer types
- Stream types
- Component types
- Signal types

**[D2] Documentation app shell** (M) — depends on: D1

Create `apps/docs/`:
- `package.json` with trygg dependency
- `src/main.ts` - Entry point
- `src/components/DocLayout.ts` - Basic layout
- `src/components/Sidebar.ts` - Navigation from generated data
- `src/pages/index.ts` - Home page
- `src/pages/api/index.ts` - API reference index

**[D3] Local development mode** (S) — depends on: D1

Add to root `package.json`:
```json
{
  "scripts": {
    "docs:dev": "bun run --cwd packages/docs-generator dev",
    "docs:build": "bun run --cwd packages/docs-generator build"
  }
}
```

Create `packages/docs-generator/src/dev-mode.ts`:
- Generate docs from current source
- Start trygg dev server for apps/docs
- Watch for file changes and auto-regenerate

### Phase 2: CI/CD Integration (Day 2)

**[D4] GitHub Actions workflow** (S) — depends on: D1

Create `.github/workflows/docs.yml`:
- Trigger: push to main
- Run docs generator
- Fail if validation fails (missing docs)
- Build apps/docs
- Deploy to GitHub Pages (or other hosting)

**[D5] Documentation validation** (S) — depends on: D1

In `packages/docs-generator/src/validator.ts`:
- Check all exported functions/classes have JSDoc/TSDoc
- Check all public members are documented
- Configurable exceptions (@internal, @private)

**[D6] Documentation quality standards** (S) — depends on: -

Create `docs/documentation-standards.md`:
- TSDoc style guide
- Required tags (@param, @returns, @example)
- Writing style guidelines

---

## Technical Details

### TypeDoc Configuration

```json
{
  "entryPoints": ["packages/core/src/index.ts"],
  "tsconfig": "packages/core/tsconfig.json",
  "skipErrorChecking": true,
  "jsDocCompatibility": {
    "defaultTag": false,
    "exampleTag": true
  },
  "excludePrivate": true,
  "excludeProtected": false,
  "excludeExternals": true,
  "output": "tmp/reflection.json"
}
```

### Generated Data Structure

```typescript
// apps/docs/src/generated/api/components.json.ts
export const componentsModule = {
  name: "components",
  description: "Core UI components for trygg",
  exports: [
    {
      name: "Component",
      kind: "interface",
      description: "Base interface for all trygg components",
      typeParameters: [
        { name: "R", description: "Required services/effects" }
      ],
      examples: [
        "const MyComp = Component.gen(function* () { ... })"
      ],
      source: {
        file: "packages/core/src/primitives/component.ts",
        line: 45
      }
    }
  ]
} as const;
```

---

## Decisions

| Topic | Decision |
|-------|----------|
| **API Structure** | Flat (alphabetical) - `/api/Component`, `/api/Renderer` |
| **Search** | Deferred - not in v1 |
| **Local dev** | Yes - `bun run docs:dev` with watch mode |
| **Type rendering** | Link to Effect docs for standard types |
| **Hosting** | TBD - not needed for local dev |

---

## Open Questions

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TypeDoc fails on complex types | Medium | High | Use `skipErrorChecking: true`, patch problematic files |
| Generator maintenance burden | Medium | Medium | Keep generator simple, document extension points |
| CI time increase | Low | Low | Cache TypeDoc output, parallel builds |

---

## Success Criteria

- [ ] All public APIs in packages/core have documentation
- [ ] Local dev mode works: `bun run docs:dev` generates and serves
- [ ] CI fails if public API lacks JSDoc/TSDoc
- [ ] Documentation updates automatically on push to main
- [ ] Generated docs match or exceed C# docs quality
- [ ] Mobile-responsive documentation site

---

## Next Steps

1. Create `packages/docs-generator/` with TypeDoc extraction
2. Set up `apps/docs/` with basic trygg app structure
3. Implement transformer for flat API structure
4. Add local dev mode with watch
5. Create GitHub Actions workflow
6. Document the documentation standards

**Owner**: @EduSantosBrito  
**Target completion**: 2 days  
**Dependencies**: None (greenfield implementation)
