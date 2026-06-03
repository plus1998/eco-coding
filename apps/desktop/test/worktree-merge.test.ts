import { expect, test } from "bun:test";
import {
  buildWorktreeMergeSummary,
  formatWorktreeMergeThreadMessage,
  parseUnifiedDiffStats,
  parseWorktreeMergeMessage,
  serializeWorktreeMergeMessage,
} from "../src/shared/worktree-merge";

const SAMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line
+added
-old
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
-removed
+kept
`;

test("parseUnifiedDiffStats counts per-file additions and deletions", () => {
  const stats = parseUnifiedDiffStats(SAMPLE_DIFF);
  expect(stats.files).toHaveLength(2);
  const a = stats.files.find((file) => file.path === "src/a.ts");
  const b = stats.files.find((file) => file.path === "src/b.ts");
  expect(a).toEqual({ path: "src/a.ts", additions: 1, deletions: 1 });
  expect(b).toEqual({ path: "src/b.ts", additions: 1, deletions: 1 });
  expect(stats.totalAdditions).toBe(2);
  expect(stats.totalDeletions).toBe(2);
});

test("serialize and parse structured worktree merge message", () => {
  const summary = buildWorktreeMergeSummary(SAMPLE_DIFF, ["src/a.ts", "src/b.ts"]);
  const message = serializeWorktreeMergeMessage(summary);
  const parsed = parseWorktreeMergeMessage(message);
  expect(parsed?.fileCount).toBe(2);
  expect(parsed?.files).toHaveLength(2);
  expect(parsed?.totalAdditions).toBe(2);
  expect(parsed?.totalDeletions).toBe(2);
});

test("parseWorktreeMergeMessage supports legacy comma-separated format", () => {
  const legacy =
    "已合并 2 个文件的更改到工作区（未自动提交）：src/a.ts, src/b.ts";
  const parsed = parseWorktreeMergeMessage(legacy);
  expect(parsed?.fileCount).toBe(2);
  expect(parsed?.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
  expect(parsed?.totalAdditions).toBe(0);
});

test("formatWorktreeMergeThreadMessage is concise", () => {
  expect(formatWorktreeMergeThreadMessage(3)).toBe("已合并 3 个文件到工作区（未自动提交）");
});
