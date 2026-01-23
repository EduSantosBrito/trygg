import { Component } from "effect-ui";

export const PostsSkeleton = Component.gen(function* () {
  return (
    <div className="p-4 rounded-lg">
      <div className="h-4 bg-gray-200 rounded mb-2 animate-shimmer w-[40%]" />
      <div className="h-4 bg-gray-200 rounded mb-2 animate-shimmer w-[90%]" />
      <div className="h-4 bg-gray-200 rounded mb-2 animate-shimmer w-[40%]" />
      <div className="h-4 bg-gray-200 rounded mb-2 animate-shimmer w-[85%]" />
      <div className="h-4 bg-gray-200 rounded mb-2 animate-shimmer w-[40%]" />
      <div className="h-4 bg-gray-200 rounded mb-2 animate-shimmer w-[75%]" />
    </div>
  );
});
