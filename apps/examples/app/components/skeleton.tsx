import { Component, type ComponentProps } from "trygg";

export const Skeleton = Component.gen(function* (Props: ComponentProps<{ lines?: number }>) {
  const { lines = 3 } = yield* Props;
  return (
    <div>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-4 bg-gray-200 rounded mb-2"
          style={{ width: `${70 + (i % 3) * 10}%` }}
        />
      ))}
    </div>
  );
});
