import { expect, test } from "bun:test";
import {
  formatGrepTargetInlineDetail,
  formatThreadRunToolDetailLabel,
  parseThreadRunGrepToolTarget,
  parseThreadRunReadToolTarget,
  resolveGrepToolTargetDisplay,
  resolveGrepToolTargetDisplayFromDetail,
  resolveGrepToolTargetDisplayFromToolMetadata,
  resolveReadToolTargetDisplayFromDetail,
  resolveReadToolTargetDisplayFromToolMetadata,
  resolveThreadRunToolTargets,
} from "../src/shared/tool-target";
import { isToolProgressStatusText } from "../src/shared/activity-display";

test("resolveThreadRunToolTargets prefers read target over grep", () => {
  expect(
    resolveThreadRunToolTargets("Read", {
      file_path: "/tmp/a.ts",
      offset: 10,
      limit: 5,
    }),
  ).toEqual({
    readTarget: {
      filePath: "/tmp/a.ts",
      offset: 10,
      limit: 5,
    },
  });
});

test("parseThreadRunReadToolTarget reads persisted metadata", () => {
  expect(
    parseThreadRunReadToolTarget({
      filePath: "/tmp/a.ts",
      offset: 3,
      limit: 12,
    }),
  ).toEqual({
    filePath: "/tmp/a.ts",
    offset: 3,
    limit: 12,
  });
});

test("parseThreadRunGrepToolTarget reads persisted metadata", () => {
  expect(
    parseThreadRunGrepToolTarget({
      pattern: "grep",
      path: "/repo",
      contextAfter: 1,
    }),
  ).toEqual({
    pattern: "grep",
    path: "/repo",
    contextAfter: 1,
  });
});

test("isToolProgressStatusText matches SDK progress lines", () => {
  expect(isToolProgressStatusText("Reading src/pages/Home/CtLossUser.vue")).toBe(true);
  expect(isToolProgressStatusText("Read CtLossUser.vue L810-869")).toBe(false);
});

test("resolveReadToolTargetDisplayFromDetail parses filename line ranges", () => {
  expect(resolveReadToolTargetDisplayFromDetail("CtLossUser.vue:L810-869")).toEqual({
    fileName: "CtLossUser.vue",
    filePath: "CtLossUser.vue",
    offset: 810,
    limit: 60,
    lineRange: "L810-869",
  });
});

test("resolveReadToolTargetDisplayFromToolMetadata ignores progress detail", () => {
  expect(
    resolveReadToolTargetDisplayFromToolMetadata({
      name: "Read",
      detail: "Reading src/pages/Home/CtLossUser.vue",
    }),
  ).toBeUndefined();
});

test("resolveGrepToolTargetDisplayFromDetail parses pattern and scope", () => {
  expect(
    resolveGrepToolTargetDisplayFromDetail("ThreadRunToolMetadata · thread-run-events.ts"),
  ).toEqual({
    pattern: "ThreadRunToolMetadata",
    path: "thread-run-events.ts",
    scopeLabel: "thread-run-events.ts",
  });
});

test("resolveGrepToolTargetDisplayFromToolMetadata ignores progress detail", () => {
  expect(
    resolveGrepToolTargetDisplayFromToolMetadata({
      name: "Grep",
      detail: "Searching file read display card format UI comp",
    }),
  ).toBeUndefined();
});

test("formatGrepTargetInlineDetail joins pattern and scope with pipes", () => {
  expect(
    formatGrepTargetInlineDetail(
      resolveGrepToolTargetDisplay({
        pattern: "Read.*\\.tsx",
        path: "读取文件",
        glob: "read.*file",
      })!,
    ),
  ).toBe("Read.*\\.tsx|读取文件|read.*file");
});

test("formatThreadRunToolDetailLabel prefers structured targets", () => {
  expect(
    formatThreadRunToolDetailLabel({
      name: "Read",
      detail: "a.ts",
      readTarget: { filePath: "/tmp/a.ts", offset: 5, limit: 10 },
    }),
  ).toBe("a.ts:L5-14");
});
