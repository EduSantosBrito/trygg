import * as ServiceMap from "effect/ServiceMap";

export class Theme extends ServiceMap.Service<Theme,
  {
    readonly name: string;
    readonly background: string;
    readonly text: string;
    readonly primary: string;
    readonly border: string;
  }
>()("Theme") {}
