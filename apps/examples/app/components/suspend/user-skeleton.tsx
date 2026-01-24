import { Component } from "trygg";

export const UserSkeleton = Component.gen(function* () {
  return (
    <div className="p-4 rounded-lg">
      <div className="h-4 bg-gray-200 rounded mb-2 animate-shimmer w-[60%]" />
      <div className="h-4 bg-gray-200 rounded mb-2 animate-shimmer w-[80%]" />
    </div>
  );
});
