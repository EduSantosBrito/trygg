import { Component } from "trygg"

export const LoadingFallback = Component.gen(function* () {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-gray-500">Loading...</div>
    </div>
  )
})
