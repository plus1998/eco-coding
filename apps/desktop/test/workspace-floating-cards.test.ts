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

test("agent orchestration is hidden when the profile only has the main agent", () => {
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
