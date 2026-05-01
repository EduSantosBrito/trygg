import { Effect } from "effect";
import { Component, Signal } from "trygg";
import * as Router from "trygg/router";

type LinkProbeStatus = "not checked" | "remembered" | "same node" | "replaced";

const IdentityLayout = Component.gen(function* () {
  const layoutTick = yield* Signal.make(0);
  const linkProbe = yield* Signal.make<LinkProbeStatus>("not checked");
  const rememberedLink = yield* Signal.make<HTMLAnchorElement | null>(null);

  const tick = yield* Signal.get(layoutTick);
  const linkProbeStatus = yield* Signal.get(linkProbe);

  const bumpLayout = () => Signal.update(layoutTick, (value) => value + 1);

  const rememberLinkNode = () =>
    Effect.sync(() => {
      const node = document.querySelector('[data-testid="identity-link-probe"]');
      return node instanceof HTMLAnchorElement ? node : null;
    }).pipe(
      Effect.flatMap((node) => Signal.set(rememberedLink, node)),
      Effect.flatMap(() => Signal.set(linkProbe, "remembered")),
    );

  const compareLinkNode = () =>
    Effect.gen(function* () {
      const remembered = yield* Signal.peek(rememberedLink);
      const current = document.querySelector('[data-testid="identity-link-probe"]');
      const currentAnchor = current instanceof HTMLAnchorElement ? current : null;

      yield* Signal.set(
        linkProbe,
        remembered !== null && remembered === currentAnchor ? "same node" : "replaced",
      );
    });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="m-0 mb-1 text-xl font-semibold">Identity Preservation</h2>
        <p className="m-0 text-sm text-gray-500">
          Manual probe for `Router.Link` and `Router.Outlet` stability across parent rerenders.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <aside className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Layout state
          </div>

          <div className="mb-4 rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-600">
            <div>Layout rerenders: {tick}</div>
            <div>Link DOM probe: {linkProbeStatus}</div>
          </div>

          <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            <div className="mb-2 font-medium text-gray-800">Try this</div>
            <div>1. Remember current Link node</div>
            <div>2. Rerender layout</div>
            <div>3. Compare remembered Link node</div>
            <div className="mt-2">Expected: same node, same mount id, same child input text.</div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:border-gray-400"
              onClick={bumpLayout}
            >
              Rerender layout
            </button>
            <button
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:border-gray-400"
              onClick={rememberLinkNode}
            >
              Remember current Link node
            </button>
            <button
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:border-gray-400"
              onClick={compareLinkNode}
            >
              Compare remembered Link node
            </button>
          </div>

          <div className="mt-5 flex flex-col gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            <div className="font-medium text-gray-800">Link probe</div>
            <Router.Link
              data-testid="identity-link-probe"
              to="/counter"
              className="inline-flex items-center rounded-md border border-gray-200 px-3 py-2 text-sm text-blue-600 no-underline transition-colors hover:border-blue-200 hover:bg-blue-50"
            >
              Counter link should keep the same DOM node
            </Router.Link>
          </div>
        </aside>

        <div className="rounded-xl border border-gray-200 bg-slate-50 p-5">
          <Router.Outlet />
        </div>
      </div>
    </div>
  );
});

export default IdentityLayout;
