import { describe, expect, it } from "vitest";
import { moveRange } from "../render-utils.js";

describe("render-utils", () => {
  it("moves an inclusive DOM range before a reference node", () => {
    const parent = document.createElement("div");
    const start = document.createComment("start");
    const first = document.createElement("span");
    first.textContent = "first";
    const second = document.createElement("span");
    second.textContent = "second";
    const end = document.createComment("end");
    const before = document.createElement("strong");
    before.textContent = "before";

    parent.append(before, start, first, second, end);

    moveRange(start, end, before);

    expect(Array.from(parent.childNodes)).toEqual([start, first, second, end, before]);
  });
});
