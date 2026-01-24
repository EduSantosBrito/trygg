import { Component, type ComponentProps } from "trygg";

export interface Stats {
  readonly followers: number;
  readonly following: number;
  readonly posts: number;
}

export const StatsCard = Component.gen(function* (Props: ComponentProps<{ stats: Stats }>) {
  const { stats } = yield* Props;
  return (
    <div className="flex gap-4 p-4 bg-white rounded-lg border border-gray-200">
      <div className="flex-1 text-center">
        <span className="block text-xl font-bold text-blue-600">{stats.followers}</span>
        <span className="block text-xs text-gray-500 uppercase">Followers</span>
      </div>
      <div className="flex-1 text-center">
        <span className="block text-xl font-bold text-blue-600">{stats.following}</span>
        <span className="block text-xs text-gray-500 uppercase">Following</span>
      </div>
      <div className="flex-1 text-center">
        <span className="block text-xl font-bold text-blue-600">{stats.posts}</span>
        <span className="block text-xs text-gray-500 uppercase">Posts</span>
      </div>
    </div>
  );
});
