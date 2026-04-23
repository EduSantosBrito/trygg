import * as Context from "effect/Context";

export class TodoTheme extends Context.Service<
  TodoTheme,
  {
    readonly completedColor: string;
    readonly activeColor: string;
    readonly dangerColor: string;
    readonly primaryColor: string;
  }
>()("TodoTheme") {}
