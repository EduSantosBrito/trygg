import { Component } from "effect-ui";

export const LoadingFallback = Component.gen(function* () {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-gray-500">
      <div className="w-10 h-10 border-3 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-4" />
      <p>Loading...</p>
    </div>
  );
});
