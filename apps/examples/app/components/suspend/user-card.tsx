import { Component, type ComponentProps } from "effect-ui";

interface User {
  readonly id: number;
  readonly name: string;
  readonly email: string;
}

export type { User };

export const SuspendUserCard = Component.gen(function* (Props: ComponentProps<{ user: User }>) {
  const { user } = yield* Props;
  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <h3 className="m-0 mb-1 text-gray-700">{user.name}</h3>
      <p className="m-0 text-gray-500 text-sm">{user.email}</p>
    </div>
  );
});
