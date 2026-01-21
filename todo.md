# TODO - API Review

Review these features to determine if they're still needed or can be removed.

## Signal

- [ ] **Signal.resource** - Can we use Signal.suspend instead? Seems redundant. **REMOVE**
- [ ] **Signal.watch** - Identical to Signal.get (adds to accessed, returns value). Only difference: requires Scope in type. **REMOVE** - just use Signal.get
- [x] **Signal.modify** - Returns old value while setting new. Useful single-operation pattern. **KEEP**
- [ ] **Signal.changes** - Exposes SubscriptionRef stream. No clear use case for users. **REMOVE**

## Renderer

- [x] **render function** - Internal only (not exported from index.ts). No action needed.
- [x] **Provide element** - Used internally by Component.provide. Marked @internal. **KEEP**

## Component

- [ ] **isLegacyComponent** - Defined but never used. Leftover. **REMOVE**

## Router

- [ ] **NavLink** - Deprecated per docs. **REMOVE**
