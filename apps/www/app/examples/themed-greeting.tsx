import { Layer } from "effect";
import * as Context from "effect/Context";
import { Component } from "trygg";

class Theme extends Context.Service<
  Theme,
  { readonly accent: string; readonly greeting: string }
>()("app/Theme") {}

const Greeting = Component.gen(function* () {
  const theme = yield* Theme;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-8">
        <p className="font-mono text-sm" style={{ color: theme.accent }}>
          Theme service
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-[var(--ink)]">{theme.greeting}, trygg</h1>
      </section>
    </main>
  );
});

const ThemeLive = Layer.succeed(Theme, {
  accent: "#8b5cf6",
  greeting: "Hello",
});

export default Greeting.provide(ThemeLive);
