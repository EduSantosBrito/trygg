import { Duration, Effect } from "effect";
import { Signal, Component, type ComponentProps } from "trygg";
import { PostList, type Post } from "./post-list";

const fetchPosts = (userId: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(1200));
    return [
      { id: 1, title: "First Post", body: `Content from user ${userId}` },
      { id: 2, title: "Second Post", body: "More interesting content" },
      { id: 3, title: "Third Post", body: "Even more to read" },
    ] satisfies ReadonlyArray<Post>;
  });

export const PostsAsync = Component.gen(function* (
  Props: ComponentProps<{ userId: Signal.Signal<number> }>,
) {
  const { userId } = yield* Props;
  const id = yield* Signal.get(userId);
  const posts = yield* fetchPosts(id);
  return <PostList posts={posts} />;
});
