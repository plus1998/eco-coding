import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createBlankAgentProfileForm } from "../src/renderer/agent-profile-form";
import { AgentProfileEditorModal } from "../src/renderer/ModelsSettingsPanel";
import { createBuiltInAgentTemplates } from "../src/shared/agent-orchestration";
import type { ProviderConfigView } from "../src/shared/ipc";

const provider: ProviderConfigView = {
  id: "provider_1",
  name: "Provider One",
  baseUrl: "https://example.test",
  requestPath: "",
  apiCompat: "anthropic",
  defaultModel: "model-default",
  enabled: true,
  hasApiKey: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const templates = createBuiltInAgentTemplates();

function renderBuilder(includeExplore: boolean): string {
  const form = createBlankAgentProfileForm({ providers: [provider], templates });
  if (!includeExplore) {
    form.agents = form.agents.filter((agent) => agent.agentKey !== "explore");
  }
  return renderToStaticMarkup(
    <AgentProfileEditorModal
      form={form}
      setForm={() => {}}
      providers={[provider]}
      templates={templates}
      mcpServers={[]}
      mode="create"
      onClose={() => {}}
      onSave={() => {}}
    />,
  );
}

test("Agent builder renders default Explore as a removable roster node", () => {
  const markup = renderBuilder(true);
  expect(markup).toContain('aria-label="智能体库"');
  expect(markup).toContain('models-agent-profile-node-title">Explore</span>');
  expect(markup).toContain('aria-label="移除 Explore"');
  expect(markup).not.toContain('models-agent-profile-palette-title">Explore</span>');
});

test("Agent builder returns deleted Explore to the agent library", () => {
  const markup = renderBuilder(false);
  expect(markup).toContain('models-agent-profile-palette-title">Explore</span>');
  expect(markup).not.toContain('aria-label="移除 Explore"');
});
