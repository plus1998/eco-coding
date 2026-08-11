import { expect, test } from "bun:test";
import {
  formatBashRunMeta,
  formatBashRunTitle,
  formatToolDisplayLabel,
  formatToolStatusPreview,
  parseToolActionDisplayLabel,
  readBashApprovalMetadata,
  resolveBashRunCardDisplay,
  resolveWebSearchCardDisplay,
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
  expect(formatToolStatusPreview("WebSearch", "flutter keyboard dismiss")).toBe(
    "联网搜索 · flutter keyboard dismiss",
  );
});

test("resolveWebSearchCardDisplay builds network search panel model", () => {
  expect(
    resolveWebSearchCardDisplay({
      toolName: "WebSearch",
      detail: "eco coding",
      status: "completed",
      durationMs: 1200,
      webSearch: {
        query: "eco coding",
        actionType: "search",
        mode: "search",
      },
    }),
  ).toMatchObject({
    kind: "search",
    title: "联网搜索 · eco coding",
    query: "eco coding",
    meta: "1.2s",
    statusText: "已完成",
    actionKind: "search",
  });

  expect(
    resolveWebSearchCardDisplay({
      toolName: "WebFetch",
      detail: "https://example.com/docs",
      status: "started",
    }),
  ).toMatchObject({
    kind: "fetch",
    title: "获取网页 · https://example.com/docs",
    query: "https://example.com/docs",
    statusText: "获取中…",
    actionKind: "fetch",
  });
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

test("formatToolDisplayLabel maps eco browser and image generation MCP tools", () => {
  expect(formatToolDisplayLabel("mcp__eco_agent_browser__agent_browser_click")).toBe("浏览器点击");
  expect(formatToolDisplayLabel("mcp__eco_agent_browser__agent_browser_open")).toBe("打开网页");
  expect(formatToolDisplayLabel("mcp__eco_agent_browser__agent_browser_snapshot")).toBe(
    "页面快照",
  );
  expect(formatToolDisplayLabel("mcp__eco_image_generation__create_image")).toBe("生成图片");
  expect(formatToolDisplayLabel("mcp__eco_plan__finalize_plan")).toBe("提交计划");
  expect(formatToolDisplayLabel("mcp_tool", "mcp__eco_agent_browser__agent_browser_click")).toBe(
    "浏览器点击",
  );
  expect(formatToolDisplayLabel("mcp__eco_ab_ea4a60abe66__agent_browser_open")).toBe("打开网页");
  expect(formatToolDisplayLabel("mcp__eco_agent_browser__agent_browser_scroll")).toBe(
    "浏览器操作",
  );
  expect(formatToolDisplayLabel("mcp__github__list_issues")).toBe("github · list issues");
});

test("parseToolActionDisplayLabel recognizes Tool lines for builtin MCP tools", () => {
  expect(
    parseToolActionDisplayLabel("Tool: mcp__eco_agent_browser__agent_browser_click"),
  ).toBe("浏览器点击");
  expect(
    parseToolActionDisplayLabel("Tool: mcp__eco_image_generation__create_image"),
  ).toBe("生成图片");
  expect(parseToolActionDisplayLabel("mcp__eco_agent_browser__agent_browser_fill")).toBe(
    "填写表单",
  );
});
