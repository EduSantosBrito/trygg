import { Component, type ComponentProps } from "trygg";

export interface Post {
  readonly id: number;
  readonly title: string;
  readonly body: string;
}

export const PostList = Component.gen(function* (
  Props: ComponentProps<{ posts: ReadonlyArray<Post> }>,
) {
  const { posts } = yield* Props;
  return (
    <ul className="list-none p-0 m-0">
      {posts.map((post) => (
        <li key={post.id} className="p-3 bg-white rounded mb-2 border border-gray-200 last:mb-0">
          <strong className="block mb-1 text-gray-700">{post.title}</strong>
          <p className="m-0 text-gray-500 text-sm">{post.body}</p>
        </li>
      ))}
    </ul>
  );
});
