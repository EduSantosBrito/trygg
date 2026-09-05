import { assert, describe, it } from "@effect/vitest";
import * as Trace from "../index.js";

describe("Trace payload types", () => {
  it("should correlate event names with required exact payload facts", () => {
    // Test: should correlate event names with required exact payload facts
    // Scope: compile-time contract for one representative catalog event.
    // Assertion: missing, extra, and incorrectly typed facts remain rejected by TypeScript.
    const valid = {
      signal_id: "s1",
      listener_count: 1,
    } satisfies Trace.TraceEventPayload<"signal.notify">;

    // @ts-expect-error listener_count is required for signal.notify
    const missing: Trace.TraceEventPayload<"signal.notify"> = { signal_id: "s1" };

    const extra: Trace.TraceEventPayload<"signal.notify"> = {
      signal_id: "s1",
      listener_count: 1,
      // @ts-expect-error extra facts are not part of the signal.notify vocabulary
      extra: true,
    };

    const wrongType: Trace.TraceEventPayload<"signal.notify"> = {
      signal_id: "s1",
      // @ts-expect-error listener_count must be numeric
      listener_count: "one",
    };

    const validEmit = Trace.emit("signal.notify", () => ({
      signal_id: "s1",
      listener_count: 1,
    }));
    // @ts-expect-error payload-bearing events require their payload thunk
    const missingEmit = Trace.emit("signal.notify");
    // @ts-expect-error emit requires every fact in the selected event schema
    const missingFactEmit = Trace.emit("signal.notify", () => ({ signal_id: "s1" }));
    // @ts-expect-error emit rejects facts outside the event vocabulary
    const extraEmit = Trace.emit("signal.notify", () => ({
      signal_id: "s1",
      listener_count: 1,
      extra: true,
    }));
    // @ts-expect-error emit preserves the selected event's field types
    const wrongTypeEmit = Trace.emit("signal.notify", () => ({
      signal_id: "s1",
      listener_count: "one",
    }));
    const extraVariable = { signal_id: "s1", listener_count: 1, extra: true };
    // @ts-expect-error emitPayload rejects extra facts carried through an inferred variable
    const extraVariableEmit = Trace.emitPayload("signal.notify", () => extraVariable);
    const wrongTypeVariable = { signal_id: "s1", listener_count: "one" };
    // @ts-expect-error emitPayload preserves field types for inferred variables
    const wrongTypeVariableEmit = Trace.emitPayload("signal.notify", () => wrongTypeVariable);
    const validVariable = { signal_id: "s1", listener_count: 1 };
    const validVariableEmit = Trace.emitPayload("signal.notify", () => validVariable);

    const validRequest = {
      method: "GET",
      pathname: "/api/session",
    } satisfies Trace.TraceEventPayload<"api.request.received">;
    // @ts-expect-error request telemetry requires the query-free pathname fact
    const missingPathname: Trace.TraceEventPayload<"api.request.received"> = { method: "GET" };
    const legacyRequest: Trace.TraceEventPayload<"api.request.received"> = {
      method: "GET",
      pathname: "/api/session",
      // @ts-expect-error query-bearing url is not part of the request telemetry vocabulary
      url: "/api/session?token=sentinel-secret",
    };
    const legacyRequestVariable = {
      method: "GET",
      pathname: "/api/session",
      url: "/api/session?token=sentinel-secret",
    };
    const legacyRequestEmit = Trace.emitPayload(
      "api.request.received",
      // @ts-expect-error emitPayload rejects legacy url facts carried through a variable
      () => legacyRequestVariable,
    );

    assert.strictEqual(
      [
        valid,
        missing,
        extra,
        wrongType,
        validEmit,
        missingEmit,
        missingFactEmit,
        extraEmit,
        wrongTypeEmit,
        extraVariableEmit,
        wrongTypeVariableEmit,
        validVariableEmit,
        validRequest,
        missingPathname,
        legacyRequest,
        legacyRequestEmit,
      ].length,
      16,
    );
  });
});
