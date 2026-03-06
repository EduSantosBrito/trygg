import * as ServiceMap from "effect/ServiceMap";

export class FormTheme extends ServiceMap.Service<
  FormTheme,
  {
    readonly errorColor: string;
    readonly successColor: string;
    readonly labelColor: string;
    readonly inputBorder: string;
  }
>()("FormTheme") {}
