import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Predicate } from "effect";
import { defineConfig, type TryggConfig } from "../config.js";

describe("configuration boundary", () => {
  for (const field of ["platform", "output"]) {
    it.effect(`should identify an invalid runtime ${field} with a project-owned error`, () =>
      Effect.gen(function* () {
        // Scope: JavaScript can supply unsupported values despite the TypeScript annotation.
        // Assertion: the synchronous boundary throws TryggConfigError and retains its decode cause.
        const config: TryggConfig = { platform: "node", output: "server" };
        Reflect.set(config, field, "unsupported");
        const exit = yield* Effect.try(() => defineConfig(config)).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = exit.cause.reasons.find(Cause.isFailReason)?.error.cause;
          assert.isTrue(Predicate.isTagged(error, "TryggConfigError"));
          if (Predicate.isTagged(error, "TryggConfigError")) {
            assert.isTrue(Predicate.hasProperty(error, "cause"));
            if (Predicate.hasProperty(error, "cause")) assert.isDefined(error.cause);
          }
        }
      }),
    );
  }

  it("should preserve every supported runtime and output value", () => {
    // Scope: decoding remains synchronous and keeps the public configuration shape.
    // Assertion: every literal combination round-trips; deployment compatibility remains the plugin's concern.
    const platforms: ReadonlyArray<TryggConfig["platform"]> = ["node", "bun", "cloudflare"];
    const outputs: ReadonlyArray<TryggConfig["output"]> = ["server", "static"];
    for (const platform of platforms) {
      for (const output of outputs)
        assert.deepStrictEqual(defineConfig({ platform, output }), { platform, output });
    }
  });
});
