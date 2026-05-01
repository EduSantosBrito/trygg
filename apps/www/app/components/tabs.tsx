import { Effect } from "effect";
import { Component, Signal, type ComponentProps } from "trygg";

import { CodeBlock, highlightCode, type HighlightedLine } from "./code-block";
import type { PackageCommand, PackageManager } from "../content/getting-started";
import { packageManagerIcons } from "./package-manager-icons";

const highlightedCommands = new Map<string, ReadonlyArray<HighlightedLine>>();

const getHighlightedCommand = async (command: string) => {
  const existing = highlightedCommands.get(command);
  if (existing) return existing;

  const highlighted = await highlightCode(command, "bash");
  highlightedCommands.set(command, highlighted);
  return highlighted;
};

export const Tabs = Component.gen(function* (
  Props: ComponentProps<{
    commands: ReadonlyArray<PackageCommand>;
    selected: Signal.Signal<PackageManager>;
  }>,
) {
  const { commands, selected } = yield* Props;
  const initial = commands[0];

  if (!initial) {
    return <div />;
  }

  const highlighted = yield* Effect.all(
    commands.map((command) =>
      Effect.promise(() => getHighlightedCommand(command.command)).pipe(
        Effect.map((lines) => ({ command, lines })),
      ),
    ),
  );

  const selectedCommand = yield* Signal.derive(
    selected,
    (manager) => commands.find((command) => command.manager === manager) ?? initial,
  );
  const selectedCodeBlock = yield* Signal.derive(selectedCommand, (command) => {
    const entry = highlighted.find((item) => item.command.manager === command.manager);
    const lines = entry?.lines ?? [];

    return (
      <CodeBlock lines={lines} header={command.command} fileType="sh" copyText={command.command} />
    );
  });

  const buttonStates = yield* Effect.all(
    commands.map((command) =>
      Effect.all({
        command: Effect.succeed(command),
        selected: Signal.derive(selected, (manager) =>
          command.manager === manager ? "true" : "false",
        ),
        className: Signal.derive(
          selected,
          (manager): string =>
            `relative -mb-px px-4 py-3 text-sm font-medium focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] border-b-2 ${
              command.manager === manager
                ? "text-[var(--color-text)] border-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text)]"
            }`,
        ),
      }),
    ),
  );

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Package manager"
        className="inline-flex gap-1 border-b border-[var(--color-border)]"
      >
        {buttonStates.map(({ command, selected: active, className }) => {
          const Icon = packageManagerIcons[command.manager];
          return (
            <button
              key={command.manager}
              type="button"
              role="tab"
              value={command.manager}
              aria-selected={active}
              className={className}
              onClick={() => Signal.set(selected, command.manager)}
            >
              <span className="flex items-center gap-1.5">
                <Icon />
                {command.label}
              </span>
            </button>
          );
        })}
      </div>

      {selectedCodeBlock}
    </div>
  );
});
