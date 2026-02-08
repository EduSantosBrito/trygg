import { Component } from "trygg";

export const LoadingFallback = Component.gen(function* () {
  return (
    <div className="flex items-center justify-center p-8">
      <span className="loading-spinner" aria-hidden="true" />
      <span className="visually-hidden">Loading…</span>
    </div>
  );
});
