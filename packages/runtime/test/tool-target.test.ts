import { expect, test } from "bun:test";
import {
  formatGrepTargetLabel,
  formatReadLineRange,
  formatReadTargetLabel,
  resolveGrepTargetFromToolInput,
  resolveReadTargetFromToolInput,
} from "../src/tool-target.js";

test("resolveReadTargetFromToolInput captures file path and line range", () => {
  expect(
    resolveReadTargetFromToolInput("Read", {
      file_path: "/tmp/project/src/ActivityLogView.tsx",
      offset: 120,
      limit: 80,
    }),
  ).toEqual({
    filePath: "/tmp/project/src/ActivityLogView.tsx",
    offset: 120,
    limit: 80,
  });
});

test("formatReadTargetLabel includes basename and line range", () => {
  expect(
    formatReadTargetLabel({
      filePath: "/tmp/project/src/styles.css",
      offset: 3220,
      limit: 80,
    }),
  ).toBe("styles.css:L3220-3299");
  expect(formatReadLineRange(42)).toBe("L42");
});

test("resolveGrepTargetFromToolInput captures pattern and scope", () => {
  expect(
    resolveGrepTargetFromToolInput("Grep", {
      pattern: "formatAgentEventDisplay",
      path: "/repo/apps/desktop/src",
      glob: "*.ts",
      "-C": 2,
    }),
  ).toEqual({
    pattern: "formatAgentEventDisplay",
    path: "/repo/apps/desktop/src",
    glob: "*.ts",
    contextAround: 2,
  });
});

test("formatGrepTargetLabel includes pattern and scope", () => {
  expect(
    formatGrepTargetLabel({
      pattern: "ThreadRunToolMetadata",
      path: "/repo/apps/desktop/src/shared/thread-run-events.ts",
    }),
  ).toBe("ThreadRunToolMetadata · thread-run-events.ts");
});
