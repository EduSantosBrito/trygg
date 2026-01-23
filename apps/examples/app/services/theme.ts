import { Context } from "effect";

export class Theme extends Context.Tag("Theme")<
  Theme,
  {
    readonly name: string;
    readonly background: string;
    readonly text: string;
    readonly primary: string;
    readonly border: string;
  }
>() {}
