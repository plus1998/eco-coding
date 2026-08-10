import { expect, test } from "bun:test";
import {
  extractPlanTitleFromMarkdown,
  resolveWorkspacePlanTitle,
} from "../src/renderer/workspace-plan-title";

test("extractPlanTitleFromMarkdown prefers first meaningful heading", () => {
  const markdown = `## 实现计划\n\n### 桌面端首个 Beta 发布方案\n\n1. ship\n2. test`;
  expect(extractPlanTitleFromMarkdown(markdown)).toBe("桌面端首个 Beta 发布方案");
});

test("extractPlanTitleFromMarkdown strips generic plan prefixes", () => {
  expect(extractPlanTitleFromMarkdown("## 实现计划：商品描述 Markdown")).toBe("商品描述 Markdown");
  expect(extractPlanTitleFromMarkdown("## Plan: Desktop beta")).toBe("Desktop beta");
});

test("extractPlanTitleFromMarkdown skips generic headings only", () => {
  expect(extractPlanTitleFromMarkdown("## 实现计划\n\nbody without title")).toBeUndefined();
});

test("resolveWorkspacePlanTitle falls back to user prompt, never full body", () => {
  expect(
    resolveWorkspacePlanTitle({
      plan: "1. Do A\n2. Do B\n3. Do C\n".repeat(20),
      userPrompt: "桌面端首个 Beta 发布方案",
      fallback: "计划",
    }),
  ).toBe("桌面端首个 Beta 发布方案");
});

test("resolveWorkspacePlanTitle uses fallback when plan and prompt empty", () => {
  expect(resolveWorkspacePlanTitle({ fallback: "计划" })).toBe("计划");
});
