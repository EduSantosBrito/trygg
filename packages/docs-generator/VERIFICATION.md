# Docs Generator Verification

## Run the generator
```bash
cd /Users/brito/Dev/trygg
bun run packages/docs-generator/src/cli.ts generate
```

## Check outputs
```bash
# Raw TypeDoc AST
ls -lh tmp/reflection.json

# Generated documentation
ls -lh apps/docs/src/generated/documentation.json

# Preview structure
head -100 apps/docs/src/generated/documentation.json | jq
```

## Verify validation
```bash
# Run with strict validation
bun run packages/docs-generator/src/cli.ts generate --strict

# Should report missing documentation
```

## Expected results
- `reflection.json` created (several MB)
- `documentation.json` created (500KB+)
- Console shows: "✅ TypeDoc extraction complete"
- Console shows: "✅ Documentation transformation complete"  
- Console shows: "✅ Documentation generation complete"
- Validation stats (warnings for missing docs are OK)
