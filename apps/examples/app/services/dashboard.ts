import { Effect } from "effect";
import * as ServiceMap from "effect/ServiceMap";

export class DashboardTheme extends ServiceMap.Service<
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
>()("DashboardTheme") {}

export class Analytics extends ServiceMap.Service<
  Analytics,
  {
    readonly track: (event: string, data?: Record<string, unknown>) => Effect.Effect<void>;
  }
>()("Analytics") {}

export class Logger extends ServiceMap.Service<
  Logger,
  {
    readonly info: (message: string) => Effect.Effect<void>;
    readonly warn: (message: string) => Effect.Effect<void>;
  }
>()("Logger") {}
