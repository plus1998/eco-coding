import { expect, test } from "bun:test";
import type { ModelSettingsSnapshot } from "../src/shared/ipc";
import { ComposerRouteCardBody } from "../src/renderer/ComposerRoutePopover";
import { renderLocalized } from "./i18n-test";

const emptySettings: ModelSettingsSnapshot = {
  providers: [],
  routeProfiles: [],
  agentTemplates: [],
  mainAgentConfigs: [],
  mainAgentPrompts: [],
  subagentOrchestrations: [],
};

const noopHandlers = {
  onSelectMainAgentConfig: async () => {},
  onSelectMainPrompt: async () => {},
  onSelectSubagents: async () => {},
  onSelectAuxiliaryModel: async () => {},
  onSelectVisionModel: async () => {},
  onOpenFullSettings: () => {},
};

test("ComposerRouteCardBody disables builder and fields when canEdit is false", () => {
  const markup = renderLocalized(
    <ComposerRouteCardBody settings={emptySettings} canEdit={false} {...noopHandlers} />,
    "zh-CN",
  );

  expect(markup).toContain("composer-route-card-body");
  expect(markup).toContain("composer-route-builder-button");
  expect(markup.match(/disabled(?:=["']?|)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(markup).toMatch(/composer-route-builder-button[^>]*\sdisabled/);
});

test("ComposerRouteCardBody keeps controls enabled when canEdit is true and not busy", () => {
  const markup = renderLocalized(
    <ComposerRouteCardBody settings={emptySettings} canEdit={true} {...noopHandlers} />,
    "zh-CN",
  );

  expect(markup).toContain("composer-route-builder-button");
  expect(markup).not.toMatch(/composer-route-builder-button[^>]*\sdisabled/);
});

test("ComposerRouteCardBody defaults to read-only when canEdit is omitted", () => {
  const markup = renderLocalized(
    <ComposerRouteCardBody settings={emptySettings} {...noopHandlers} />,
    "zh-CN",
  );

  expect(markup).toMatch(/composer-route-builder-button[^>]*\sdisabled/);
});

test("ComposerRouteCardBody hides Eco orchestration fields for ACP", () => {
  const markup = renderLocalized(
    <ComposerRouteCardBody
      settings={emptySettings}
      canEdit={true}
      showOrchestration={false}
      {...noopHandlers}
    />,
    "zh-CN",
  );

  expect(markup).toContain("辅助模型");
  expect(markup).toContain("视觉模型");
  expect(markup).toContain("用于 Git 提交信息生成");
  expect(markup).toContain("ACP 没有 Eco 主模型可回退");
  expect(markup).not.toContain("主代理");
  expect(markup).not.toContain("子代理编排");
});

// ComposerRoutePopover portals to document.body; Bun static markup has no document.
// CardBody above locks the shared canEdit → disabled wiring used by the popover controls.