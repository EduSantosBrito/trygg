import { Context } from "effect";

export class TodoTheme extends Context.Tag("TodoTheme")<
  TodoTheme,
  {
    readonly completedColor: string;
    readonly activeColor: string;
    readonly dangerColor: string;
    readonly primaryColor: string;
  }
>() {}
