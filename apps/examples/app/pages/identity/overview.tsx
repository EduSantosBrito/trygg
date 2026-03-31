import { Effect } from "effect";
import { Component, Signal } from "trygg";

let nextMountId = 1;

const IdentityOverview = Component.gen(function* () {
  const mountId = yield* Signal.make(nextMountId++);
  const localCount = yield* Signal.make(0);
  const note = yield* Signal.make("type here, then toggle the layout theme");

  const incrementLocalCount = () => Signal.update(localCount, (value) => value + 1);

  const onInput = (event: Event) =>
    Effect.sync(() => {
      const target = event.target;
      return target instanceof HTMLInputElement ? target.value : "";
    }).pipe(Effect.flatMap((value) => Signal.set(note, value)));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="m-0 mb-1 text-lg font-semibold text-gray-900">Outlet child probe</h3>
        <p className="m-0 text-sm text-gray-600">
          This child should keep its local state and mount id while the parent layout rerenders.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-white/70 bg-white/80 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-400">Mount id</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{mountId}</div>
        </div>
        <div className="rounded-lg border border-white/70 bg-white/80 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-400">Local count</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{localCount}</div>
        </div>
        <div className="rounded-lg border border-white/70 bg-white/80 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-400">Expected result</div>
          <div className="mt-2 text-sm font-medium text-gray-700">
            Rerendering the layout should not reset this child.
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/70 bg-white/80 p-4">
        <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="identity-note">
          Local child input
        </label>
        <input
          id="identity-note"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
          value={note}
          onInput={onInput}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:border-gray-400"
            onClick={incrementLocalCount}
          >
            Increment local count
          </button>
          <span className="text-sm text-gray-500">
            Expected after layout rerender: same mount id, count, and input text.
          </span>
        </div>
      </div>
    </div>
  );
});

export default IdentityOverview;
