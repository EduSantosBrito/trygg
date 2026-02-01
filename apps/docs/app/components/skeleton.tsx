import { Component, type ComponentProps } from "trygg";

export const Skeleton = Component.gen(function* (Props: ComponentProps<{ lines?: number }>) {
  const { lines = 3 } = yield* Props;

  return (
    <div className="space-y-3">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-4 bg-gray-200 rounded animate-pulse"
          style={{ width: `${Math.random() * 30 + 70}%` }}
        />
      ))}
    </div>
  );
});
