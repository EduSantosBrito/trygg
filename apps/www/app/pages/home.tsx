/**
 * Home Page: trygg.dev — Variant A (The Workbench)
 */
import { Effect, Scope } from "effect";
import { Component, Signal, type ComponentProps, type Element as TryggElement } from "trygg";
import * as Router from "trygg/router";

import {
  createRenderTracker,
  hastChildToJsx,
  highlightCode,
  type HighlightedLine,
  type IdentifierTooltipMap,
} from "../components/code-block";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { copy, sections } from "../content/copy";
import { getTheme, THEME_CHANGE_EVENT, type Theme } from "../lib/theme";

type WorkbenchView = "step-0" | "step-1" | "step-2";

const sidebarFiles: ReadonlyArray<{ readonly id: WorkbenchView; readonly label: string }> = [
  { id: "step-0", label: "app/api/users.ts" },
  { id: "step-1", label: "app/components/user-list.tsx" },
  { id: "step-2", label: "app/pages/users.tsx" },
];

const isWorkbenchView = (value: string | null): value is WorkbenchView =>
  value === "step-0" || value === "step-1" || value === "step-2";

const isTheme = (value: unknown): value is Theme => value === "dark" || value === "light";

const Arrow = Component.gen(function* () {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="home-arrow">
      <path d="M4 10h10.5" />
      <path d="m10.5 5 5 5-5 5" />
    </svg>
  );
});

const InstallCommand = Component.gen(function* () {
  const state = yield* Signal.make<"idle" | "copied" | "failed">("idle");
  const buttonLabel = yield* Signal.derive(state, (s) => {
    if (s === "copied") return "Command copied";
    if (s === "failed") return "Copy failed, select the command manually";
    return "Copy command to clipboard";
  });
  const buttonText = yield* Signal.derive(state, (s) => {
    if (s === "copied") return "Copied";
    if (s === "failed") return "Failed";
    return "Copy";
  });

  const handleCopy = Effect.fnUntraced(function* (_event: Event) {
    const copied = yield* Effect.tryPromise(() =>
      navigator.clipboard.writeText(sections.install.command),
    ).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );

    yield* Signal.set(state, copied ? "copied" : "failed");
    yield* Effect.sleep("2 seconds");
    yield* Signal.set(state, "idle");
  });

  return (
    <div className="home-command" role="group" aria-label="Installation command">
      <span aria-hidden="true">$</span>
      <code>{sections.install.command}</code>
      <button type="button" onClick={handleCopy} aria-label={buttonLabel}>
        {buttonText}
      </button>
    </div>
  );
});

const identifierTooltips: IdentifierTooltipMap = {
  Resource: {
    kind: "primitive",
    description:
      "Descriptor for an Effect-typed async value. Pending, Success, and Failure states bubble through JSX.",
    signature: "Resource<A, E, R>",
  },
  Component: {
    kind: "primitive",
    description:
      "A trygg component. Props, typed errors, and Effect service requirements live in the type.",
    signature: "Component<Props, Error, Services>",
  },
  users: {
    kind: "resource",
    description:
      "Resource descriptor for the users list. The factory Effect runs once per cache key.",
    signature: "Resource<User[], ApiError, ApiClient>",
    asProperty: {
      kind: "api",
      description:
        "The users resource group on the ApiClient service. Exposes endpoints like list().",
      signature: "{ list: () => Effect<User[], ApiError> }",
    },
  },
  client: {
    kind: "service",
    description: "The ApiClient service, extracted from Effect's context via yield*.",
    signature: "ApiClient",
  },
  list: {
    kind: "endpoint",
    description:
      "The list endpoint on the users resource. Returns an Effect that resolves with the users array or fails with ApiError.",
    signature: "() => Effect<User[], ApiError>",
  },
  state: {
    kind: "signal",
    description:
      "Reactive resource state. Updates as the fetch moves between Pending, Success, and Failure.",
    signature: "Signal<Resource.ResourceState<User[], ApiError>>",
  },
  UserList: {
    kind: "component",
    description: "Renders the users list. Uses Resource.match to treat each state.",
    signature:
      "Component<{ state: Signal<Resource.ResourceState<User[], ApiError>> }, never, Scope.Scope>",
  },
};

const UsersPageEditor = Component.gen(function* (
  Props: ComponentProps<{
    readonly lines: Signal.Signal<ReadonlyArray<HighlightedLine>>;
  }>,
) {
  const { lines } = yield* Props;
  return <CodeEditor file="app/pages/users.tsx" lines={lines} />;
});

const CodeEditor = Component.gen(function* (
  Props: ComponentProps<{
    readonly file: string;
    readonly lines: Signal.Signal<ReadonlyArray<HighlightedLine>>;
  }>,
) {
  const { lines: linesSignal } = yield* Props;

  return (
    <pre className="home-workbench__editor-code" tabIndex={0}>
      <code>
        {
          yield* Signal.derive(linesSignal, (lines) => {
            const tracker = createRenderTracker();
            return (
              <>
                {lines.map((line) => (
                  <span key={line.lineNumber} className="home-workbench__line">
                    {line.nodes.map((node, j) =>
                      hastChildToJsx(node, j, {
                        tooltips: identifierTooltips,
                        tracker,
                      }),
                    )}
                    {"\n"}
                  </span>
                ))}
              </>
            );
          })
        }
      </code>
    </pre>
  );
});

const EditorPanel = Component.gen(function* (
  Props: ComponentProps<{
    readonly id: WorkbenchView;
    readonly active: Signal.Signal<WorkbenchView>;
    readonly children: TryggElement;
  }>,
) {
  const { id, active, children } = yield* Props;
  const className = yield* Signal.derive<WorkbenchView, string>(active, (view) =>
    view === id ? "home-workbench__panel home-workbench__panel--active" : "home-workbench__panel",
  );

  return (
    <div className={className} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`}>
      {children}
    </div>
  );
});

const SidebarFile = Component.gen(function* (
  Props: ComponentProps<{
    readonly id: WorkbenchView;
    readonly label: string;
    readonly active: Signal.Signal<WorkbenchView>;
    readonly onSelect: (view: WorkbenchView) => Effect.Effect<void>;
  }>,
) {
  const { id, label, active, onSelect } = yield* Props;
  const className = yield* Signal.derive<WorkbenchView, string>(active, (view) => {
    const isActive = view === id;
    return isActive ? "home-workbench__file home-workbench__file--active" : "home-workbench__file";
  });
  const ariaSelected = yield* Signal.derive(active, (view) => (view === id ? "true" : "false"));

  const onKeyDown = Effect.fnUntraced(function* (event: Event) {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (current === null) return;
    const tablist = current.closest('[role="tablist"]');
    if (tablist === null) return;
    const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
    const index = tabs.indexOf(current);
    if (index === -1) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (nextTab === undefined) return;
    const nextId = nextTab.getAttribute("data-tab-id");
    if (!isWorkbenchView(nextId)) return;
    nextTab.focus();
    yield* onSelect(nextId);
  });

  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      data-tab-id={id}
      aria-controls={`panel-${id}`}
      aria-selected={ariaSelected}
      className={className}
      onClick={() => onSelect(id)}
      onKeyDown={onKeyDown}
    >
      {label}
    </button>
  );
});

const StepEditor = Component.gen(function* (
  Props: ComponentProps<{
    readonly stepIndex: number;
    readonly highlights: Signal.Signal<ReadonlyArray<ReadonlyArray<HighlightedLine>>>;
    readonly active: Signal.Signal<WorkbenchView>;
  }>,
) {
  const { stepIndex, highlights, active } = yield* Props;
  const step = sections.seam.steps[stepIndex];
  const sidebarFile = sidebarFiles[stepIndex];
  if (!step || sidebarFile === undefined) return <></>;

  const lines = yield* Signal.derive(highlights, (entries) => entries[stepIndex] ?? []);
  const id = sidebarFile.id;

  return (
    <EditorPanel id={id} active={active}>
      {stepIndex === 2 ? (
        <UsersPageEditor lines={lines} />
      ) : (
        <CodeEditor file={step.file} lines={lines} />
      )}
    </EditorPanel>
  );
});

const SIDEBAR_HORIZONTAL_MQ = "(max-width: 900px)";

const Workbench = Component.gen(function* () {
  const activeView = yield* Signal.make<WorkbenchView>("step-2");
  const theme = yield* Signal.make<Theme>(getTheme());
  const isSidebarHorizontal = yield* Signal.make<boolean>(
    typeof window !== "undefined" && window.matchMedia(SIDEBAR_HORIZONTAL_MQ).matches,
  );
  const tablistOrientation = yield* Signal.derive(isSidebarHorizontal, (horizontal) =>
    horizontal ? "horizontal" : "vertical",
  );

  if (typeof window !== "undefined") {
    const syncTheme = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      Effect.runFork(Signal.set(theme, isTheme(event.detail) ? event.detail : getTheme()));
    };

    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);

    const orientationMql = window.matchMedia(SIDEBAR_HORIZONTAL_MQ);
    const onOrientationChange = (event: MediaQueryListEvent) => {
      Effect.runFork(Signal.set(isSidebarHorizontal, event.matches));
    };
    orientationMql.addEventListener("change", onOrientationChange);

    let pendingHeightFrame: number | null = null;
    const measureEditorHeight = () => {
      pendingHeightFrame = null;
      const editor = document.querySelector<HTMLElement>(".home-workbench__editor");
      if (editor === null) return;
      const active = editor.querySelector<HTMLElement>(".home-workbench__panel--active");
      if (active === null) return;
      const styles = window.getComputedStyle(editor);
      const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const target = active.getBoundingClientRect().height + paddingY;
      editor.style.setProperty("--workbench-editor-height", `${target}px`);
    };
    const scheduleEditorMeasure = () => {
      if (pendingHeightFrame !== null) cancelAnimationFrame(pendingHeightFrame);
      pendingHeightFrame = requestAnimationFrame(measureEditorHeight);
    };

    scheduleEditorMeasure();

    const syncTabsAndPanels = (view: WorkbenchView) => {
      const tabs = document.querySelectorAll<HTMLElement>('[role="tab"][data-tab-id]');
      tabs.forEach((tab) => {
        const tabId = tab.getAttribute("data-tab-id");
        tab.tabIndex = tabId === view ? 0 : -1;
      });
      const panels = document.querySelectorAll<HTMLElement>('[role="tabpanel"]');
      panels.forEach((panel) => {
        panel.inert = panel.id !== `panel-${view}`;
      });
    };

    // Defer initial sync to next frame: the JSX hasn't been mounted yet
    // when this setup code runs, so querySelectorAll would find no panels.
    const initialSyncFrame = requestAnimationFrame(() => {
      Effect.runFork(
        Signal.peek(activeView).pipe(
          Effect.tap((view) => Effect.sync(() => syncTabsAndPanels(view))),
        ),
      );
    });

    const unsubscribeActiveView = yield* Signal.subscribe(activeView, () =>
      Effect.gen(function* () {
        scheduleEditorMeasure();
        const view = yield* Signal.peek(activeView);
        syncTabsAndPanels(view);
      }),
    );

    const onWorkbenchResize = () => scheduleEditorMeasure();
    window.addEventListener("resize", onWorkbenchResize, { passive: true });

    const renderScope = yield* Signal.CurrentRenderScope;
    const cleanup = Effect.sync(() => {
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
      window.removeEventListener("resize", onWorkbenchResize);
      orientationMql.removeEventListener("change", onOrientationChange);
      if (pendingHeightFrame !== null) cancelAnimationFrame(pendingHeightFrame);
      cancelAnimationFrame(initialSyncFrame);
    });
    if (renderScope === null) {
      yield* Effect.addFinalizer(() => cleanup);
      yield* Effect.addFinalizer(() => unsubscribeActiveView);
    } else {
      yield* Scope.addFinalizer(renderScope, cleanup);
      yield* Scope.addFinalizer(renderScope, unsubscribeActiveView);
    }
  }

  const highlightedByTheme: Record<
    Theme,
    ReadonlyArray<ReadonlyArray<HighlightedLine>>
  > = yield* Effect.gen(function* () {
    const dark = yield* Effect.forEach(
      sections.seam.steps,
      (step) => Effect.promise(() => highlightCode(step.code, "tsx", "dark")),
      { concurrency: "unbounded" },
    );
    const light = yield* Effect.forEach(
      sections.seam.steps,
      (step) => Effect.promise(() => highlightCode(step.code, "tsx", "light")),
      { concurrency: "unbounded" },
    );

    return { dark, light };
  });

  const highlightedSteps = yield* Signal.derive(
    theme,
    (entryTheme) => highlightedByTheme[entryTheme],
  );

  const titlebarFile = yield* Signal.derive(activeView, (view) => {
    if (view === "step-0") return "app/api/users.ts";
    if (view === "step-1") return "app/components/user-list.tsx";
    return "app/pages/users.tsx";
  });

  const setView = Effect.fnUntraced(function* (view: WorkbenchView) {
    if (typeof window !== "undefined") {
      const editor = document.querySelector<HTMLElement>(".home-workbench__editor");
      if (editor !== null && editor.style.getPropertyValue("--workbench-editor-height") === "") {
        // First swap: pin the editor's current natural height so the upcoming
        // CSS transition has an explicit starting point (auto → px doesn't interpolate).
        const currentHeight = editor.getBoundingClientRect().height;
        editor.style.setProperty("--workbench-editor-height", `${currentHeight}px`);
        const _forcedReflow = editor.offsetHeight;
      }
    }
    yield* Signal.set(activeView, view);
  });

  return (
    <section className="home-workbench-section" aria-labelledby="hero-title">
      <div className="home-workbench-intro">
        <div className="home-workbench-intro__text">
          <h1 id="hero-title" className="home-workbench-intro__title">
            <span>{copy.heroTitle.lead}</span>{" "}
            <span className="home-workbench-intro__accent">{copy.heroTitle.trail}</span>
          </h1>

          <p className="home-workbench-intro__lede">{copy.heroSubtitle}</p>

          <div className="home-workbench-intro__actions">
            <InstallCommand />

            <div className="home-actions" role="group" aria-label="Primary actions">
              <Router.Link to={copy.primaryCtaHref} className="home-button home-button--primary">
                {copy.primaryCtaLabel}
                <Arrow />
              </Router.Link>
              <Router.Link
                to={copy.secondaryCtaHref}
                className="home-button home-button--secondary"
              >
                {copy.secondaryCtaLabel}
              </Router.Link>
            </div>
          </div>
        </div>

        <aside className="home-anchor" aria-label="A trygg component's type">
          <span className="home-anchor__label">A component's type</span>
          <pre className="home-anchor__signature">
            <code>
              <span className="home-anchor__type">Component</span>
              <span className="home-anchor__punct">{"<"}</span>
              {"\n  "}
              <span className="home-anchor__slot" data-slot="props">
                {sections.signature.slots.props}
              </span>
              <span className="home-anchor__punct">,</span>
              {"\n  "}
              <span className="home-anchor__slot" data-slot="error">
                {sections.signature.slots.error}
              </span>
              <span className="home-anchor__punct">,</span>
              {"\n  "}
              <span className="home-anchor__slot" data-slot="services">
                {sections.signature.slots.services}
              </span>
              {"\n"}
              <span className="home-anchor__punct">{">"}</span>
            </code>
          </pre>

          <ol className="home-anchor__legend" role="list">
            {sections.signature.legend.map((entry) => (
              <li key={entry.slot} data-slot={entry.slot}>
                <span className="home-anchor__legend-label">{entry.label}</span>
                <span className="home-anchor__legend-body">{entry.body}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <div className="home-workbench-bridge" aria-hidden="true">
        <span className="home-workbench-bridge__num">01</span>
        <span className="home-workbench-bridge__rule" />
        <span className="home-workbench-bridge__label">A real project, three files</span>
      </div>

      <div className="home-workbench" aria-label="trygg workbench preview">
        <div className="home-workbench__titlebar">
          <span className="home-workbench__traffic" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="home-workbench__title">{titlebarFile}</span>
        </div>

        <div className="home-workbench__body">
          <div
            className="home-workbench__sidebar"
            role="tablist"
            aria-orientation={tablistOrientation}
            aria-label="Project files"
          >
            {sidebarFiles.map((file) => (
              <SidebarFile
                key={file.label}
                id={file.id}
                label={file.label}
                active={activeView}
                onSelect={setView}
              />
            ))}
          </div>

          <div className="home-workbench__editor">
            {sections.seam.steps.map((step, index) => (
              <StepEditor
                key={step.label}
                stepIndex={index}
                highlights={highlightedSteps}
                active={activeView}
              />
            ))}
          </div>
        </div>

        <div className="home-workbench__terminal" aria-label="Terminal">
          <span className="home-workbench__prompt" aria-hidden="true">
            $
          </span>
          <code>{sections.install.command}</code>
        </div>
      </div>

      <div className="home-workbench-seam" aria-labelledby="seam-title">
        <header className="home-workbench-seam__head">
          <p className="home-kicker">{sections.seam.eyebrow}</p>
          <h2 id="seam-title">{sections.seam.heading}</h2>
          <p>{sections.seam.body}</p>
        </header>

        <ol className="home-workbench-seam__steps" role="list">
          {sections.seam.steps.map((step) => (
            <li key={step.label}>
              <span className="home-workbench-seam__step-num">{step.label}</span>
              <span className="home-workbench-seam__step-body">
                <strong>{step.title}</strong>
                <p>{step.body}</p>
                <code>{step.file}</code>
              </span>
            </li>
          ))}
        </ol>

        <Router.Link to={sections.seam.continueHref} className="home-seam__continue">
          {sections.seam.continueLabel}
          <Arrow />
        </Router.Link>
      </div>

      <section className="home-final" aria-labelledby="final-title">
        <p className="home-kicker">{sections.finalCta.eyebrow}</p>
        <h2 id="final-title">{sections.finalCta.heading}</h2>
        <div className="home-actions" role="group" aria-label="Final actions">
          <Router.Link to={copy.primaryCtaHref} className="home-button home-button--primary">
            {copy.primaryCtaLabel}
            <Arrow />
          </Router.Link>
          <a
            href={sections.community.github.href}
            className="home-button home-button--secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            View source
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
    </section>
  );
});

export default Component.gen(function* () {
  return (
    <>
      <title>trygg — Effect-native UI framework</title>
      <div className="landing-page home-page">
        <a href="#main-content" className="sr-only focus:not-sr-only landing-skip-link">
          Skip to main content
        </a>

        <Header />

        <main id="main-content">
          <Workbench />
        </main>

        <Footer />
      </div>
    </>
  );
});
