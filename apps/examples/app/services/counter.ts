import { Context } from "effect";

export class CounterTheme extends Context.Tag("CounterTheme")<
  CounterTheme,
  {
    readonly primary: string;
    readonly background: string;
    readonly text: string;
  }
>() {}
