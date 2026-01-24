import { Component } from "trygg";
import { Modal } from "../components/modal";
import { NestedModal } from "../components/portal/nested-modal";
import { OverflowEscape } from "../components/portal/overflow-escape";

const PortalPage = Component.gen(function* () {
  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h2 className="m-0 mb-1 text-2xl">Portal</h2>
      <p className="text-gray-500 m-0 mb-6 text-[0.95rem]">
        Render content outside the component's DOM hierarchy using Portal
      </p>

      <Modal />
      <NestedModal />
      <OverflowEscape />
    </div>
  );
});

export default PortalPage;
