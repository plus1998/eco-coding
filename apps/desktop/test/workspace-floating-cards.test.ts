import { expect, test } from "bun:test";
import type { ComposerAgentModelLabel } from "../src/renderer/composer-agent-model-labels";
import { isExploreOnlyEnabled } from "../src/renderer/WorkspaceFloatingCards";
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
