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

// ComposerRoutePopover portals to document.body; Bun static markup has no document.
// CardBody above locks the shared canEdit → disabled wiring used by the popover controls.