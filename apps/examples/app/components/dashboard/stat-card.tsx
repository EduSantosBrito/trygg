import { Component, type ComponentProps } from "effect-ui";
import { DashboardTheme } from "../../services/dashboard";

export const StatCard = Component.gen(function* (
  Props: ComponentProps<{
    title: string;
    value: number | string;
    change?: string;
  }>,
) {
  const { title, value, change } = yield* Props;
  const theme = yield* DashboardTheme;

  return (
    <div className="p-6 rounded-lg shadow" style={{ background: theme.cardBackground }}>
      <h3 className="m-0 text-sm font-normal" style={{ color: theme.textMuted }}>
        {title}
      </h3>
      <div className="text-3xl font-bold mt-2" style={{ color: theme.text }}>
        {value}
      </div>
      {change && (
        <div
          className="text-sm mt-1"
          style={{
            color: change.startsWith("+")
              ? "#28a745"
              : change.startsWith("-")
                ? "#dc3545"
                : theme.textMuted,
          }}
        >
          {change} from last month
        </div>
      )}
    </div>
  );
});
