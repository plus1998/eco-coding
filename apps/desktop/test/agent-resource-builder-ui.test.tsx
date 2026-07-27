import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createBlankSubagentOrchestrationForm } from "../src/renderer/agent-resource-form";
import { AgentResourceEditorModal } from "../src/renderer/agent-resource-editor-modal";
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

function renderOrchestrationEditor(includeExplore: boolean): string {
  const form = createBlankSubagentOrchestrationForm({ providers: [provider], templates });
  if (!includeExplore) {
    form.agents = form.agents.filter((agent) => agent.agentKey !== "explore");
  }
  return renderToStaticMarkup(
    <AgentResourceEditorModal
      form={form}
      setForm={() => {}}
      providers={[provider]}
      templates={templates}
      mcpServers={[]}
      mode="create"
      scope="orchestration"
      onClose={() => {}}
      onSave={() => {}}
    />,
  );
}

test("Orchestration editor renders roster list with default Explore", () => {
  const markup = renderOrchestrationEditor(true);
  expect(markup).toContain('aria-label="子代理 roster"');
  expect(markup).toContain("Explore");
  expect(markup).toContain('aria-label="配置 Explore"');
  expect(markup).toContain('aria-label="移除 Explore"');
  expect(markup).not.toContain('aria-label="智能体库"');
});

test("Orchestration editor exposes removed Explore in add-template select", () => {
  const markup = renderOrchestrationEditor(false);
  expect(markup).toContain('value="builtin.coding.explore"');
  expect(markup).toContain("Explore");
  expect(markup).not.toContain('aria-label="移除 Explore"');
});
