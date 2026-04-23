import * as Context from "effect/Context";

export class Theme extends Context.Service<
  Theme,
  {
    readonly name: string;
    readonly background: string;
    readonly text: string;
    readonly primary: string;
    readonly border: string;
  }
>()("Theme") {}
