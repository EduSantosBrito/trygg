import * as Context from "effect/Context";

export class CounterTheme extends Context.Service<
  CounterTheme,
  {
    readonly primary: string;
    readonly background: string;
    readonly text: string;
  }
>()("examples/CounterTheme") {}
