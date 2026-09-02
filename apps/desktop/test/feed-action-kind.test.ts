import { expect, test } from "bun:test";
import { formatActionLine, resolveActionKind, summarizeActionGroup } from "../src/shared/feed-action-kind";
import { tEn, tZh } from "./i18n-zh-stub";

test("resolveActionKind maps aliases case-insensitively", () => {
  expect(resolveActionKind({ toolName: "Read" }).kind).toBe("read");
  expect(resolveActionKind({ toolName: "Read" }).icon).toBe("read");
  expect(resolveActionKind({ toolName: "read" }).kind).toBe("read");
  expect(resolveActionKind({ toolName: "Write" }).kind).toBe("write");
  expect(resolveActionKind({ toolName: "WebFetch" }).kind).toBe("webFetch");
  expect(resolveActionKind({ toolName: "webfetch" }).kind).toBe("webFetch");
  expect(resolveActionKind({ toolName: "Bash" }).icon).toBe("terminal");
  expect(resolveActionKind({ toolName: "bash" }).kind).toBe("command");
});

test("resolveActionKind keeps Write even when fileChange is present", () => {
  const resolved = resolveActionKind({
    toolName: "Write",
    payload: { fileChange: { path: "/repo/auth.ts", fileName: "auth.ts" } },
  });
  expect(resolved.kind).toBe("write");
  expect(resolved.bucket).toBe("writtenFiles");
});

test("resolveActionKind uses fileChange payload only when the name is unknown", () => {
  expect(
    resolveActionKind({
      toolName: "MysteryPatch",
      payload: { fileChange: { path: "/repo/a.ts" } },
    }).kind,
  ).toBe("edit");
});

test("resolveActionKind prefers mcpDiscovery before generic mcp", () => {
  expect(
    resolveActionKind({
      toolName: "mcp",
      payload: { mcpDiscovery: { kind: "search" } },
    }).kind,
  ).toBe("mcpSearch");
});

test("resolveActionKind upgrades webSearch payload mode fetch", () => {
  expect(
    resolveActionKind({
      toolName: "WebSearch",
      payload: { webSearch: { mode: "fetch", url: "https://example.com" } },
    }).kind,
  ).toBe("webFetch");
});

test("resolveActionKind classifies eco browser and image tools", () => {
  const click = resolveActionKind({
    toolName: "mcp__eco_agent_browser__agent_browser_click",
  });
  expect(click.kind).toBe("browser");
  expect(click.namedSuffix).toBe("agent_browser_click");
  expect(resolveActionKind({ toolName: "mcp__eco_ab_ea4a60abe66__agent_browser_open" }).kind).toBe("browser");
  expect(resolveActionKind({ toolName: "mcp__eco_image_generation__create_image" }).kind).toBe("imageCreate");
  expect(resolveActionKind({ toolName: "mcp__eco_image_generation__create_image" }).icon).toBe("image");
  expect(resolveActionKind({ toolName: "ViewImage" }).kind).toBe("imageView");
  expect(resolveActionKind({ toolName: "ViewImage" }).icon).toBe("images");
  expect(resolveActionKind({ toolName: "mcp__eco_image_view__view_image" }).kind).toBe("imageView");
  expect(resolveActionKind({ toolName: "mcp__eco_image_view__view_image" }).icon).toBe("images");
});

test("resolveActionKind does not let skill heuristic steal mcp tools", () => {
  expect(resolveActionKind({ toolName: "mcp__foo__read_skill" }).kind).toBe("mcp");
  expect(resolveActionKind({ toolName: "ReadSkill" }).kind).toBe("skill");
  expect(resolveActionKind({ toolName: "custom_skill_loader" }).kind).toBe("skill");
});

test("resolveActionKind unknown tools use kind tool and icon tool", () => {
  const resolved = resolveActionKind({ toolName: "TotallyUnknown" });
  expect(resolved.kind).toBe("tool");
  expect(resolved.icon).toBe("tool");
  expect(resolved.bucket).toBe("otherTools");
  expect(resolveActionKind({ toolName: "" }).kind).toBe("tool");
  expect(resolveActionKind({}).kind).toBe("tool");
});

test("formatActionLine done includes basename target", () => {
  const resolved = resolveActionKind({ toolName: "Read" });
  expect(formatActionLine({ resolved, phase: "done", rawTarget: "/repo/src/auth.ts" }, tZh)).toBe(
    "读取了 auth.ts",
  );
});

test("formatActionLine read appends lineRange to the basename", () => {
  const resolved = resolveActionKind({ toolName: "Read" });
  expect(
    formatActionLine(
      {
        resolved,
        phase: "done",
        payload: {
          readTarget: {
            filePath: "/repo/apps/desktop/src/renderer/ActivityLogView.tsx",
            fileName: "ActivityLogView.tsx",
            lineRange: "L120-159",
          },
        },
      },
      tZh,
    ),
  ).toBe("读取了 ActivityLogView.tsx L120-159");
});

test("formatActionLine done falls back without target", () => {
  const resolved = resolveActionKind({ toolName: "Read" });
  expect(formatActionLine({ resolved, phase: "done" }, tZh)).toBe("读取了文件");
});

test("formatActionLine running includes target", () => {
  const resolved = resolveActionKind({ toolName: "Read" });
  expect(formatActionLine({ resolved, phase: "running", rawTarget: "auth.ts" }, tZh)).toBe(
    "正在读取 auth.ts",
  );
});

test("formatActionLine webFetch does not use webSearch copy", () => {
  const resolved = resolveActionKind({ toolName: "WebFetch" });
  expect(
    formatActionLine(
      {
        resolved,
        phase: "done",
        payload: { webSearch: { mode: "fetch", url: "https://huggingface.co/docs" } },
      },
      tZh,
    ),
  ).toBe("获取了 huggingface.co");
});

test("summarizeActionGroup counts without filenames and splits web from search", () => {
  const items = [
    resolveActionKind({ toolName: "Read" }),
    resolveActionKind({ toolName: "Read" }),
    resolveActionKind({ toolName: "WebFetch" }),
    resolveActionKind({ toolName: "Grep" }),
  ];
  const summary = summarizeActionGroup(items, tZh);
  expect(summary.label).toContain("已读取 2 个文件");
  expect(summary.label).not.toContain("auth.ts");
  expect(summary.label).toContain("已联网 1 次");
  expect(summary.label).toContain("已搜索代码 1 次");
  expect(summary.label).not.toMatch(/已搜索代码(?! \d)/);
  expect(summary.icon).toBe("read");
});

test("summarizeActionGroup en joinMany does not use Chinese顿号", () => {
  const items = [
    resolveActionKind({ toolName: "Read" }),
    resolveActionKind({ toolName: "Edit" }),
    resolveActionKind({ toolName: "Grep" }),
  ];
  const summary = summarizeActionGroup(items, tEn);
  expect(summary.label).not.toContain("、");
  expect(summary.label).toContain(", ");
});

test("summarizeActionGroup icon priority uses network for mcp-only and browser for browser-only", () => {
  expect(summarizeActionGroup([resolveActionKind({ toolName: "mcp" })], tZh).icon).toBe("network");
  expect(
    summarizeActionGroup(
      [resolveActionKind({ toolName: "mcp__eco_agent_browser__agent_browser_click" })],
      tZh,
    ).icon,
  ).toBe("browser");
  expect(
    summarizeActionGroup(
      [resolveActionKind({ toolName: "Read" }), resolveActionKind({ toolName: "mcp" })],
      tZh,
    ).icon,
  ).toBe("read");
});
