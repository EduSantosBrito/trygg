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
  const route = yield* Router.currentRoute;

  const collapsedSignals = yield* Effect.all(sidebarGroups.map(() => Signal.make(false)));

  return (
    <nav className="docs-sidebar" aria-label="Docs navigation">
      {sidebarGroups.map((group, groupIndex) => {
        const collapsed = collapsedSignals[groupIndex];
        if (collapsed === undefined) return null;

        const groupClassName = Signal.derive(collapsed, (c): string =>
          c ? "docs-sidebar__group docs-sidebar__group--collapsed" : "docs-sidebar__group",
        );
        const expanded = Signal.derive(collapsed, (c) => !c);

        return (
          <section key={group.label} className={groupClassName}>
            <button
              type="button"
              className="docs-sidebar__group-header"
              aria-expanded={expanded}
              onClick={() => Signal.update(collapsed, (c) => !c)}
            >
              {group.label}
              <ChevronDown />
            </button>
            <ul role="list" className="docs-sidebar__links">
              {group.links.map((link) => {
                const active = route.path === link.href;
                const className = active
                  ? "docs-sidebar__link docs-sidebar__link--active"
                  : "docs-sidebar__link";

                return (
                  <li key={link.href} onClick={onNavigate}>
                    <Router.Link
                      to={link.href}
                      className={className}
                      aria-current={active ? "page" : undefined}
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
