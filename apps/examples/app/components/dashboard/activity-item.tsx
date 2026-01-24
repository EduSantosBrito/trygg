import { Component, type ComponentProps } from "trygg";
import { DashboardTheme, Analytics } from "../../services/dashboard";

export const ActivityItem = Component.gen(function* (
  Props: ComponentProps<{
    text: string;
    time: string;
  }>,
) {
  const { text, time } = yield* Props;
  const theme = yield* DashboardTheme;
  const analytics = yield* Analytics;

  const onClick = () => analytics.track("activity_clicked", { text });

  return (
    <div
      onClick={onClick}
      className="p-3 border-b cursor-pointer"
      style={{ borderColor: `${theme.secondary}20` }}
    >
      <div style={{ color: theme.text }}>{text}</div>
      <div className="text-xs" style={{ color: theme.textMuted }}>
        {time}
      </div>
    </div>
  );
});
