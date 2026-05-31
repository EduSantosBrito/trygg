import { expectError, expectType } from "tsd";
import { Context, Effect, Layer } from "effect";
import { Component, mount, Signal, type ComponentProps } from "trygg";
import { Route } from "trygg/router";

class ThemeStore extends Context.Service<ThemeStore, { readonly value: string }>()(
  "test/ThemeStore",
) {}

class UserRepository extends Context.Service<
  UserRepository,
  {
    readonly getUser: (id: string) => Effect.Effect<{ readonly id: string; readonly name: string }>;
  }
>()("test/UserRepository") {}

type ComponentRequirements<C> =
  C extends Component.Type<infer _Props, infer _Error, infer Requirements> ? Requirements : never;

const ThemeButton = Component.gen(function* () {
  const theme = yield* ThemeStore;
  return <button>{theme.value}</button>;
});

const ThemedCard = Component.gen(function* () {
  const theme = yield* ThemeStore;
  return <article>{theme.value}</article>;
});

const ThemedTitle = Component.gen(function* (Props: ComponentProps<{ readonly title: string }>) {
  const { title } = yield* Props;
  const theme = yield* ThemeStore;
  return <h3>{`${title}: ${theme.value}`}</h3>;
});

const ThemeExample = Component.gen(function* () {
  return (
    <section>
      <ThemeButton />
      <ThemedCard />
      <ThemedTitle title="Using Component API" />
    </section>
  );
});

const UserRepositoryLive = Layer.succeed(UserRepository, {
  getUser: (id) => Effect.succeed({ id, name: id === "1" ? "Ada Lovelace" : "Grace Hopper" }),
});

const UserProfile = Component.gen(function* (
  Props: ComponentProps<{ readonly userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;
  const repo = yield* UserRepository;
  const id = yield* Signal.get(userId);
  const user = yield* repo.getUser(id);
  return <p>{user.name}</p>;
});

const ProfileCard = Component.gen(function* (
  Props: ComponentProps<{ readonly userId: Signal.Signal<string> }>,
) {
  const { userId } = yield* Props;

  return (
    <article>
      <h2>User profile</h2>
      <UserProfile userId={userId} />
    </article>
  );
});

const App = Component.gen(function* () {
  const userId = yield* Signal.make("1");
  return <ProfileCard userId={userId} />;
});

const ProvidedApp = App.pipe(Component.provide(UserRepositoryLive));

declare const themeButtonRequirements: ComponentRequirements<typeof ThemeButton>;
declare const themeExampleRequirements: ComponentRequirements<typeof ThemeExample>;
declare const profileCardRequirements: ComponentRequirements<typeof ProfileCard>;
declare const appRequirements: ComponentRequirements<typeof App>;
declare const providedAppRequirements: ComponentRequirements<typeof ProvidedApp>;
expectType<ThemeStore>(themeButtonRequirements);
expectType<ThemeStore>(themeExampleRequirements);
expectType<UserRepository>(profileCardRequirements);
expectType<UserRepository>(appRequirements);
expectType<never>(providedAppRequirements);

const root = document.createElement("div");
expectError(mount(root, <ThemeExample />));
const ThemeStoreLive = Layer.succeed(ThemeStore, { value: "dark" });
const ProvidedThemeExample = ThemeExample.pipe(Component.provide(ThemeStoreLive));
declare const providedThemeExampleRequirements: ComponentRequirements<typeof ProvidedThemeExample>;
expectType<never>(providedThemeExampleRequirements);
mount(root, <ProvidedThemeExample />);

expectError(Route.make("/profile").component(App));
Route.make("/profile").component(ProvidedApp);
expectError(Route.index(App));
Route.index(ProvidedApp);

const LazyApp = () => Promise.resolve({ default: App });
const LazyProvidedApp = () => Promise.resolve({ default: ProvidedApp });
expectError(Route.make("/lazy-profile").component(LazyApp));
Route.make("/lazy-profile").component(LazyProvidedApp);
