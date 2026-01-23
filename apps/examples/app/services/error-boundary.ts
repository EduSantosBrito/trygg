import { Context } from "effect";

export class ErrorTheme extends Context.Tag("ErrorTheme")<
  ErrorTheme,
  {
    readonly errorBackground: string;
    readonly errorText: string;
    readonly successBackground: string;
    readonly successText: string;
  }
>() {}
