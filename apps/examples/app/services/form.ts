import { Context } from "effect";

export class FormTheme extends Context.Tag("FormTheme")<
  FormTheme,
  {
    readonly errorColor: string;
    readonly successColor: string;
    readonly labelColor: string;
    readonly inputBorder: string;
  }
>() {}
