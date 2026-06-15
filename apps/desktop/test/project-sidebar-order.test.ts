import { test, expect } from "bun:test";
import {
  buildInitialProjectOrder,
  prependProjectOrder,
  reorderProjectPaths,
  sortProjectsByOrder,
  sortThreadsForSidebar,
} from "../src/renderer/project-sidebar-order";

const projects = [
  { path: "/a", importedAt: "2026-01-03T00:00:00.000Z" },
  { path: "/b", importedAt: "2026-01-02T00:00:00.000Z" },
  { path: "/c", importedAt: "2026-01-01T00:00:00.000Z" },
];

test("buildInitialProjectOrder sorts by importedAt desc", () => {
  expect(buildInitialProjectOrder(projects)).toEqual(["/a", "/b", "/c"]);
});

test("sortProjectsByOrder respects saved order and appends unknown projects", () => {
  const sorted = sortProjectsByOrder(projects, ["/c", "/a"]);
  expect(sorted.map((project) => project.path)).toEqual(["/c", "/a", "/b"]);
});

test("prependProjectOrder moves path to front without duplicates", () => {
  expect(prependProjectOrder(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
  expect(prependProjectOrder(["/a", "/b"], "/d")).toEqual(["/d", "/a", "/b"]);
});

test("reorderProjectPaths inserts before and after target", () => {
  const order = ["/a", "/b", "/c", "/d"];
  expect(reorderProjectPaths(order, "/d", "/a", "before")).toEqual(["/d", "/a", "/b", "/c"]);
  expect(reorderProjectPaths(order, "/a", "/c", "after")).toEqual(["/b", "/c", "/a", "/d"]);
});

test("reorderProjectPaths is no-op for same path or missing target", () => {
  const order = ["/a", "/b", "/c"];
  expect(reorderProjectPaths(order, "/a", "/a", "before")).toEqual(["/a", "/b", "/c"]);
  expect(reorderProjectPaths(order, "/a", "/missing", "before")).toEqual(["/a", "/b", "/c"]);
});

test("sortThreadsForSidebar puts pinned threads first then sorts by updatedAt desc", () => {
  const threads = [
    { id: "a", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z" },
    { id: "b", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z" },
    { id: "c", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" },
  ];
  const sorted = sortThreadsForSidebar(threads, new Set(["c"]));
  expect(sorted.map((thread) => thread.id)).toEqual(["c", "b", "a"]);
});
