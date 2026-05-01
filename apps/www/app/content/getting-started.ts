export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export interface PackageCommand {
  readonly manager: PackageManager;
  readonly label: string;
  readonly command: string;
}

export interface CommandSection {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly commands: ReadonlyArray<PackageCommand>;
}

export interface PrerequisitesSection {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly requirements: ReadonlyArray<string>;
}

export interface GettingStartedContent {
  readonly title: string;
  readonly intro: string;
  readonly prerequisites: PrerequisitesSection;
  readonly create: CommandSection;
  readonly install: CommandSection;
  readonly explore: {
    readonly id: string;
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly notes: ReadonlyArray<string>;
  };
  readonly runDev: {
    readonly id: string;
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly command: string;
  };
  readonly nextSteps: ReadonlyArray<{
    readonly title: string;
    readonly href: string;
    readonly body: string;
  }>;
  readonly agentPrompt: string;
}

const packageManagers = {
  bun: "Bun",
  npm: "npm",
  pnpm: "pnpm",
  yarn: "Yarn",
} satisfies Record<PackageManager, string>;

export const gettingStarted: GettingStartedContent = {
  title: "Getting started",
  intro: "Create a trygg app and install dependencies with your preferred package manager.",
  prerequisites: {
    id: "prerequisites",
    eyebrow: "01",
    title: "Prerequisites",
    body: "Install one JavaScript runtime before creating a project.",
    requirements: ["Bun (recommended) or Node.js 24+"],
  },
  create: {
    id: "create-project",
    eyebrow: "02",
    title: "Create a project",
    body: "Scaffold a new trygg app with the canary create command.",
    commands: [
      { manager: "bun", label: packageManagers.bun, command: "bunx create-trygg@canary my-app" },
      { manager: "npm", label: packageManagers.npm, command: "npx create-trygg@canary my-app" },
      {
        manager: "pnpm",
        label: packageManagers.pnpm,
        command: "pnpm dlx create-trygg@canary my-app",
      },
      {
        manager: "yarn",
        label: packageManagers.yarn,
        command: "yarn dlx create-trygg@canary my-app",
      },
    ],
  },
  install: {
    id: "install",
    eyebrow: "03",
    title: "Install",
    body: "From inside the generated project, install dependencies.",
    commands: [
      { manager: "bun", label: packageManagers.bun, command: "bun install" },
      { manager: "npm", label: packageManagers.npm, command: "npm install" },
      { manager: "pnpm", label: packageManagers.pnpm, command: "pnpm install" },
      { manager: "yarn", label: packageManagers.yarn, command: "yarn install" },
    ],
  },
  explore: {
    id: "explore-app",
    eyebrow: "04",
    title: "Explore the app",
    body: "This themed greeting is imported from a real TSX file and highlighted on this page.",
    notes: [
      "Component.gen lets JSX read Effect services and signals directly.",
      "Signal.make creates fine-grained reactive state for the greeting.",
      "Theme service is provided by a Layer at the component boundary.",
    ],
  },
  runDev: {
    id: "run-dev",
    eyebrow: "05",
    title: "Run dev",
    body: "Start the dev server and open localhost:5173 to see your app.",
    command: "bun run dev",
  },
  nextSteps: [
    {
      title: "Component Deep Dive",
      href: "/docs/components",
      body: "Learn how Component.gen composes Effect services, signals, and JSX.",
    },
    {
      title: "Effect Platform",
      href: "https://effect.website",
      body: "Understand the runtime and services that trygg builds on.",
    },
    {
      title: "Join Discord",
      href: "https://discord.gg/BRDc7xGb5D",
      body: "Ask questions and share what you are building with trygg.",
    },
  ],
  agentPrompt:
    "Create a new trygg app using `bunx create-trygg@canary`. Add a counter component with `Component.gen` and `Signal.make`. Include Tailwind CSS.",
};
