import { Duration, Effect } from "effect";
import { Signal, Component, type ComponentProps } from "trygg";
import { StatsCard, type Stats } from "./stats-card";

const fetchStats = (userId: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(800));
    return {
      followers: userId * 100 + 42,
      following: userId * 50 + 17,
      posts: userId * 10 + 3,
    } satisfies Stats;
  });

export const StatsAsync = Component.gen(function* (
  Props: ComponentProps<{ userId: Signal.Signal<number> }>,
) {
  const { userId } = yield* Props;
  const id = yield* Signal.get(userId);
  const stats = yield* fetchStats(id);
  return <StatsCard stats={stats} />;
});
