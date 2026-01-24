import { Component, cx, type ComponentProps } from "trygg";
import type { User } from "../resources/users";

export const UserCard = Component.gen(function* (
  Props: ComponentProps<{ user: User; stale: boolean }>,
) {
  const { user, stale } = yield* Props;
  return (
    <div className={cx("p-4 bg-white rounded-lg border border-gray-200", stale && "opacity-60")}>
      <h3 className="m-0 mb-1 text-gray-700">
        {user.name}{" "}
        {stale && (
          <span className="text-[0.65rem] bg-amber-400 text-gray-700 py-0.5 px-1.5 rounded ml-2 font-normal">
            stale
          </span>
        )}
      </h3>
      <p className="m-0 text-gray-500 text-sm">{user.email}</p>
      <span className="role-badge">{user.role}</span>
    </div>
  );
});
