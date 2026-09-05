import { Effect, Match } from "effect";
import { Component, Signal, type ComponentProps, type Element } from "trygg";

import { CodeBlock, highlightCode } from "../components/code-block";
import { Tabs } from "../components/tabs";
import {
  gettingStarted,
  type CommandSection,
  type PackageManager,
} from "../content/getting-started";
import { DocsHeadingsLive, setDocsHeadings, type HeadingEntry } from "../content/headings";
import gettingStartedSource from "../examples/getting-started.tsx?raw";

const SectionShell = Component.gen(function* (
  Props: ComponentProps<{
    id: string;
    eyebrow: string;
    title: string;
    body: string;
    children: Element;
  }>,
) {
  const { id, eyebrow, title, body, children } = yield* Props;
  const labelId = `${id}-title`;

  return (
    <section id={id} aria-labelledby={labelId} className="docs-step-section">
      <div className="docs-step-section__header">
        <span className="docs-step-section__eyebrow">{eyebrow}</span>
        <div>
          <h2 id={labelId}>{title}</h2>
          <p>{body}</p>
        </div>
      </div>
      <div className="docs-step-section__body">{children}</div>
    </section>
  );
});

const CommandSectionView = Component.gen(function* (
  Props: ComponentProps<{
    section: CommandSection;
    selectedPackageManager: Signal.Signal<PackageManager>;
  }>,
) {
  const { section, selectedPackageManager } = yield* Props;

  return (
    <SectionShell
      id={section.id}
      eyebrow={section.eyebrow}
      title={section.title}
      body={section.body}
    >
      <Tabs commands={section.commands} selected={selectedPackageManager} />
    </SectionShell>
  );
});

const NextSteps = Component.gen(function* () {
  return (
    <ul className="docs-next-row" role="list">
      {gettingStarted.nextSteps.map((step) => (
        <li key={step.title}>
          <a href={step.href} className="docs-next-link">
            <strong>{step.title}</strong>
            <span>{step.body}</span>
          </a>
        </li>
      ))}
    </ul>
  );
});

const CopyForAgent = Component.gen(function* () {
  const copyState = yield* Signal.make<"idle" | "copied" | "failed">("idle");
  const label = yield* Signal.derive(copyState, (state) =>
    Match.value(state).pipe(
      Match.when("copied", () => "Copied!"),
      Match.when("failed", () => "Copy failed"),
      Match.when("idle", () => "Copy"),
      Match.exhaustive,
    ),
  );

  const copyPrompt = Effect.fnUntraced(function* (_event: Event) {
    const copied = yield* Effect.tryPromise(() =>
      navigator.clipboard.writeText(gettingStarted.agentPrompt),
    ).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    yield* Signal.set(copyState, copied ? "copied" : "failed");
    yield* Effect.sleep("2 seconds");
    yield* Signal.set(copyState, "idle");
  });

  return (
    <div className="docs-agent-panel">
      <div className="docs-agent-panel__header">
        <p className="docs-agent-panel__copy">
          Use this prompt when you want a coding agent to scaffold the same first experience.
        </p>
        <button
          type="button"
          className="docs-button docs-button--compact"
          onClick={copyPrompt}
          aria-label="Copy agent prompt to clipboard"
        >
          {label}
        </button>
      </div>
      <pre>
        <code>{gettingStarted.agentPrompt}</code>
      </pre>
    </div>
  );
});

const gettingStartedHeadings: ReadonlyArray<HeadingEntry> = [
  {
    id: gettingStarted.prerequisites.id,
    text: gettingStarted.prerequisites.title,
    level: 2,
  },
  { id: gettingStarted.create.id, text: gettingStarted.create.title, level: 2 },
  { id: gettingStarted.install.id, text: gettingStarted.install.title, level: 2 },
  { id: gettingStarted.explore.id, text: gettingStarted.explore.title, level: 2 },
  { id: gettingStarted.runDev.id, text: gettingStarted.runDev.title, level: 2 },
  { id: "next-steps", text: "What's next", level: 2 },
  { id: "create-with-ai", text: "Create with AI", level: 2 },
];

export default Component.gen(function* () {
  yield* setDocsHeadings(gettingStartedHeadings);

  const selectedPackageManager = yield* Signal.make<PackageManager>("bun");
  const exampleLines = yield* Effect.promise(() => highlightCode(gettingStartedSource, "tsx"));
  const devLines = yield* Effect.promise(() =>
    highlightCode(gettingStarted.runDev.command, "bash"),
  );

  return (
    <>
      <title>Getting started | trygg docs</title>
      <article className="docs-page docs-getting-started" aria-labelledby="getting-started-title">
        <header className="docs-hero docs-hero--compact">
          <p className="docs-eyebrow">Getting started</p>
          <div className="docs-hero__grid">
            <div>
              <h1 id="getting-started-title">{gettingStarted.title}</h1>
              <p className="docs-hero__lede">{gettingStarted.intro}</p>
            </div>
            <aside className="docs-runway" aria-labelledby="docs-runway-title">
              <p className="docs-section__kicker">Path</p>
              <h2 id="docs-runway-title">A first app in five moves</h2>
              <ol>
                <li>Create the project.</li>
                <li>Install dependencies.</li>
                <li>Read a component.</li>
                <li>Start the dev server.</li>
                <li>Choose the next docs path.</li>
              </ol>
            </aside>
          </div>
        </header>

        <SectionShell
          id={gettingStarted.prerequisites.id}
          eyebrow={gettingStarted.prerequisites.eyebrow}
          title={gettingStarted.prerequisites.title}
          body={gettingStarted.prerequisites.body}
        >
          <ul className="docs-requirements" role="list">
            {gettingStarted.prerequisites.requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
        </SectionShell>

        <CommandSectionView
          section={gettingStarted.create}
          selectedPackageManager={selectedPackageManager}
        />
        <CommandSectionView
          section={gettingStarted.install}
          selectedPackageManager={selectedPackageManager}
        />

        <SectionShell
          id={gettingStarted.explore.id}
          eyebrow={gettingStarted.explore.eyebrow}
          title={gettingStarted.explore.title}
          body={gettingStarted.explore.body}
        >
          <div className="docs-example-stack">
            <CodeBlock
              lines={exampleLines}
              header="greeting.tsx"
              fileType="tsx"
              copyText={gettingStartedSource}
            />
            <ul role="list" className="docs-note-list">
              {gettingStarted.explore.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </SectionShell>

        <SectionShell
          id={gettingStarted.runDev.id}
          eyebrow={gettingStarted.runDev.eyebrow}
          title={gettingStarted.runDev.title}
          body={gettingStarted.runDev.body}
        >
          <CodeBlock
            lines={devLines}
            header="localhost:5173"
            fileType="sh"
            copyText={gettingStarted.runDev.command}
          />
        </SectionShell>

        <SectionShell
          id="next-steps"
          eyebrow="06"
          title="What's next"
          body="Keep learning with the core model, Effect platform, and community resources."
        >
          <NextSteps />
        </SectionShell>

        <SectionShell
          id="create-with-ai"
          eyebrow="07"
          title="Create with AI"
          body="A ready-to-copy prompt that gives a coding agent what it needs to build this app."
        >
          <CopyForAgent />
        </SectionShell>
      </article>
    </>
  );
}).pipe(Component.provide(DocsHeadingsLive));
