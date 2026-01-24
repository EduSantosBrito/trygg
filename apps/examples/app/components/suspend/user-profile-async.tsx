import { Duration, Effect } from "effect";
import { Signal, Component, type ComponentProps } from "trygg";
import { SuspendUserCard, type User } from "./user-card";

const fetchUser = (id: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(800));
    return {
      id,
      name: `User ${id}`,
      email: `user${id}@example.com`,
    } satisfies User;
  });

export const UserProfileAsync = Component.gen(function* (
  Props: ComponentProps<{ userId: Signal.Signal<number> }>,
) {
  const { userId } = yield* Props;
  const id = yield* Signal.get(userId);
  const user = yield* fetchUser(id);
  return <SuspendUserCard user={user} />;
});
