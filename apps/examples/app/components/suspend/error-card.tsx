import { Cause } from "effect";
import { Component, type ComponentProps } from "effect-ui";

export const ErrorCard = Component.gen(function* (
  Props: ComponentProps<{ label: string; cause: Cause.Cause<unknown> }>,
) {
  const { label, cause } = yield* Props;
  return (
    <div className="p-3 rounded-md border border-red-200 bg-red-50 text-red-600">
      <strong className="block mb-1">{label} failed</strong>
      <p className="m-0 text-sm">{String(Cause.squash(cause))}</p>
    </div>
  );
});
