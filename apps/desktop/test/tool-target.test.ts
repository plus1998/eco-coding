import { expect, test } from "bun:test";
import {
  formatGrepTargetInlineDetail,
  formatThreadRunToolDetailLabel,
  parseThreadRunGrepToolTarget,
  parseThreadRunReadToolTarget,
  resolveGrepToolTargetDisplay,
  resolveThreadRunToolTargets,
} from "../src/shared/tool-target";

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
