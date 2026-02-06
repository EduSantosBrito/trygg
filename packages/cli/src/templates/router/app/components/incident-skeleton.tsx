import { Component } from "trygg";

export const IncidentSkeleton = Component.gen(function* () {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="incident-card animate-pulse">
          <div className="flex items-center justify-between mb-3">
            <div className="h-5 w-48 bg-[var(--surface-2)] rounded" />
            <div className="flex gap-2">
              <div className="h-5 w-14 bg-[var(--surface-2)] rounded-full" />
              <div className="h-5 w-20 bg-[var(--surface-2)] rounded-full" />
            </div>
          </div>
          <div className="h-4 w-32 bg-[var(--surface-2)] rounded" />
        </div>
      ))}
    </div>
  );
});
