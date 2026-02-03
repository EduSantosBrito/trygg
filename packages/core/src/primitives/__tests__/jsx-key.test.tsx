/**
 * JSX Key Propagation Tests
 *
 * Verifies that JSX `key` prop is correctly propagated to both
 * intrinsic and Component elements via the jsx() runtime function.
 *
 * Bug: resolvedKey was discarded at jsx-runtime.ts for Component elements.
 * Fix: apply keyed() after type(resolvedProps) call.
 *
 * Goals: Regression coverage
 * - String keys on Component elements
 * - Numeric keys on Component elements
 * - Null/undefined keys (no key) on Component elements
 * - String keys on intrinsic elements (existing behavior, sanity check)
 * - Numeric keys on intrinsic elements (existing behavior, sanity check)
 */
import { assert, describe, it } from "@effect/vitest";
import * as Component from "../component.js";
import { getKey } from "../element.js";

const SimpleComponent = Component.gen(function* () {
  return <div>hello</div>;
});

// =============================================================================
// Component element key propagation
// =============================================================================

describe("jsx key on Component elements", () => {
  it("should propagate string key to Component element", () => {
    const element = <SimpleComponent key="my-key" />;

    assert.strictEqual(getKey(element), "my-key");
  });

  it("should propagate numeric key to Component element", () => {
    const element = <SimpleComponent key={42} />;

    assert.strictEqual(getKey(element), 42);
  });

  it("should leave key null when no key provided", () => {
    const element = <SimpleComponent />;

    assert.isNull(getKey(element));
  });
});

// =============================================================================
// Intrinsic element key propagation (sanity checks)
// =============================================================================

describe("jsx key on intrinsic elements", () => {
  it("should propagate string key to intrinsic element", () => {
    const element = <div key="div-key" />;

    assert.strictEqual(getKey(element), "div-key");
  });

  it("should propagate numeric key to intrinsic element", () => {
    const element = <span key={7} />;

    assert.strictEqual(getKey(element), 7);
  });
});
