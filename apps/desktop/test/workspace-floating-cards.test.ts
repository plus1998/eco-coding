import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComposerAgentModelLabel } from "../src/renderer/composer-agent-model-labels";
import { isExploreOnlyEnabled, WorkspaceFloatingCards } from "../src/renderer/WorkspaceFloatingCards";
import type { SubagentEnabledSettings } from "../src/shared/ipc";

const settings: SubagentEnabledSettings = {
  explore: true,
  architect: false,
  coder: false,
  reviewer: false,
  tester: false,
};

function label(role: ComposerAgentModelLabel["role"], main = false): ComposerAgentModelLabel {
  return {
    role,
    displayName: String(role),
    title: String(role),
    main,
    ...(main ? {} : { subagentRole: role as keyof SubagentEnabledSettings }),
  };
}

test("agent orchestration defaults collapsed when only Explore is enabled", () => {
  expect(isExploreOnlyEnabled([label("explore"), label("coder")], settings)).toBe(true);
});

test("agent orchestration defaults expanded when another agent is enabled", () => {
  expect(
    isExploreOnlyEnabled([label("explore"), label("coder")], {
      ...settings,
      coder: true,
    }),
  ).toBe(false);
});

test("agent orchestration does not treat a lone custom agent as Explore", () => {
  const custom = {
    role: "eco_researcher",
    displayName: "Researcher",
    title: "Researcher",
    main: false,
  } satisfies ComposerAgentModelLabel;
  expect(isExploreOnlyEnabled([custom], settings)).toBe(false);
});

test("agent orchestration switches remain editable for an editable active thread", () => {
  const markup = renderToStaticMarkup(
    createElement(WorkspaceFloatingCards, {
      hasActiveThread: true,
      agentModelLabels: [label("explore"), label("coder"), label("reviewer")],
      subagentEnabled: { ...settings, coder: true },
      canEditComposerConfig: true,
      onToggleComposerSubagent: () => {},
    }),
  );

  expect(markup).toContain('aria-label="explore 已启用"');
  expect(markup).toContain('aria-label="coder 已启用"');
  expect(markup).toContain('aria-label="reviewer 已停用"');
  expect(markup).not.toContain('type="checkbox" disabled=""');
});

test("agent orchestration is hidden when the snapshot only has the main agent", () => {
  const markup = renderToStaticMarkup(
    createElement(WorkspaceFloatingCards, {
      hasActiveThread: true,
      agentModelLabels: [label("planner", true)],
    }),
  );

  expect(markup).not.toContain("智能体编排");
});

test("workspace Skills render as a collapsible section", () => {
  const markup = renderToStaticMarkup(
    createElement(WorkspaceFloatingCards, {
      hasActiveThread: true,
      skills: [
        {
          name: "local-skill",
          description: "Local skill",
          source: "project",
          directory: "/repo/.agents/skills/local-skill",
          skillFilePath: "/repo/.agents/skills/local-skill/SKILL.md",
          settingsKey: "project:agents:.agents/skills/local-skill/SKILL.md",
          layout: "agents",
          sdkReady: true,
        },
      ],
      composerSkillsEnabled: {
        "project:agents:.agents/skills/local-skill/SKILL.md": true,
      },
      canEditComposerConfig: true,
      onToggleComposerSkill: () => {},
    }),
  );

  expect(markup).toContain("workspace-skills-body");
  expect(markup).toContain("local-skill");
  expect(markup).toContain('aria-label="local-skill 已启用"');
});

test("approved plan card shows title only without body preview", () => {
  const markup = renderToStaticMarkup(
    createElement(WorkspaceFloatingCards, {
      hasActiveThread: true,
      approvedPlan: {
        threadId: "thr_1",
        userPrompt: "做桌面 Beta",
        analysis: "analysis body",
        plan: "## 实现计划：桌面端首个 Beta 发布方案\n\n1. 打包\n2. 分发\n3. 反馈",
        workspacePath: "/repo",
        worktreePath: "/repo",
        planFilePath: ".claude/plans/beta.md",
      },
      onOpenPlan: () => {},
    }),
  );

  expect(markup).toContain("桌面端首个 Beta 发布方案");
  expect(markup).toContain("workspace-plan-card-trigger");
  expect(markup).not.toContain(".claude/plans/beta.md");
  expect(markup).not.toContain("1. 打包");
  expect(markup).not.toContain("打开右侧面板查看完整计划");
});

test("browser instances render title plus hostname meta", () => {
  const markup = renderToStaticMarkup(
    createElement(WorkspaceFloatingCards, {
      hasActiveThread: true,
      browserInstances: [
        {
          id: "b1",
          title: "DeepSeek | 深度求索",
          url: "https://chat.deepseek.com/",
          faviconUrl: "https://chat.deepseek.com/favicon.ico",
        },
      ],
      onOpenBrowser: () => {},
    }),
  );

  expect(markup).toContain("浏览器");
  expect(markup).toContain("DeepSeek | 深度求索");
  expect(markup).toContain("chat.deepseek.com");
  expect(markup).toContain("workspace-browser-card-trigger");
  expect(markup).toContain('src="https://chat.deepseek.com/favicon.ico"');
  expect(markup).toContain("workspace-resource-row-favicon");
});
