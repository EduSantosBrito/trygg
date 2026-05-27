import { Effect } from "effect";
import { Component, Signal, type ComponentProps } from "trygg";
import * as Router from "trygg/router";

import { sidebarGroups } from "../content/sidebar";

interface DocsSidebarProps {
  readonly onNavigate?: () => Effect.Effect<void>;
}

const ChevronDown = Component.gen(function* () {
  return (
    <svg
      aria-hidden="true"
      className="docs-sidebar__chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
});

export const DocsSidebar = Component.gen(function* (Props: ComponentProps<DocsSidebarProps>) {
  const { onNavigate } = yield* Props;
  const router = yield* Router.get;
  const route = router.current;

  const collapsedSignals = yield* Effect.all(sidebarGroups.map(() => Signal.make(false)));
  const groupSignals = yield* Effect.all(
    collapsedSignals.map((collapsed) =>
      Effect.gen(function* () {
        const className = yield* Signal.derive(collapsed, (c): string =>
          c ? "docs-sidebar__group docs-sidebar__group--collapsed" : "docs-sidebar__group",
        );
        const expanded = yield* Signal.derive(collapsed, (c) => !c);
        return { className, expanded };
      }),
    ),
  );
  const linkSignals = yield* Effect.all(
    sidebarGroups.map((group) =>
      Effect.all(
        group.links.map((link) =>
          Effect.gen(function* () {
            const className = yield* Signal.derive(route, (current): string =>
              current.path === link.href
                ? "docs-sidebar__link docs-sidebar__link--active"
                : "docs-sidebar__link",
            );
            const ariaCurrent = yield* Signal.derive(route, (current): "page" | undefined =>
              current.path === link.href ? "page" : undefined,
            );
            return { className, ariaCurrent };
          }),
        ),
      ),
    ),
  );

  return (
    <nav className="docs-sidebar" aria-label="Docs navigation">
      {sidebarGroups.map((group, groupIndex) => {
        const collapsed = collapsedSignals[groupIndex];
        if (collapsed === undefined) return null;

        const groupState = groupSignals[groupIndex];
        if (groupState === undefined) return null;

        return (
          <section key={group.label} className={groupState.className}>
            <button
              type="button"
              className="docs-sidebar__group-header"
              aria-expanded={groupState.expanded}
              onClick={() => Signal.update(collapsed, (c) => !c)}
            >
              {group.label}
              <ChevronDown />
            </button>
            <ul role="list" className="docs-sidebar__links">
              {group.links.map((link, linkIndex) => {
                const linkState = linkSignals[groupIndex]?.[linkIndex];
                if (linkState === undefined) return null;

                const handleNavigate = () =>
                  onNavigate === undefined ? Effect.void : onNavigate();

                return (
                  <li key={link.href} onClick={handleNavigate}>
                    <Router.Link
                      to={link.href}
                      className={linkState.className}
                      aria-current={linkState.ariaCurrent}
                    >
                      {link.label}
                    </Router.Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
});
