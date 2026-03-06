import * as ServiceMap from "effect/ServiceMap";

export class CounterTheme extends ServiceMap.Service<
  CounterTheme,
  {
    readonly primary: string;
    readonly background: string;
    readonly text: string;
  }
>()("CounterTheme") {}
