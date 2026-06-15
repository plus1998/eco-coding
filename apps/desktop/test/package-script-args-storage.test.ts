import { expect, test } from "bun:test";
import { readScriptArgs, readWorkspaceScriptArgs, saveScriptArgs } from "../src/renderer/package-script-args-storage";

const workspace = "/tmp/demo-repo";

test("saveScriptArgs persists and reads per workspace script", () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.clear();
  saveScriptArgs(workspace, "publish", "root@xxx");
  expect(readScriptArgs(workspace, "publish")).toBe("root@xxx");
  expect(readWorkspaceScriptArgs(workspace)).toEqual({ publish: "root@xxx" });
});

test("saveScriptArgs removes empty args", () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.clear();
  saveScriptArgs(workspace, "dev", "--watch");
  saveScriptArgs(workspace, "dev", "   ");
  expect(readScriptArgs(workspace, "dev")).toBe("");
  expect(readWorkspaceScriptArgs(workspace)).toEqual({});
});
