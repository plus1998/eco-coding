import { expect, test } from "bun:test";
import { buildSidebarSearchResults, type SidebarSearchProject } from "../src/renderer/SidebarSearchDialog";
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
