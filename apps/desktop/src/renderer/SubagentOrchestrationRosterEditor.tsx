import { ChevronRight, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentTemplate, ProviderConfigView } from "../shared/ipc";
import { defaultThemeColorForAgentKey } from "../shared/subagent-theme";
import type { AgentResourceAgentFormState } from "./agent-resource-form";
import { formatAgentDomainLabel } from "./orchestration-summary";

interface SubagentOrchestrationRosterEditorProps {
  agents: AgentResourceAgentFormState[];
  templates: readonly AgentTemplate[];
  providers: readonly ProviderConfigView[];
  busy?: boolean | undefined;
  onAddAgent: (templateId: string) => void;
  onRemoveAgent: (index: number) => void;
  onEditAgent: (agentKey: string) => void;
  onToggleEnabled: (index: number, enabled: boolean) => void;
}

export function SubagentOrchestrationRosterEditor({
  agents,
  templates,
  providers,
  busy,
  onAddAgent,
  onRemoveAgent,
  onEditAgent,
  onToggleEnabled,
}: SubagentOrchestrationRosterEditorProps) {
  const [pendingTemplateId, setPendingTemplateId] = useState("");

  const rosterTemplateIds = useMemo(
    () => new Set(agents.map((agent) => agent.templateId)),
    [agents],
  );

  const addableTemplates = useMemo(
    () => templates.filter((template) => !rosterTemplateIds.has(template.id)),
    [rosterTemplateIds, templates],
  );

  function handleAddAgent() {
    if (!pendingTemplateId || busy) {
      return;
    }
    onAddAgent(pendingTemplateId);
    setPendingTemplateId("");
  }

  return (
    <section className="orchestration-roster" aria-label="子代理 roster">
      <header className="orchestration-roster-header">
        <div className="orchestration-roster-header-copy">
          <h3 className="orchestration-roster-title">子代理</h3>
          <p className="orchestration-roster-subtitle">
            选择模板加入 roster，再为每个节点配置模型与工具能力。
          </p>
        </div>
        <span className="orchestration-roster-count" aria-label={`${agents.length} 个子代理`}>
          {agents.length}
        </span>
      </header>

      <div className="orchestration-roster-add-bar">
        <label className="orchestration-roster-add-field">
          <span className="orchestration-roster-add-label">添加模板</span>
          <select
            className="mcp-field-input orchestration-roster-add-select"
            value={pendingTemplateId}
            disabled={busy || addableTemplates.length === 0}
            onChange={(event) => setPendingTemplateId(event.target.value)}
            aria-label="选择要添加的子代理模板"
          >
            <option value="">
              {addableTemplates.length === 0 ? "已全部加入" : "选择模板…"}
            </option>
            {addableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} · {formatAgentDomainLabel(template.domain)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="mcp-add-button orchestration-roster-add-button"
          disabled={busy || !pendingTemplateId}
          onClick={handleAddAgent}
        >
          <Plus size={16} strokeWidth={2.25} />
          添加
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="orchestration-roster-empty-state" role="status">
          <span className="orchestration-roster-empty-icon" aria-hidden>
            <Users size={22} strokeWidth={1.75} />
          </span>
          <p className="orchestration-roster-empty-title">Roster 为空</p>
          <p className="orchestration-roster-empty-copy">
            从上方选择一个内置或自定义模板，添加第一个子代理节点。
          </p>
        </div>
      ) : (
        <ul className="orchestration-roster-group">
          {agents.map((agent, index) => {
            const template = templates.find((entry) => entry.id === agent.templateId);
            const provider = providers.find((entry) => entry.id === agent.providerId);
            const displayName = agent.displayName.trim() || template?.name || agent.agentKey;
            const themeColor = agent.themeColor.trim() || defaultThemeColorForAgentKey(agent.agentKey);
            const modelLabel = agent.modelId
              ? `${provider?.name ?? agent.providerId} / ${agent.modelId}`
              : "未配置模型";
            return (
              <li
                key={agent.agentKey}
                className={`orchestration-roster-row${agent.enabled ? "" : " is-disabled"}`}
                style={{ ["--orchestration-roster-accent" as string]: themeColor }}
              >
                <button
                  type="button"
                  className="orchestration-roster-row-hit"
                  disabled={busy}
                  onClick={() => onEditAgent(agent.agentKey)}
                  aria-label={`配置 ${displayName}`}
                >
                  <span className="orchestration-roster-avatar" aria-hidden>
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="orchestration-roster-row-body">
                    <span className="orchestration-roster-row-top">
                      <span className="orchestration-roster-row-name">{displayName}</span>
                      <span className="orchestration-roster-status">
                        {agent.enabled ? "已启用" : "已暂停"}
                      </span>
                    </span>
                    <span className="orchestration-roster-row-meta">{modelLabel}</span>
                    <span className="orchestration-roster-row-foot">
                      <span className="orchestration-roster-domain">
                        {template ? formatAgentDomainLabel(template.domain) : "模板缺失"}
                      </span>
                      <span className="orchestration-roster-key">{agent.agentKey}</span>
                    </span>
                  </span>
                  <ChevronRight size={16} className="orchestration-roster-chevron" aria-hidden />
                </button>
                <div className="orchestration-roster-row-controls">
                  <label
                    className="mcp-toggle mcp-toggle-sm orchestration-roster-toggle"
                    title={agent.enabled ? "已启用" : "已禁用"}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={agent.enabled}
                      disabled={busy}
                      onChange={(event) => onToggleEnabled(index, event.target.checked)}
                    />
                    <span className="mcp-toggle-track" aria-hidden />
                  </label>
                  <button
                    type="button"
                    className="mcp-icon-button danger orchestration-roster-remove"
                    disabled={busy}
                    onClick={() => onRemoveAgent(index)}
                    aria-label={`移除 ${displayName}`}
                    title={`移除 ${displayName}`}
                  >
                    <Trash2 size={17} strokeWidth={2} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
