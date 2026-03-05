import * as ServiceMap from "effect/ServiceMap";

export class ErrorTheme extends ServiceMap.Service<ErrorTheme,
  {
    readonly errorBackground: string;
    readonly errorText: string;
    readonly successBackground: string;
    readonly successText: string;
  }
>()("ErrorTheme") {}
