import { Context, Effect } from "effect";

export class DashboardTheme extends Context.Tag("DashboardTheme")<
  DashboardTheme,
  {
    readonly name: string;
    readonly primary: string;
    readonly secondary: string;
    readonly background: string;
    readonly cardBackground: string;
    readonly text: string;
    readonly textMuted: string;
  }
>() {}

export class Analytics extends Context.Tag("Analytics")<
  Analytics,
  {
    readonly track: (event: string, data?: Record<string, unknown>) => Effect.Effect<void>;
  }
>() {}

export class Logger extends Context.Tag("Logger")<
  Logger,
  {
    readonly info: (message: string) => Effect.Effect<void>;
    readonly warn: (message: string) => Effect.Effect<void>;
  }
>() {}
