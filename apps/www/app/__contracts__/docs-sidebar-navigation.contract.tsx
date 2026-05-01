/**
 * Behavior contract: docs sidebar navigation keeps docs chrome in sync.
 *
 * @internal
 */
import { Effect, Exit } from "effect";
import { click, render, waitFor } from "trygg/testing";
import * as Router from "trygg/router";

import * as ContractTrace from "../../../../packages/core/src/contract/trace.js";
import { DocsSidebar } from "../components/docs-sidebar";

interface ContractViolation {
  readonly code: string;
  readonly law: string;
  readonly message: string;
  readonly firstDivergenceSeq: number;
  readonly expected: string;
  readonly actual: string;
}

interface ContractRunOptions {
  readonly runId: string;
  readonly scenario?: string;
}

interface ContractRunResult {
  readonly status: "passed" | "failed";
  readonly contract: string;
  readonly scenario: string;
  readonly failureCode?: string;
  readonly summary: Record<string, unknown>;
  readonly trace: ReadonlyArray<Record<string, unknown>>;
}

const scenarioName = "elements-to-signals-sidebar-click";
const activeLinkFailureCode = "DOCS_SIDEBAR_ACTIVE_LINK_STALE_AFTER_CLICK";
const navigationFailureCode = "DOCS_SIDEBAR_CLICK_DID_NOT_NAVIGATE";

export const contract = {
  name: "docs-sidebar-navigation",
  suspectedFiles: [
    "apps/www/app/components/docs-sidebar.tsx",
    "apps/www/app/lib/router-snapshot.ts",
    "packages/core/src/router/link.ts",
  ],
  laws: [
    {
      id: "sidebar-click-updates-visible-docs-state",
      failureCode: activeLinkFailureCode,
      description:
        "After clicking a docs sidebar link, router state, visible topic content, and active sidebar item must all belong to the destination route.",
      failureHints: [
        "Check whether docs chrome reads the route through a non-reactive snapshot.",
        "Use a route signal / derived route state for active sidebar and prev-next chrome.",
        "Keep Link navigation intercepted; do not rely on full browser navigation.",
      ],
    },
  ],
  scenarios: [
    {
      name: scenarioName,
      fixedTrace: [
        { kind: "render", path: "/docs/elements" },
        { kind: "click", target: "sidebar:/docs/signals" },
        { kind: "observe", after: "navigation-settled" },
      ],
    },
  ],
} as const;

const flushDom = (ms: number): Effect.Effect<void> =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)));

const hrefOf = (element: Element | null): string | null => element?.getAttribute("href") ?? null;

const observeDocs = (container: HTMLElement, currentPath: string): Record<string, unknown> => {
  const active = container.querySelector(".docs-sidebar__link--active");
  const desktopActive =
    container.querySelector(".docs-layout__sidebar .docs-sidebar__link--active") ?? active;
  const signalsLink =
    container.querySelector('.docs-layout__sidebar a[href="/docs/signals"]') ??
    container.querySelector('nav.docs-sidebar a[href="/docs/signals"]');
  const elementsLink =
    container.querySelector('.docs-layout__sidebar a[href="/docs/elements"]') ??
    container.querySelector('nav.docs-sidebar a[href="/docs/elements"]');

  return {
    currentPath,
    activeHref: hrefOf(active),
    desktopActiveHref: hrefOf(desktopActive),
    signalsAriaCurrent: signalsLink?.getAttribute("aria-current") ?? null,
    elementsAriaCurrent: elementsLink?.getAttribute("aria-current") ?? null,
    hasSignalsContent: false,
    hasElementsContent: false,
    html: container.innerHTML,
  };
};

const violation = (
  code: string,
  law: string,
  message: string,
  expected: string,
  actual: string,
): ContractViolation => ({
  code,
  law,
  message,
  firstDivergenceSeq: 0,
  expected,
  actual,
});

const runScenario = Effect.scoped(
  Effect.gen(function* () {
    const result = yield* ContractTrace.withAction(
      "a1",
      { kind: "render", path: "/docs/elements" },
      render(<DocsSidebar />),
    );
    yield* flushDom(50);

    const linkExit = yield* Effect.exit(
      waitFor(
        () => {
          const link = result.container.querySelector<HTMLAnchorElement>(
            'nav.docs-sidebar a[href="/docs/signals"]',
          );
          if (link === null) throw new Error("Signals sidebar link is not ready");
          return link;
        },
        { timeout: 5000, interval: 50 },
      ),
    );

    const initialCurrent = yield* Router.currentRoute;
    const initial = observeDocs(result.container, initialCurrent.path);
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: { phase: "initial", ...initial },
    });

    if (Exit.isFailure(linkExit)) {
      return [
        violation(
          activeLinkFailureCode,
          "sidebar-click-updates-visible-docs-state",
          "Could not find the Signals sidebar link",
          "desktop sidebar contains a /docs/signals link",
          "no matching anchor found after waiting for docs chrome",
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    const signalsLink = linkExit.value;

    yield* ContractTrace.withAction(
      "a2",
      { kind: "click", target: "sidebar:/docs/signals", href: "/docs/signals" },
      click(signalsLink),
    );
    yield* flushDom(100);
    yield* flushDom(100);

    const current = yield* Router.currentRoute;
    const observation = observeDocs(result.container, current.path);
    yield* ContractTrace.emit({
      event: "contract.observation",
      level: "diagnostic",
      payload: { phase: "after-click", ...observation },
    });

    if (current.path !== "/docs/signals") {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "router.current.path = /docs/signals",
          actual: `router.current.path = ${current.path}`,
        },
      });
      return [
        violation(
          navigationFailureCode,
          "sidebar-click-updates-visible-docs-state",
          "Clicking the Signals sidebar link did not navigate the router to /docs/signals",
          "router.current.path = /docs/signals",
          `router.current.path = ${current.path}`,
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    if (
      observation.desktopActiveHref !== "/docs/signals" ||
      observation.signalsAriaCurrent !== "page" ||
      observation.elementsAriaCurrent === "page"
    ) {
      yield* ContractTrace.emit({
        event: "contract.firstDivergence",
        level: "semantic",
        payload: {
          expected: "Signals sidebar link is active and Elements sidebar link is inactive",
          actual: `desktopActiveHref=${String(
            observation.desktopActiveHref,
          )}, signalsAriaCurrent=${String(
            observation.signalsAriaCurrent,
          )}, elementsAriaCurrent=${String(observation.elementsAriaCurrent)}`,
        },
      });
      return [
        violation(
          activeLinkFailureCode,
          "sidebar-click-updates-visible-docs-state",
          "Docs sidebar active state stayed stale after clicking Signals",
          "Signals sidebar link is active and Elements sidebar link is inactive",
          `desktopActiveHref=${String(observation.desktopActiveHref)}, signalsAriaCurrent=${String(
            observation.signalsAriaCurrent,
          )}, elementsAriaCurrent=${String(observation.elementsAriaCurrent)}`,
        ),
      ] satisfies ReadonlyArray<ContractViolation>;
    }

    return [] satisfies ReadonlyArray<ContractViolation>;
  }).pipe(Effect.provide(Router.testLayer("/docs/elements"))),
);

const normalizeViolations = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
  violations: ReadonlyArray<ContractViolation>,
): ReadonlyArray<ContractViolation> => {
  const firstDivergenceSeq =
    records.find((record) => record.event.event === "contract.firstDivergence")?.seq ?? 0;

  return violations.map((item) => ({
    ...item,
    firstDivergenceSeq:
      item.firstDivergenceSeq === 0 ? firstDivergenceSeq : item.firstDivergenceSeq,
  }));
};

const toTraceLines = (
  records: ReadonlyArray<ContractTrace.ContractTraceRecord>,
  violations: ReadonlyArray<ContractViolation>,
): ReadonlyArray<Record<string, unknown>> => [
  ...records.map((record): Record<string, unknown> => {
    const event = record.event.event;
    const payload = record.event.payload ?? {};
    if (event === "contract.action.start") {
      return {
        schemaVersion: 1,
        lineType: "action",
        seq: record.seq,
        actionId: record.actionId,
        action: payload,
      };
    }
    if (event === "contract.observation") {
      return {
        schemaVersion: 1,
        lineType: "observation",
        seq: record.seq,
        actionId: record.actionId,
        observation: payload,
      };
    }
    return {
      schemaVersion: 1,
      lineType: "effect",
      seq: record.seq,
      actionId: record.actionId,
      event,
      level: record.event.level ?? "semantic",
      payload,
    };
  }),
  ...violations.map(
    (item, index): Record<string, unknown> => ({
      schemaVersion: 1,
      lineType: "violation",
      seq: records.length + index + 1,
      failureCode: item.code,
      law: item.law,
      message: item.message,
      firstDivergenceSeq: item.firstDivergenceSeq,
      expected: item.expected,
      actual: item.actual,
    }),
  ),
];

export const runContract = async (options: ContractRunOptions): Promise<ContractRunResult> => {
  const collector = await Effect.runPromise(ContractTrace.createInMemoryCollector(options.runId));
  const rawViolations = await Effect.runPromise(
    ContractTrace.withCollector(runScenario, collector),
  );
  const records = await Effect.runPromise(collector.snapshot);
  const violations = normalizeViolations(records, rawViolations);
  const trace = toTraceLines(records, violations);
  const firstViolation = violations[0];
  const status = firstViolation === undefined ? "passed" : "failed";

  return {
    status,
    contract: contract.name,
    scenario: scenarioName,
    ...(firstViolation === undefined ? {} : { failureCode: firstViolation.code }),
    summary: {
      schemaVersion: 1,
      tool: "assert-ui",
      status,
      contract: contract.name,
      scenario: scenarioName,
      suspectedFiles: contract.suspectedFiles,
      laws: contract.laws,
      ...(firstViolation === undefined
        ? {}
        : {
            failure: {
              code: firstViolation.code,
              law: firstViolation.law,
              message: firstViolation.message,
              firstDivergenceSeq: firstViolation.firstDivergenceSeq,
              expected: firstViolation.expected,
              actual: firstViolation.actual,
            },
          }),
      nextActions:
        firstViolation === undefined
          ? []
          : [
              "Replay the trace.",
              "Inspect docs sidebar/layout route reads for non-reactive snapshots.",
              "Make docs chrome derive active state from router.current or a route signal.",
            ],
    },
    trace,
  };
};
