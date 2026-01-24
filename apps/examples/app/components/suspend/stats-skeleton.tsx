import { Component } from "trygg";

export const StatsSkeleton = Component.gen(function* () {
  return (
    <div className="flex gap-4 p-4 rounded-lg">
      <div className="flex-1 h-10 bg-gray-200 rounded mb-2 animate-shimmer" />
      <div className="flex-1 h-10 bg-gray-200 rounded mb-2 animate-shimmer" />
      <div className="flex-1 h-10 bg-gray-200 rounded mb-2 animate-shimmer" />
    </div>
  );
});
