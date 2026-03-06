import * as ServiceMap from "effect/ServiceMap";

export class TodoTheme extends ServiceMap.Service<
  TodoTheme,
  {
    readonly completedColor: string;
    readonly activeColor: string;
    readonly dangerColor: string;
    readonly primaryColor: string;
  }
>()("TodoTheme") {}
