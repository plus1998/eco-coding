import { Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import type {
  AgentDomain,
  AgentTemplate,
  ProviderConfigView,
  SubagentEnabledSettings,
  SubagentRole,
} from "../shared/ipc";
import { SUBAGENT_ROLES } from "../shared/ipc";
import {
  AGENT_DOMAIN_OPTIONS,
  AGENT_SOURCE_OPTIONS,
  type AgentTemplateFormState,
  agentTemplateToForm,
  buildAgentTemplateFromForm,
  createBlankAgentTemplateForm,
  createCopiedAgentTemplateForm,
  formatAgentDomain,
  formatAgentSource,
} from "./agent-template-form";

const ROLE_LABELS: Record<SubagentRole, string> = {
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

const ROLE_HINTS: Record<SubagentRole, string> = {
  explore: "只读探索上下文，适合作为编排前置调查代理",
  architect: "拆分任务与结构设计，适合复杂变更前的方案代理",
  coder: "执行实现任务，默认编程预设中的必需代理",
  reviewer: "审查本次产物，适合风险较高的交付前检查",
  tester: "运行验证任务，适合交付前确认结果",
};

const DOMAIN_ORDER: AgentDomain[] = ["coding", "research", "writing", "product", "data", "ops", "custom"];

interface SubagentSettingsSectionProps {
  settings: SubagentEnabledSettings;
  templates: AgentTemplate[];
  providers: ProviderConfigView[];
  saving?: boolean | undefined;
  toggleDisabled?: boolean | undefined;
  registryDisabled?: boolean | undefined;
  onChange: (settings: SubagentEnabledSettings) => void;
  onRegistryChange: () => Promise<void> | void;
  onSavingChange?: ((saving: boolean) => void) | undefined;
}

export function SubagentSettingsSection({
  settings,
  templates,
  providers,
  saving,
  toggleDisabled,
  registryDisabled,
  onChange,
  onRegistryChange,
  onSavingChange,
}: SubagentSettingsSectionProps) {
  const [editorForm, setEditorForm] = useState<AgentTemplateFormState>();
  const [editingTemplateId, setEditingTemplateId] = useState<string>();
  const [editorError, setEditorError] = useState<string>();
  const [registrySaving, setRegistrySaving] = useState(false);

  const sortedTemplates = useMemo(
    () =>
      [...templates].sort((left, right) => {
        const domainDelta = DOMAIN_ORDER.indexOf(left.domain) - DOMAIN_ORDER.indexOf(right.domain);
        if (domainDelta !== 0) {
          return domainDelta;
        }
        const sourceDelta = sourceRank(left) - sourceRank(right);
        if (sourceDelta !== 0) {
          return sourceDelta;
        }
        return left.name.localeCompare(right.name);
      }),
    [templates],
  );

  const editorTemplate = editingTemplateId
    ? templates.find((template) => template.id === editingTemplateId)
    : undefined;
  const registryBusy = registryDisabled || registrySaving;

  function toggle(role: SubagentRole, enabled: boolean) {
    if (role === "coder") {
      return;
    }
    onChange({ ...settings, [role]: enabled });
  }

  function openCreateTemplate() {
    setEditorError(undefined);
    setEditingTemplateId(undefined);
    setEditorForm(createBlankAgentTemplateForm(providers, templates));
  }

  function openCopyTemplate(template: AgentTemplate) {
    setEditorError(undefined);
    setEditingTemplateId(undefined);
    setEditorForm(createCopiedAgentTemplateForm(template, templates, providers));
  }

  function openEditTemplate(template: AgentTemplate) {
    if (template.builtIn || template.source === "built_in" || template.source === "derived") {
      openCopyTemplate(template);
      return;
    }
    setEditorError(undefined);
    setEditingTemplateId(template.id);
    setEditorForm(agentTemplateToForm(template, providers));
  }

  function closeEditor() {
    setEditorForm(undefined);
    setEditingTemplateId(undefined);
    setEditorError(undefined);
  }

  async function saveTemplate() {
    if (!window.eco || !editorForm) {
      return;
    }
    setEditorError(undefined);
    setRegistrySaving(true);
    onSavingChange?.(true);
    try {
      const template = buildAgentTemplateFromForm(editorForm, { existing: editorTemplate });
      await window.eco.saveAgentTemplate(template);
      await onRegistryChange();
      closeEditor();
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRegistrySaving(false);
      onSavingChange?.(false);
    }
  }

  async function deleteTemplate(template: AgentTemplate) {
    if (!window.eco || template.builtIn || template.source === "built_in" || template.source === "derived") {
      return;
    }
    if (!window.confirm(`确定删除子代理模板「${template.name}」？`)) {
      return;
    }
    setRegistrySaving(true);
    onSavingChange?.(true);
    try {
      await window.eco.deleteAgentTemplate(template.id);
      await onRegistryChange();
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : String(caught));
      setEditorForm(agentTemplateToForm(template, providers));
      setEditingTemplateId(template.id);
    } finally {
      setRegistrySaving(false);
      onSavingChange?.(false);
    }
  }

  return (
    <>
      <section className="models-agent-library">
        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">模板</span>
          <button
            type="button"
            className="mcp-add-button"
            disabled={registryBusy || providers.length === 0}
            onClick={openCreateTemplate}
          >
            <Plus size={16} />
            新建模板
          </button>
        </div>

        {providers.length === 0 ? (
          <p className="mcp-list-empty">尚未添加 Provider</p>
        ) : sortedTemplates.length === 0 ? (
          <p className="mcp-list-empty">尚未添加子代理模板</p>
        ) : (
          <ul className="models-agent-template-list">
            {sortedTemplates.map((template) => {
              const editable =
                !template.builtIn && template.source !== "built_in" && template.source !== "derived";
              return (
                <li key={template.id} className="models-agent-template-row">
                  <div className="models-agent-template-main">
                    <div className="models-agent-template-title-row">
                      <span className="models-route-role">{template.name}</span>
                      <span className="models-route-role-id">{template.id}</span>
                      <span className="models-agent-domain-badge">{formatAgentDomain(template.domain)}</span>
                      <span className="models-agent-source-badge">{formatAgentSource(template)}</span>
                    </div>
                    <p className="models-subagent-card-desc">{template.description}</p>
                    <div className="models-agent-template-meta">
                      <span>{formatModelRef(template, providers)}</span>
                      <span>{formatTools(template)}</span>
                      {template.skills.length > 0 ? <span>{template.skills.length} skills</span> : null}
                      {template.mcpServers.length > 0 ? <span>{template.mcpServers.length} MCP</span> : null}
                    </div>
                  </div>
                  <div className="mcp-server-actions">
                    <button
                      type="button"
                      className="mcp-icon-button"
                      onClick={() => openCopyTemplate(template)}
                      aria-label={`复制 ${template.name}`}
                      disabled={registryBusy || providers.length === 0}
                    >
                      <Copy size={18} />
                    </button>
                    <button
                      type="button"
                      className="mcp-icon-button"
                      onClick={() => openEditTemplate(template)}
                      aria-label={editable ? `编辑 ${template.name}` : `复制 ${template.name}`}
                      disabled={registryBusy || providers.length === 0}
                    >
                      <Pencil size={18} />
                    </button>
                    {editable ? (
                      <button
                        type="button"
                        className="mcp-icon-button"
                        onClick={() => void deleteTemplate(template)}
                        aria-label={`删除 ${template.name}`}
                        disabled={registryBusy}
                      >
                        <Trash2 size={18} />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="models-subagent-defaults">
        <header className="models-subagent-defaults-head">
          <h3 className="models-route-profile-section-title">默认 Coding 启用状态</h3>
        </header>
        <ul className="models-subagent-list">
          {SUBAGENT_ROLES.map((role) => {
            const enabled = settings[role];
            const locked = role === "coder";
            return (
              <li key={role}>
                <div
                  className={enabled ? "models-subagent-card is-active" : "models-subagent-card is-inactive"}
                >
                  <div className="models-subagent-card-body">
                    <div className="models-subagent-card-title-row">
                      <span className="models-route-role">{ROLE_LABELS[role]}</span>
                      <span className="models-route-role-id">{role}</span>
                      {locked ? <span className="models-subagent-required-badge">默认必需</span> : null}
                    </div>
                    <p className="models-subagent-card-desc">{ROLE_HINTS[role]}</p>
                  </div>
                  <label
                    className="mcp-toggle mcp-toggle-lg"
                    title={locked ? "默认编程执行子代理不可停用" : enabled ? "已启用" : "已停用"}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={toggleDisabled || saving || locked}
                      onChange={(event) => toggle(role, event.target.checked)}
                    />
                    <span className="mcp-toggle-track" aria-hidden />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {editorForm && (
        <AgentTemplateEditorModal
          form={editorForm}
          setForm={setEditorForm}
          providers={providers}
          error={editorError}
          busy={registryBusy}
          editing={Boolean(editingTemplateId)}
          onClose={closeEditor}
          onSave={() => void saveTemplate()}
        />
      )}
    </>
  );
}

function AgentTemplateEditorModal({
  form,
  setForm,
  providers,
  error,
  busy,
  editing,
  onClose,
  onSave,
}: {
  form: AgentTemplateFormState;
  setForm: Dispatch<SetStateAction<AgentTemplateFormState | undefined>>;
  providers: ProviderConfigView[];
  error?: string | undefined;
  busy?: boolean | undefined;
  editing: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const title = editing ? `编辑 ${form.name.trim() || "子代理模板"}` : "新建子代理模板";

  function patchForm(patch: Partial<AgentTemplateFormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  return (
    <div className="settings-modal-backdrop">
      <button
        type="button"
        className="settings-modal-backdrop-close"
        onClick={onClose}
        aria-label="关闭"
        disabled={busy}
      />
      <div
        className="settings-modal settings-modal-agent-template"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-template-modal-title"
      >
        <header className="settings-modal-header">
          <h2 id="agent-template-modal-title" className="settings-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="mcp-icon-button"
            onClick={onClose}
            aria-label="关闭"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <div className="settings-modal-body mcp-editor-form models-agent-template-form">
          <div className="models-agent-template-form-grid">
            <label className="mcp-field">
              <span className="mcp-field-label">模板 ID</span>
              <input
                className="mcp-field-input"
                value={form.id}
                disabled={busy || editing}
                onChange={(event) => patchForm({ id: event.target.value })}
              />
            </label>
            <label className="mcp-field">
              <span className="mcp-field-label">名称</span>
              <input
                className="mcp-field-input"
                value={form.name}
                disabled={busy}
                onChange={(event) => patchForm({ name: event.target.value })}
              />
            </label>
            <label className="mcp-field">
              <span className="mcp-field-label">领域</span>
              <select
                className="mcp-field-input"
                value={form.domain}
                disabled={busy}
                onChange={(event) => patchForm({ domain: event.target.value as AgentDomain })}
              >
                {AGENT_DOMAIN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mcp-field">
              <span className="mcp-field-label">作用域</span>
              <select
                className="mcp-field-input"
                value={form.source}
                disabled={busy}
                onChange={(event) =>
                  patchForm({ source: event.target.value as AgentTemplateFormState["source"] })
                }
              >
                {AGENT_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mcp-field">
            <span className="mcp-field-label">描述</span>
            <input
              className="mcp-field-input"
              value={form.description}
              disabled={busy}
              onChange={(event) => patchForm({ description: event.target.value })}
            />
          </label>

          <label className="mcp-field">
            <span className="mcp-field-label">使用时机</span>
            <input
              className="mcp-field-input"
              value={form.whenToUse}
              disabled={busy}
              onChange={(event) => patchForm({ whenToUse: event.target.value })}
            />
          </label>

          <label className="mcp-field">
            <span className="mcp-field-label">提示词</span>
            <textarea
              className="mcp-field-input mcp-field-textarea models-agent-prompt-textarea"
              value={form.prompt}
              disabled={busy}
              onChange={(event) => patchForm({ prompt: event.target.value })}
            />
          </label>

          <label className="mcp-field">
            <span className="mcp-field-label">输出契约</span>
            <textarea
              className="mcp-field-input mcp-field-textarea"
              value={form.outputContract}
              disabled={busy}
              onChange={(event) => patchForm({ outputContract: event.target.value })}
            />
          </label>

          <div className="models-agent-template-form-grid">
            <label className="mcp-field">
              <span className="mcp-field-label">默认 Provider</span>
              <select
                className="mcp-field-input"
                value={form.providerId}
                disabled={busy}
                onChange={(event) => {
                  const provider = providers.find((entry) => entry.id === event.target.value);
                  patchForm({
                    providerId: event.target.value,
                    modelId: provider?.defaultModel ?? form.modelId,
                  });
                }}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mcp-field">
              <span className="mcp-field-label">默认模型</span>
              <input
                className="mcp-field-input"
                value={form.modelId}
                disabled={busy}
                onChange={(event) => patchForm({ modelId: event.target.value })}
              />
            </label>
          </div>

          <div className="models-agent-template-form-grid">
            <label className="mcp-field">
              <span className="mcp-field-label">允许工具</span>
              <input
                className="mcp-field-input"
                value={form.allowedTools}
                disabled={busy}
                onChange={(event) => patchForm({ allowedTools: event.target.value })}
              />
            </label>
            <label className="mcp-field">
              <span className="mcp-field-label">禁用工具</span>
              <input
                className="mcp-field-input"
                value={form.disallowedTools}
                disabled={busy}
                onChange={(event) => patchForm({ disallowedTools: event.target.value })}
              />
            </label>
            <label className="mcp-field">
              <span className="mcp-field-label">MCP Servers</span>
              <input
                className="mcp-field-input"
                value={form.mcpServers}
                disabled={busy}
                onChange={(event) => patchForm({ mcpServers: event.target.value })}
              />
            </label>
            <label className="mcp-field">
              <span className="mcp-field-label">MCP Tools</span>
              <input
                className="mcp-field-input"
                value={form.mcpTools}
                disabled={busy}
                onChange={(event) => patchForm({ mcpTools: event.target.value })}
              />
            </label>
            <label className="mcp-field">
              <span className="mcp-field-label">Skills</span>
              <input
                className="mcp-field-input"
                value={form.skills}
                disabled={busy}
                onChange={(event) => patchForm({ skills: event.target.value })}
              />
            </label>
            <label className="mcp-field models-toggle-field">
              <span className="mcp-field-label">允许继续委派</span>
              <label className="mcp-toggle" title={form.allowDelegation ? "已启用" : "已禁用"}>
                <input
                  type="checkbox"
                  checked={form.allowDelegation}
                  disabled={busy}
                  onChange={(event) => patchForm({ allowDelegation: event.target.checked })}
                />
                <span className="mcp-toggle-track" aria-hidden />
              </label>
            </label>
          </div>

          {error && <p className="settings-form-error">{error}</p>}
        </div>

        <footer className="settings-modal-footer">
          <button type="button" className="settings-modal-cancel" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="mcp-save-button" disabled={busy} onClick={onSave}>
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}

function formatModelRef(template: AgentTemplate, providers: readonly ProviderConfigView[]): string {
  const modelRef = template.defaultModelRef;
  if (!modelRef) {
    return "未配置默认模型";
  }
  const provider = providers.find((entry) => entry.id === modelRef.providerId);
  return `${provider?.name ?? modelRef.providerId} · ${modelRef.modelId}`;
}

function formatTools(template: AgentTemplate): string {
  const count = template.defaultTools.allowed.length;
  if (count === 0) {
    return "无默认工具";
  }
  return `${count} tools`;
}

function sourceRank(template: AgentTemplate): number {
  if (template.builtIn || template.source === "built_in") {
    return 0;
  }
  if (template.source === "project") {
    return 1;
  }
  return 2;
}
