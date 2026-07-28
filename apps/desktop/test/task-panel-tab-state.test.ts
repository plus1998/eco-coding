import { describe, expect, test } from "bun:test";
import { addOpenTaskPanelTab, removeOpenTaskPanelTab } from "../src/renderer/task-panel-tab-state";

describe("task panel tab state", () => {
  test("keeps an opened tab without duplicating it", () => {
    expect(addOpenTaskPanelTab(["files", "review"], "files")).toEqual(["files", "review"]);
    expect(addOpenTaskPanelTab(["files"], "review")).toEqual(["files", "review"]);
  });

  test("falls back to the neighboring tab when the active tab closes", () => {
    expect(removeOpenTaskPanelTab(["files", "review", "agent"], "review")).toEqual({
      tabs: ["files", "agent"],
      fallback: "files",
    });
    expect(removeOpenTaskPanelTab(["files", "review"], "files")).toEqual({
      tabs: ["review"],
      fallback: "review",
    });
  });
});
