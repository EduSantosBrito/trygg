/**
 * Interactive prompts using Effect and @clack/prompts
 * @since 1.0.0
 */
import { Effect } from "effect";
import { Prompts } from "./ports/prompts";

export interface ProjectOptions {
  readonly name: string;
  readonly platform: "node" | "bun";
  readonly output: "server" | "static";
  readonly vcs: "git" | "jj" | "none";
  readonly install: boolean;
}

/**
 * Run interactive prompts to gather project configuration
 */
export const promptProjectOptions = (name: string) =>
  Effect.gen(function* () {
    const prompts = yield* Prompts;

    // Platform selection
    const platform = yield* prompts.select({
      message: "Select platform (dev server & production runtime):",
      options: [
        { value: "bun" as const, label: "Bun" },
        { value: "node" as const, label: "Node" },
      ],
    });

    // Output mode selection
    const output = yield* prompts.select({
      message: "Select output mode:",
      options: [
        { value: "server" as const, label: "Server", hint: "full-stack with API routes" },
        { value: "static" as const, label: "Static", hint: "SPA, deploy to CDN" },
      ],
    });

    // VCS selection
    const vcs = yield* prompts.select({
      message: "Select version control:",
      options: [
        { value: "git" as const, label: "Git" },
        { value: "jj" as const, label: "Jujutsu (jj)" },
        { value: "none" as const, label: "None" },
      ],
    });

    // Install dependencies
    const install = yield* prompts.confirm({
      message: "Install dependencies?",
      initialValue: true,
    });

    return {
      name,
      platform,
      output,
      vcs,
      install,
    };
  });
