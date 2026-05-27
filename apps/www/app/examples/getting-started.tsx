import { Context, Layer } from "effect";
import { Component, Signal } from "trygg";

interface ThemeService {
  readonly color: string;
}

export class Theme extends Context.Service<Theme, ThemeService>()("Theme") {}

const ThemeLive = Layer.succeed(Theme, { color: "#8b5cf6" });

export default Component.gen(function* () {
  const theme = yield* Theme;
  const name = yield* Signal.make("trygg");

  return (
    <main style={{ color: theme.color }}>
      <h1>Hello, {yield* Signal.get(name)}.</h1>
      <button type="button" onClick={() => Signal.set(name, "friend")}>
        Personalize greeting
      </button>
    </main>
  );
}).pipe(Component.provide(ThemeLive));
