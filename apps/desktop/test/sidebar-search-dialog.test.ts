import { expect, test } from "bun:test";
import {
  buildSidebarSearchResults,
  resolveSidebarSearchBrowserHide,
  type SidebarSearchProject,
} from "../src/renderer/SidebarSearchDialog";
import type { ThreadSummary } from "../src/shared/ipc";

const projects: SidebarSearchProject[] = [
  { path: "/workspace/eco-coding", name: "eco-coding" },
  { path: "/workspace/notes", name: "Notes" },
];

function thread(
  id: string,
  title: string,
  workspacePath: string,
  updatedAt: string,
  status: ThreadSummary["status"] = "completed",
): ThreadSummary {
  return {
    id,
    title,
    prompt: title,
    workspacePath,
    status,
    createdAt: updatedAt,
    updatedAt,
    message: "",
  };
}

const threads = [
  thread("older", "修复回退重聊裁剪逻辑", "/workspace/eco-coding", "2026-01-01T00:00:00.000Z"),
  thread("newer", "排查接口报错差异", "/workspace/notes", "2026-01-02T00:00:00.000Z"),
];

test("sidebar search matches thread titles and project names separately", () => {
  expect(buildSidebarSearchResults(threads, projects, "接口").map((result) => result.key)).toEqual([
    "thread:newer",
  ]);
  expect(buildSidebarSearchResults(threads, projects, "eco-coding").map((result) => result.key)).toEqual([
    "project:/workspace/eco-coding",
  ]);
});

test("empty sidebar search lists recent threads before projects", () => {
  expect(buildSidebarSearchResults(threads, projects, "").map((result) => result.key)).toEqual([
    "thread:newer",
    "thread:older",
    "project:/workspace/eco-coding",
    "project:/workspace/notes",
  ]);
});

test("sidebar search puts running threads first", () => {
  const activeThreads = [
    ...threads,
    thread("running", "实现搜索分组", "/workspace/eco-coding", "2026-01-01T12:00:00.000Z", "running"),
    thread("queued", "等待执行", "/workspace/notes", "2025-12-31T12:00:00.000Z", "queued"),
  ];

  expect(buildSidebarSearchResults(activeThreads, projects, "").map((result) => result.key)).toEqual([
    "thread:running",
    "thread:newer",
    "thread:older",
    "thread:queued",
    "project:/workspace/eco-coding",
    "project:/workspace/notes",
  ]);
});

test("sidebar search ignores closed or non-browser task panels", () => {
  const input = {
    searchOpen: true,
    browserSurfaceVisible: true,
    activeTab: "files",
    browserIds: ["browser-1"],
  };

  expect(resolveSidebarSearchBrowserHide(input)).toEqual({ kind: "none" });
  expect(resolveSidebarSearchBrowserHide({ ...input, searchOpen: false })).toEqual({ kind: "none" });
  expect(
    resolveSidebarSearchBrowserHide({
      ...input,
      activeTab: "browser:browser-1",
      browserSurfaceVisible: false,
    }),
  ).toEqual({ kind: "none" });
});

test("sidebar search temporarily hides the active built-in browser", () => {
  const input = {
    searchOpen: true,
    browserSurfaceVisible: true,
    activeTab: "browser:browser-1",
    browserIds: ["browser-1", "browser-2"],
  };

  expect(resolveSidebarSearchBrowserHide(input)).toEqual({
    kind: "hide",
    browserId: "browser-1",
  });
  expect(resolveSidebarSearchBrowserHide({ ...input, activeTab: "browser:missing" })).toEqual({
    kind: "none",
  });
});
