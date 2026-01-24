import { Signal, Component } from "trygg";
import { UsersList } from "../components/resource/users-list";
import { UserDetail } from "../components/resource/user-detail";
import { UserPosts } from "../components/resource/user-posts";

const ResourcePage = Component.gen(function* () {
  const selectedUserId = yield* Signal.make("1");

  const selectUser = (id: string) => Signal.set(selectedUserId, id);

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="m-0 mb-1 text-2xl">Resource</h2>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        Cached, deduplicated data fetching with API routes and Signal.each for lists
      </p>

      <div className="grid grid-cols-2 gap-6 grid-cols-[280px_1fr] items-start">
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 sticky top-20">
          <h3 className="m-0 mb-4 text-base text-gray-500">Users List (API: /api/users)</h3>
          <UsersList onSelect={selectUser} />
        </div>

        <div className="flex flex-col gap-6">
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="m-0 mb-4 text-base text-gray-500">
              User Detail (API: /api/users/
              {selectedUserId})
            </h3>
            <UserDetail userId={selectedUserId} />
          </div>

          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="m-0 mb-4 text-base text-gray-500">
              User Posts (API: /api/users/
              {selectedUserId}
              /posts)
            </h3>
            <UserPosts userId={selectedUserId} />
          </div>
        </div>
      </div>
    </div>
  );
});

export default ResourcePage;
