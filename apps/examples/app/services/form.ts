import * as Context from "effect/Context";

export class FormTheme extends Context.Service<
  FormTheme,
  {
    readonly errorColor: string;
    readonly successColor: string;
    readonly labelColor: string;
    readonly inputBorder: string;
  }
>()("FormTheme") {}
