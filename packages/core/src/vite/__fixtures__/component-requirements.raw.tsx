import { expectError, expectType } from "tsd";
import { Context, Layer } from "effect";
import { Component, mount, type ComponentProps } from "trygg";

class ThemeStore extends Context.Service<ThemeStore, { readonly value: string }>()(
  "test/ThemeStore",
) {}

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

declare const themeButtonRequirements: ComponentRequirements<typeof ThemeButton>;
declare const themeExampleRequirements: ComponentRequirements<typeof ThemeExample>;
expectType<ThemeStore>(themeButtonRequirements);
expectType<ThemeStore>(themeExampleRequirements);

const root = document.createElement("div");
expectError(mount(root, <ThemeExample />));

const ThemeStoreLive = Layer.succeed(ThemeStore, { value: "dark" });
const ProvidedThemeExample = ThemeExample.pipe(Component.provide(ThemeStoreLive));
declare const providedThemeExampleRequirements: ComponentRequirements<typeof ProvidedThemeExample>;
expectType<never>(providedThemeExampleRequirements);
mount(root, <ProvidedThemeExample />);
