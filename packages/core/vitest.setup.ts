/**
 * Vitest setup for trygg tests
 *
 * Configures custom equality testers for Effect data types.
 */
import { expect } from "vitest";
import * as Equal from "effect/Equal";
import * as Utils from "effect/Utils";
import type { Tester, TesterContext } from "@vitest/expect";

/**
 * Custom equality tester for Effect's Equal trait
 * Allows vitest assertions to work with Effect data types
 */
function customTester(this: TesterContext, a: unknown, b: unknown, customTesters: Array<Tester>) {
  if (!Equal.isEqual(a) || !Equal.isEqual(b)) {
    return undefined;
  }
  return Utils.structuralRegion(
    () => Equal.equals(a, b),
    (x, y) =>
      this.equals(
        x,
        y,
        customTesters.filter((t) => t !== customTester),
      ),
  );
}

// Add custom equality testers for Effect data types
expect.addEqualityTesters([customTester]);
