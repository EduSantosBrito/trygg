import * as Context from "effect/Context";

export class ErrorTheme extends Context.Service<
  ErrorTheme,
  {
    readonly errorBackground: string;
    readonly errorText: string;
    readonly successBackground: string;
    readonly successText: string;
  }
>()("ErrorTheme") {}
