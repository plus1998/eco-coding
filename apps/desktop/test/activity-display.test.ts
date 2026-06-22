import { expect, test } from "bun:test";
import {
  formatBashRunMeta,
  formatMeaningfulBashTitle,
  formatToolStatusPreview,
  parseBashApprovalActivityText,
  readBashApprovalMetadata,
  resolveBashRunCardDisplay,
} from "../src/shared/activity-display";

test("parseBashApprovalActivityText parses filesystem approval messages", () => {
  expect(parseBashApprovalActivityText("等待确认 Grep：/outside/file.txt")).toEqual({
    toolName: "Grep",
    detail: "/outside/file.txt",
    phase: "approval-pending",
  });
  expect(parseBashApprovalActivityText("已允许本次 Read：/etc/hosts")).toEqual({
    toolName: "Read",
    detail: "/etc/hosts",
    phase: "approval-approved",
  });
  expect(parseBashApprovalActivityText("已拒绝 Bash：rm -rf /")).toEqual({
    toolName: "Bash",
    detail: "rm -rf /",
    phase: "approval-rejected",
  });
  expect(parseBashApprovalActivityText("Bash 已拒绝：policy blocked")).toEqual({
    toolName: "Bash",
    detail: "policy blocked",
    phase: "approval-rejected",
  });
});

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

test("resolveBashRunCardDisplay builds card fields for bash summaries and output", () => {
  expect(
    resolveBashRunCardDisplay({
      toolName: "Bash",
      command: "cd apps/desktop && bun test test/thread-run-projection-view.test.ts",
      summaryText: "Run projection view tests",
      output: "36 pass\n0 fail",
      durationMs: 716,
    }),
  ).toEqual({
    title: "Run projection view tests",
    meta: "cd, 1+, 0.7s",
    body: "36 pass\n0 fail",
  });
  expect(
    resolveBashRunCardDisplay({
      toolName: "Bash",
      command: "git status",
      summaryText: "Tool: Bash · git status (0.2s)",
    }),
  ).toEqual({
    title: "git status",
    meta: "git",
    body: "git status",
  });
  expect(
    resolveBashRunCardDisplay({
      toolName: "Bash",
      command:
        "cd apps/desktop && bun test test/event-center.test.ts test/event-center-http.test.ts test/thread-run-projection-view.test.ts",
    }),
  ).toEqual({
    title: "Run event-center tests",
    meta: "cd, 1+",
    body: "cd apps/desktop && bun test test/event-center.test.ts test/event-center-http.test.ts test/thread-run-projection-view.test.ts",
  });
});

test("formatMeaningfulBashTitle prefers bash approval description", () => {
  expect(
    formatMeaningfulBashTitle("npm test", "Tool: Bash · npm test", "Run unit tests"),
  ).toBe("Run unit tests");
});

test("formatMeaningfulBashTitle prefers readable SDK summaries and short command labels", () => {
  expect(
    formatMeaningfulBashTitle(
      "kill -9 $(lsof -t -i:17891) && FLUX_PORT=17890 node server.js",
      "Restart Flux server on port 17890",
    ),
  ).toBe("Restart Flux server on port 17890");
  expect(formatMeaningfulBashTitle("npm run build:desktop")).toBe("Run build:desktop");
  expect(formatMeaningfulBashTitle("curl -s https://example.com/api/status")).toBe("Fetch URL");
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
