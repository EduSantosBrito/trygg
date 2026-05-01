/**
 * Landing page copy tokens.
 *
 * User-facing landing copy is centralized here for type-safe reuse and tests.
 */

export interface LandingCopy {
  readonly heroTitle: {
    readonly lead: string;
    readonly trail: string;
  };
  readonly heroSubtitle: string;
  readonly canaryWarning: string;
  readonly primaryCtaLabel: string;
  readonly primaryCtaHref: string;
  readonly secondaryCtaLabel: string;
  readonly secondaryCtaHref: string;
}

export const copy: LandingCopy = {
  heroTitle: {
    lead: "Props, errors, services.",
    trail: "All in the type.",
  },
  heroSubtitle:
    "A trygg component declares its props, typed errors, and Effect service dependencies in one type. If something is missing, the compiler tells you.",
  canaryWarning: "Canary",
  primaryCtaLabel: "Get started",
  primaryCtaHref: "/docs/getting-started",
  secondaryCtaLabel: "Read the docs",
  secondaryCtaHref: "/docs",
} as const;

export const sections = {
  signature: {
    file: "app/pages/users.tsx",
    badge: "Component",
    constName: "Users",
    type: "Component",
    slots: {
      props: "UsersProps",
      error: "ApiError",
      services: "ApiClient | Logger",
    },
    legend: [
      {
        slot: "props",
        label: "props",
        body: "The component's input type.",
      },
      {
        slot: "error",
        label: "typed failures",
        body: "Errors tracked in the type until a handler resolves them.",
      },
      {
        slot: "services",
        label: "service requirements",
        body: "Effect services the component needs. Tracked until a layer provides them.",
      },
    ],
  },

  seam: {
    eyebrow: "End to end",
    heading: "Define an API. Use it in JSX.",
    body: "Plain Effect on the API side. Resource turns Effect into reactive state. Component fetches it, treats each state, and a layer provides the service.",
    steps: [
      {
        label: "01",
        title: "Plain Effect API",
        body: "Endpoints, schemas, and error types in one Effect definition.",
        file: "app/api/users.ts",
        code: `export const UsersApi = HttpApi.make("users").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("list", "/users")
      .addSuccess(Schema.Array(User))
      .addError(ApiError),
  ),
);`,
      },
      {
        label: "02",
        title: "State handling",
        body: "Resource.match treats Pending, Success, and Failure as data.",
        file: "app/components/user-list.tsx",
        code: `export const UserList = Component.gen(function* (props) {
  const { state } = yield* props;
  return yield* Resource.match(state).pipe(
    Resource.on("Pending", () => <p>Loading users…</p>),
    Resource.on("Success", ({ value }) => (
      <ul>{value.map((u) => <li>{u.name}</li>)}</ul>
    )),
    Resource.on("Failure", ({ error }) => <p>{error.message}</p>),
    Resource.exhaustive,
  );
});`,
      },
      {
        label: "03",
        title: "Component + DI",
        body: "Resource is built from ApiClient, fetched in JSX, and the service is provided through a layer.",
        file: "app/pages/users.tsx",
        code: `const users = Resource.make(
  () =>
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.users.list();
    }),
  { key: "users.list" },
);

export default Component.gen(function* () {
  const state = yield* Resource.fetch(users);
  return <UserList state={state} />;
}).provide(ApiClientLive);`,
      },
    ],
    continueHref: "/docs/getting-started",
    continueLabel: "Continue in the getting-started guide",
  },

  finalCta: {
    eyebrow: "Next step",
    heading: "Build something and read the types.",
  },

  canary: {
    eyebrow: "Status",
    heading: "This is a canary release.",
    body: "APIs will change. Start small, read the generated code, and decide for yourself before using it in anything that matters.",
    notes: [
      "Pin your version. APIs change between canary releases.",
      "Server features need app/api.ts. Static apps can skip it.",
      "No SSR yet. Start with client-rendered pages.",
    ],
    reassurance:
      "The core patterns (components, signals, resources) are stable and unlikely to change.",
  },

  install: {
    command: "bunx create-trygg@canary my-app",
  },

  community: {
    heading: "Get involved",
    github: {
      label: "GitHub",
      href: "https://github.com/EduSantosBrito/trygg",
    },
  },

  footer: {
    links: [
      { label: "Docs", href: "/docs" },
      { label: "GitHub", href: "https://github.com/EduSantosBrito/trygg" },
      { label: "npm", href: "https://www.npmjs.com/package/trygg" },
      {
        label: "MIT License",
        href: "https://github.com/EduSantosBrito/trygg/blob/main/LICENSE",
      },
    ],
  },
} as const;
