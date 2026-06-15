import { Copy, Download, History, Pencil, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import type {
  AgentDomain,
  AgentTemplate,
  AgentTemplateVersionView,
  McpServerConfigView,
} from "../shared/ipc";
import {
  AGENT_DOMAIN_OPTIONS,
  type AgentTemplateFormState,
  agentTemplateToForm,
  buildAgentTemplateCapabilityOptions,
  buildAgentTemplateFromForm,
  buildAgentTemplatePermissionChips,
  createBlankAgentTemplateForm,
  createCopiedAgentTemplateForm,
  formatAgentDomain,
  formatAgentSource,
} from "./agent-template-form";
import { ToolCapabilityPanel } from "./ToolCapabilityPanel";

const DOMAIN_ORDER: AgentDomain[] = ["coding", "research", "writing", "product", "data", "ops", "custom"];

interface SubagentSettingsSectionProps {
  templates: AgentTemplate[];
  mcpServers?: McpServerConfigView[] | undefined;
  registryDisabled?: boolean | undefined;
  onRegistryChange: () => Promise<void> | void;
  onSavingChange?: ((saving: boolean) => void) | undefined;
}

export function SubagentSettingsSection({
  templates,
  mcpServers = [],
  registryDisabled,
  onRegistryChange,
  onSavingChange,
}: SubagentSettingsSectionProps) {
  const [editorForm, setEditorForm] = useState<AgentTemplateFormState>();
  const [editingTemplateId, setEditingTemplateId] = useState<string>();
  const [editorError, setEditorError] = useState<string>();
  const [registrySaving, setRegistrySaving] = useState(false);
  const [registryMessage, setRegistryMessage] = useState<string>();
  const [versionModal, setVersionModal] = useState<{
    template: AgentTemplate;
    versions: AgentTemplateVersionView[];
    error?: string | undefined;
  }>();

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

  function openCreateTemplate() {
    setRegistryMessage(undefined);
    setEditorError(undefined);
    setEditingTemplateId(undefined);
    setEditorForm(createBlankAgentTemplateForm(templates));
  }

  function openCopyTemplate(template: AgentTemplate) {
    setRegistryMessage(undefined);
    setEditorError(undefined);
    setEditingTemplateId(undefined);
    setEditorForm(createCopiedAgentTemplateForm(template, templates));
  }

  function openEditTemplate(template: AgentTemplate) {
    setRegistryMessage(undefined);
    if (template.builtIn || template.source === "built_in" || template.source === "derived") {
      openCopyTemplate(template);
      return;
    }
    setEditorError(undefined);
    setEditingTemplateId(template.id);
    setEditorForm(agentTemplateToForm(template));
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
      setRegistryMessage(`已保存 ${template.name}`);
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
      setRegistryMessage(`已删除 ${template.name}`);
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : String(caught));
      setEditorForm(agentTemplateToForm(template));
      setEditingTemplateId(template.id);
    } finally {
      setRegistrySaving(false);
      onSavingChange?.(false);
    }
  }

  async function exportTemplates(templateIds?: string[]) {
    if (!window.eco) {
      return;
    }
    setRegistryMessage(undefined);
    setRegistrySaving(true);
    onSavingChange?.(true);
    try {
      const result = await window.eco.exportAgentTemplates(templateIds ? { templateIds } : undefined);
      if (!result.canceled) {
        setRegistryMessage(`已导出 ${result.exported} 个模板`);
      }
    } catch (caught) {
      setRegistryMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRegistrySaving(false);
      onSavingChange?.(false);
    }
  }

  async function importTemplates() {
    if (!window.eco) {
      return;
    }
    setRegistryMessage(undefined);
    setRegistrySaving(true);
    onSavingChange?.(true);
    try {
      const result = await window.eco.importAgentTemplates();
      if (!result.canceled) {
        await onRegistryChange();
        setRegistryMessage(
          result.errors.length > 0
            ? `已导入 ${result.imported} 个模板，${result.errors.length} 个失败`
            : `已导入 ${result.imported} 个模板`,
        );
      }
    } catch (caught) {
      setRegistryMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRegistrySaving(false);
      onSavingChange?.(false);
    }
  }

  async function openVersionHistory(template: AgentTemplate) {
    if (!window.eco) {
      return;
    }
    setRegistryMessage(undefined);
    setRegistrySaving(true);
    try {
      const versions = await window.eco.listAgentTemplateVersions(template.id);
      setVersionModal({ template, versions });
    } catch (caught) {
      setVersionModal({
        template,
        versions: [],
        error: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setRegistrySaving(false);
    }
  }

  async function restoreVersion(templateId: string, version: number) {
    if (!window.eco || !versionModal) {
      return;
    }
    setRegistrySaving(true);
    onSavingChange?.(true);
    try {
      const restored = await window.eco.restoreAgentTemplateVersion({ templateId, version });
      await onRegistryChange();
      const versions = await window.eco.listAgentTemplateVersions(templateId);
      setVersionModal({ template: restored, versions });
      setRegistryMessage(`已恢复 ${restored.name} v${version}`);
    } catch (caught) {
      setVersionModal({
        ...versionModal,
        error: caught instanceof Error ? caught.message : String(caught),
      });
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
          <div className="models-section-actions">
            <button
              type="button"
              className="mcp-add-button"
              disabled={registryBusy}
              onClick={openCreateTemplate}
            >
              <Plus size={16} />
              新建模板
            </button>
            <button
              type="button"
              className="models-section-button"
              disabled={registryBusy}
              onClick={() => void importTemplates()}
            >
              <Upload size={14} />
              导入 JSON
            </button>
            <button
              type="button"
              className="models-section-button"
              disabled={registryBusy}
              onClick={() => void exportTemplates()}
            >
              <Download size={14} />
              导出 JSON
            </button>
          </div>
        </div>

        {registryMessage ? <p className="models-agent-registry-message">{registryMessage}</p> : null}

        {sortedTemplates.length === 0 ? (
          <p className="mcp-list-empty">尚未添加子代理模板</p>
        ) : (
          <ul className="models-agent-template-list">
            {sortedTemplates.map((template) => {
              const editable =
                !template.builtIn && template.source !== "built_in" && template.source !== "derived";
              const permissionChips = buildAgentTemplatePermissionChips(template);
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
                      <span>{formatModelBinding(template)}</span>
                      <span>{formatTools(template)}</span>
                      {template.mcpServers.length > 0 ? <span>{template.mcpServers.length} MCP</span> : null}
                    </div>
                    <div className="models-agent-template-permissions">
                      {permissionChips.map((chip) => (
                        <span
                          key={`${template.id}:${chip.label}`}
                          className={`models-agent-permission-chip is-${chip.tone}`}
                        >
                          {chip.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mcp-server-actions">
                    <button
                      type="button"
                      className="mcp-icon-button"
                      onClick={() => openCopyTemplate(template)}
                      aria-label={`复制 ${template.name}`}
                      title={`复制 ${template.name}`}
                      disabled={registryBusy}
                    >
                      <Copy size={18} />
                    </button>
                    <button
                      type="button"
                      className="mcp-icon-button"
                      onClick={() => void exportTemplates([template.id])}
                      aria-label={`导出 ${template.name}`}
                      title={`导出 ${template.name}`}
                      disabled={registryBusy}
                    >
                      <Download size={18} />
                    </button>
                    <button
                      type="button"
                      className="mcp-icon-button"
                      onClick={() => void openVersionHistory(template)}
                      aria-label={`查看 ${template.name} 版本历史`}
                      title={`查看 ${template.name} 版本历史`}
                      disabled={registryBusy}
                    >
                      <History size={18} />
                    </button>
                    <button
                      type="button"
                      className="mcp-icon-button"
                      onClick={() => openEditTemplate(template)}
                      aria-label={editable ? `编辑 ${template.name}` : `复制 ${template.name}`}
                      title={editable ? `编辑 ${template.name}` : `复制 ${template.name}`}
                      disabled={registryBusy}
                    >
                      <Pencil size={18} />
                    </button>
                    {editable ? (
                      <button
                        type="button"
                        className="mcp-icon-button"
                        onClick={() => void deleteTemplate(template)}
                        aria-label={`删除 ${template.name}`}
                        title={`删除 ${template.name}`}
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

      {editorForm && (
        <AgentTemplateEditorModal
          form={editorForm}
          setForm={setEditorForm}
          templates={templates}
          mcpServerConfigs={mcpServers}
          error={editorError}
          busy={registryBusy}
          editing={Boolean(editingTemplateId)}
          onClose={closeEditor}
          onSave={() => void saveTemplate()}
        />
      )}

      {versionModal && (
        <AgentTemplateVersionModal
          template={versionModal.template}
          versions={versionModal.versions}
          error={versionModal.error}
          busy={registryBusy}
          onClose={() => setVersionModal(undefined)}
          onRestore={(version) => void restoreVersion(versionModal.template.id, version)}
        />
      )}
    </>
  );
}

function AgentTemplateEditorModal({
  form,
  setForm,
  templates,
  mcpServerConfigs,
  error,
  busy,
  editing,
  onClose,
  onSave,
}: {
  form: AgentTemplateFormState;
  setForm: Dispatch<SetStateAction<AgentTemplateFormState | undefined>>;
  templates: AgentTemplate[];
  mcpServerConfigs: McpServerConfigView[];
  error?: string | undefined;
  busy?: boolean | undefined;
  editing: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const title = editing ? `编辑 ${form.name.trim() || "子代理模板"}` : "新建子代理模板";
  const capabilityOptions = useMemo(
    () =>
      buildAgentTemplateCapabilityOptions({
        templates,
        form: {
          advancedDisallowedTools: form.advancedDisallowedTools,
          mcpServers: form.mcpServers,
          mcpTools: form.mcpTools,
        },
        mcpServers: mcpServerConfigs,
      }),
    [templates, form.advancedDisallowedTools, form.mcpServers, form.mcpTools, mcpServerConfigs],
  );

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
        title="关闭"
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
            title="关闭"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <div className="settings-modal-body mcp-editor-form models-agent-template-form">
          <div className="models-agent-template-editor-layout">
            <section className="models-agent-template-editor-main">
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
            </section>

            <aside className="models-agent-template-policy-panel">
              <div className="models-agent-template-policy-head">
                <span className="models-route-profile-section-title">Claude Code 权限</span>
                <p>按功能开关配置工具权限；需要时再展开高级细调。</p>
              </div>

              <ToolCapabilityPanel
                values={form}
                disabled={busy}
                capabilityOptions={capabilityOptions}
                onChange={(patch) => patchForm(patch)}
              />
            </aside>
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

function AgentTemplateVersionModal({
  template,
  versions,
  error,
  busy,
  onClose,
  onRestore,
}: {
  template: AgentTemplate;
  versions: AgentTemplateVersionView[];
  error?: string | undefined;
  busy?: boolean | undefined;
  onClose: () => void;
  onRestore: (version: number) => void;
}) {
  return (
    <div className="settings-modal-backdrop">
      <button
        type="button"
        className="settings-modal-backdrop-close"
        onClick={onClose}
        aria-label="关闭"
        title="关闭"
        disabled={busy}
      />
      <div
        className="settings-modal settings-modal-agent-version"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-template-version-title"
      >
        <header className="settings-modal-header">
          <h2 id="agent-template-version-title" className="settings-modal-title">
            {template.name} 版本历史
          </h2>
          <button
            type="button"
            className="mcp-icon-button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>
        <div className="settings-modal-body">
          {versions.length === 0 ? (
            <p className="mcp-list-empty">暂无版本记录</p>
          ) : (
            <ul className="models-agent-version-list">
              {versions.map((entry, index) => (
                <li key={`${entry.templateId}-${entry.version}`} className="models-agent-version-row">
                  <div className="models-agent-version-main">
                    <span className="models-route-role">v{entry.version}</span>
                    {index === 0 ? <span className="models-agent-source-badge">当前</span> : null}
                    <span className="models-route-role-id">{formatVersionTime(entry.savedAt)}</span>
                    <p className="models-subagent-card-desc">{entry.template.prompt}</p>
                  </div>
                  <button
                    type="button"
                    className="models-section-button"
                    disabled={busy || index === 0}
                    onClick={() => onRestore(entry.version)}
                  >
                    <RotateCcw size={14} />
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="settings-form-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function formatModelBinding(template: AgentTemplate): string {
  if (template.modelRequirements?.capabilities.length) {
    return `模型要求：${template.modelRequirements.capabilities.join("/")}`;
  }
  return "模型由 Profile 绑定";
}

function formatTools(template: AgentTemplate): string {
  const disallowedCount = template.defaultTools.disallowed.length;
  if (disallowedCount === 0) {
    return "默认允许";
  }
  return `禁用 ${disallowedCount} 项`;
}

function formatVersionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function sourceRank(template: AgentTemplate): number {
  if (template.builtIn || template.source === "built_in") {
    return 0;
  }
  return 1;
}
