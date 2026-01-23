import { Effect, Layer } from "effect";
import { Signal, Component } from "effect-ui";
import { DashboardTheme, Analytics, Logger } from "../services/dashboard";
import { StatCard } from "../components/dashboard/stat-card";
import { ActivityItem } from "../components/dashboard/activity-item";
import { ActionButton } from "../components/dashboard/action-button";
import { Header } from "../components/dashboard/header";
import { SectionTitle } from "../components/dashboard/section-title";

const lightTheme = Layer.succeed(DashboardTheme, {
  name: "Light",
  primary: "#0066cc",
  secondary: "#6c757d",
  background: "#f8f9fa",
  cardBackground: "#ffffff",
  text: "#212529",
  textMuted: "#6c757d",
});

const darkTheme = Layer.succeed(DashboardTheme, {
  name: "Dark",
  primary: "#4da6ff",
  secondary: "#adb5bd",
  background: "#1a1a2e",
  cardBackground: "#16213e",
  text: "#e9ecef",
  textMuted: "#adb5bd",
});

const analyticsLayer = Layer.succeed(Analytics, {
  track: (event, data) => Effect.log(`[Analytics] ${event}`, data),
});

const loggerLayer = Layer.succeed(Logger, {
  info: (message) => Effect.log(`[INFO] ${message}`),
  warn: (message) => Effect.log(`[WARN] ${message}`),
});

const DashboardPage = Component.gen(function* () {
  const isDark = yield* Signal.make(false);
  const isDarkValue = yield* Signal.get(isDark);

  const currentTheme = isDarkValue ? darkTheme : lightTheme;
  const theme = isDarkValue
    ? {
        name: "Dark",
        primary: "#4da6ff",
        background: "#1a1a2e",
        text: "#e9ecef",
        cardBackground: "#16213e",
      }
    : {
        name: "Light",
        primary: "#0066cc",
        background: "#f8f9fa",
        text: "#212529",
        cardBackground: "#ffffff",
      };

  const toggleTheme = () => Signal.update(isDark, (v) => !v);

  const activities = [
    { text: "New user registered", time: "2 minutes ago" },
    { text: "Order #1234 completed", time: "15 minutes ago" },
    { text: "Payment received", time: "1 hour ago" },
    { text: "Report generated", time: "3 hours ago" },
  ];

  return Effect.gen(function* () {
    return (
      <div className="min-h-screen font-sans -m-6 p-0" style={{ background: theme.background }}>
        <Header userName="Developer" />

        <main className="p-6 max-w-300 mx-auto">
          <div className="flex justify-between items-center mb-6">
            <SectionTitle title="Overview" />
            <ActionButton
              label={`Switch to ${isDarkValue ? "Light" : "Dark"}`}
              variant="secondary"
              onClick={toggleTheme}
            />
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-8">
            <StatCard title="Total Users" value="12,345" change="+12%" />
            <StatCard title="Revenue" value="$45,678" change="+8%" />
            <StatCard title="Orders" value="1,234" change="-3%" />
            <StatCard title="Conversion" value="3.2%" change="+0.5%" />
          </div>

          <SectionTitle title="Recent Activity" />
          <div
            className="rounded-lg overflow-hidden shadow"
            style={{ background: theme.cardBackground }}
          >
            {activities.map((activity, i) => (
              <ActivityItem key={i} text={activity.text} time={activity.time} />
            ))}
          </div>

          <div className="mt-8 flex gap-4">
            <ActionButton
              label="Generate Report"
              variant="primary"
              onClick={() => Effect.log("Generating report...")}
            />
            <ActionButton
              label="Export Data"
              variant="secondary"
              onClick={() => Effect.log("Exporting data...")}
            />
          </div>
        </main>
      </div>
    );
  }).pipe(Component.provide(Layer.mergeAll(currentTheme, analyticsLayer, loggerLayer)));
});

export default DashboardPage;
