import { expect, test } from "bun:test";
import {
  formatBashRunMeta,
  formatBashRunTitle,
  formatToolStatusPreview,
  readBashApprovalMetadata,
  resolveBashRunCardDisplay,
} from "../src/shared/activity-display";

test("formatToolStatusPreview shortens long Bash commands for compact status rows", () => {
  const longCommand =
    "bun test apps/desktop/test/event-center.test.ts apps/desktop/test/event-center-http.test.ts";
  expect(formatToolStatusPreview("Bash", longCommand)).toBe(
    "bun test apps/desktop/test/event-center.test.ts apps/de…",
  );
  expect(formatToolStatusPreview("Read", "/src/renderer/ActivityLogView.tsx")).toBe(
    "/src/renderer/ActivityLogView.tsx",
  );
});

test("resolveBashRunCardDisplay uses description or Shell for bash titles", () => {
  expect(
    resolveBashRunCardDisplay({
      toolName: "Bash",
      command: "cd apps/desktop && bun test test/thread-run-projection-view.test.ts",
      description: "Run projection view tests",
      output: "36 pass\n0 fail",
      durationMs: 716,
    }),
  ).toEqual({
    title: "Run projection view tests",
    meta: "cd, 1+, 0.7s",
    command: "cd apps/desktop && bun test test/thread-run-projection-view.test.ts",
    output: "36 pass\n0 fail",
  });
  expect(
    resolveBashRunCardDisplay({
      toolName: "Bash",
      command: "git status",
    }),
  ).toEqual({
    title: "Shell",
    meta: "git",
    command: "git status",
  });
  expect(
    resolveBashRunCardDisplay({
      toolName: "Bash",
      command:
        "cd apps/desktop && bun test test/event-center.test.ts test/event-center-http.test.ts test/thread-run-projection-view.test.ts",
    }),
  ).toEqual({
    title: "Shell",
    meta: "cd, 1+",
    command:
      "cd apps/desktop && bun test test/event-center.test.ts test/event-center-http.test.ts test/thread-run-projection-view.test.ts",
  });
});

test("formatBashRunTitle only uses structured descriptions", () => {
  expect(formatBashRunTitle("Run unit tests")).toBe("Run unit tests");
  expect(formatBashRunTitle()).toBe("Shell");
  expect(formatBashRunTitle("   ")).toBe("Shell");
});

test("formatBashRunMeta summarizes chained commands", () => {
  expect(formatBashRunMeta("cd apps/desktop && bun test && echo done")).toBe("cd, 2+");
});

test("readBashApprovalMetadata reads structured projection metadata", () => {
  expect(
    readBashApprovalMetadata({
      liveType: "bash_approval.approved",
      bashApproval: {
        toolUseId: "toolu_1",
        phase: "approved",
        toolName: "Grep",
        detail: "/tmp/file.txt",
        description: "Search outside workspace",
      },
    }),
  ).toEqual({
    toolUseId: "toolu_1",
    phase: "approved",
    toolName: "Grep",
    detail: "/tmp/file.txt",
    description: "Search outside workspace",
  });
});

test("formatBashRunMeta truncates absolute path to basename", () => {
  expect(formatBashRunMeta("/opt/android/adb")).toBe("adb");
  expect(formatBashRunMeta("/usr/bin/ls -la")).toBe("ls");
  expect(formatBashRunMeta("~/Library/Android/adb")).toBe("adb");
  expect(formatBashRunMeta("npm test")).toBe("npm");
});
