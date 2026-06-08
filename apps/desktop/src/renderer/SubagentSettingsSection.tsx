import { Copy, Download, History, Pencil, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import type { AgentDomain, AgentTemplate, AgentTemplateVersionView } from "../shared/ipc";
import {
  AGENT_DOMAIN_OPTIONS,
  AGENT_SOURCE_OPTIONS,
  type AgentTemplateFormState,
  agentTemplateToForm,
  buildAgentTemplateFromForm,
  buildAgentTemplatePermissionChips,
  createBlankAgentTemplateForm,
  createCopiedAgentTemplateForm,
  formatAgentDomain,
  formatAgentSource,
  parseList,
} from "./agent-template-form";

const DOMAIN_ORDER: AgentDomain[] = ["coding", "research", "writing", "product", "data", "ops", "custom"];

interface SelectableOption {
  value: string;
  label: string;
  hint?: string | undefined;
}

interface ToolPresetOption {
  id: string;
  label: string;
  hint: string;
  allowedTools: string[];
  disallowedTools: string[];
}

const CLAUDE_TOOL_OPTIONS: SelectableOption[] = [
  { value: "Agent", label: "Agent", hint: "继续调用子代理" },
  { value: "Read", label: "Read", hint: "读取文件" },
  { value: "Glob", label: "Glob", hint: "查找文件" },
  { value: "Grep", label: "Grep", hint: "搜索文本" },
  { value: "LS", label: "LS", hint: "列目录" },
  { value: "Bash", label: "Bash", hint: "运行命令" },
  { value: "BashOutput", label: "BashOutput", hint: "读取后台命令输出" },
  { value: "KillBash", label: "KillBash", hint: "停止后台命令" },
  { value: "Write", label: "Write", hint: "写入新文件" },
  { value: "Edit", label: "Edit", hint: "编辑文件" },
  { value: "MultiEdit", label: "MultiEdit", hint: "批量编辑文件" },
  { value: "NotebookEdit", label: "NotebookEdit", hint: "编辑 notebook" },
  { value: "TodoWrite", label: "TodoWrite", hint: "维护任务清单" },
  { value: "WebSearch", label: "WebSearch", hint: "网页搜索" },
  { value: "WebFetch", label: "WebFetch", hint: "读取网页" },
  { value: "AskUserQuestion", label: "AskUserQuestion", hint: "向用户提问" },
];

const CLAUDE_TOOL_PRESETS: ToolPresetOption[] = [
  {
    id: "readonly",
    label: "只读探索",
    hint: "读文件和搜索代码，不写入、不运行命令。",
    allowedTools: ["Read", "Glob", "Grep", "LS"],
    disallowedTools: ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"],
  },
  {
    id: "research",
    label: "研究检索",
    hint: "读本地上下文，也允许 WebSearch/WebFetch。",
    allowedTools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
    disallowedTools: ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"],
  },
  {
    id: "coding",
    label: "代码执行",
    hint: "允许读写、编辑、命令和任务清单。",
    allowedTools: ["Read", "Glob", "Grep", "LS", "Bash", "Write", "Edit", "MultiEdit", "TodoWrite"],
    disallowedTools: [],
  },
  {
    id: "review",
    label: "评审验证",
    hint: "可读文件并运行验证命令，不允许修改文件。",
    allowedTools: ["Read", "Glob", "Grep", "LS", "Bash"],
    disallowedTools: ["Write", "Edit", "MultiEdit", "NotebookEdit"],
  },
];

interface SubagentSettingsSectionProps {
  templates: AgentTemplate[];
  registryDisabled?: boolean | undefined;
  onRegistryChange: () => Promise<void> | void;
  onSavingChange?: ((saving: boolean) => void) | undefined;
}

export function SubagentSettingsSection({
  templates,
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
                      {template.skills.length > 0 ? <span>{template.skills.length} skills</span> : null}
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
  error,
  busy,
  editing,
  onClose,
  onSave,
}: {
  form: AgentTemplateFormState;
  setForm: Dispatch<SetStateAction<AgentTemplateFormState | undefined>>;
  templates: AgentTemplate[];
  error?: string | undefined;
  busy?: boolean | undefined;
  editing: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const title = editing ? `编辑 ${form.name.trim() || "子代理模板"}` : "新建子代理模板";
  const allowedTools = parseList(form.allowedTools);
  const disallowedTools = parseList(form.disallowedTools);
  const mcpServers = parseList(form.mcpServers);
  const mcpTools = parseList(form.mcpTools);
  const skills = parseList(form.skills);
  const toolOptions = useMemo(
    () => mergeSelectableOptions(CLAUDE_TOOL_OPTIONS, [...allowedTools, ...disallowedTools]),
    [allowedTools, disallowedTools],
  );
  const mcpServerOptions = useMemo(
    () =>
      buildValueOptions([
        ...templates.flatMap((template) => template.mcpServers),
        ...templates.flatMap((template) => template.defaultTools.mcp?.allowedServers ?? []),
        ...mcpServers,
      ]),
    [templates, mcpServers],
  );
  const mcpToolOptions = useMemo(
    () =>
      buildValueOptions([
        ...templates.flatMap((template) => template.defaultTools.mcp?.allowedTools ?? []),
        ...mcpTools,
      ]),
    [templates, mcpTools],
  );
  const skillOptions = useMemo(
    () => buildValueOptions([...templates.flatMap((template) => template.skills), ...skills]),
    [templates, skills],
  );
  const activeToolPresetId = CLAUDE_TOOL_PRESETS.find(
    (preset) =>
      sameListValues(preset.allowedTools, allowedTools) &&
      sameListValues(preset.disallowedTools, disallowedTools),
  )?.id;

  function patchForm(patch: Partial<AgentTemplateFormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function applyToolPreset(preset: ToolPresetOption) {
    patchForm({
      allowedTools: formatFormList(preset.allowedTools),
      disallowedTools: formatFormList(preset.disallowedTools),
    });
  }

  function toggleAllowedTool(tool: string) {
    patchForm({
      allowedTools: formatFormList(toggleListValue(allowedTools, tool)),
      disallowedTools: formatFormList(disallowedTools.filter((value) => value !== tool)),
    });
  }

  function toggleDisallowedTool(tool: string) {
    patchForm({
      disallowedTools: formatFormList(toggleListValue(disallowedTools, tool)),
      allowedTools: formatFormList(allowedTools.filter((value) => value !== tool)),
    });
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
            </section>

            <aside className="models-agent-template-policy-panel">
              <div className="models-agent-template-policy-head">
                <span className="models-route-profile-section-title">Claude Code 权限</span>
                <p>用预设和选项配置工具、MCP 与 Skills，保存时仍写入模板权限策略。</p>
              </div>

              <div className="models-agent-template-preset-grid">
                {CLAUDE_TOOL_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={
                      activeToolPresetId === preset.id
                        ? "models-agent-template-preset active"
                        : "models-agent-template-preset"
                    }
                    disabled={busy}
                    onClick={() => applyToolPreset(preset)}
                    title={preset.hint}
                  >
                    <span>{preset.label}</span>
                    <small>{preset.hint}</small>
                  </button>
                ))}
              </div>

              <SelectableTokenGroup
                label="允许工具"
                options={toolOptions}
                selectedValues={allowedTools}
                disabled={busy}
                onToggle={toggleAllowedTool}
              />
              <SelectableTokenGroup
                label="禁用工具"
                tone="danger"
                options={toolOptions}
                selectedValues={disallowedTools}
                disabled={busy}
                onToggle={toggleDisallowedTool}
              />
              <SelectableTokenGroup
                label="MCP Servers"
                options={mcpServerOptions}
                selectedValues={mcpServers}
                disabled={busy}
                emptyText="当前模板库没有可选 MCP Server。"
                onToggle={(value) =>
                  patchForm({ mcpServers: formatFormList(toggleListValue(mcpServers, value)) })
                }
              />
              <SelectableTokenGroup
                label="MCP Tools"
                options={mcpToolOptions}
                selectedValues={mcpTools}
                disabled={busy}
                emptyText="当前模板库没有可选 MCP Tool。"
                onToggle={(value) =>
                  patchForm({ mcpTools: formatFormList(toggleListValue(mcpTools, value)) })
                }
              />
              <SelectableTokenGroup
                label="Skills"
                options={skillOptions}
                selectedValues={skills}
                disabled={busy}
                emptyText="当前模板库没有可选 Skill。"
                onToggle={(value) => patchForm({ skills: formatFormList(toggleListValue(skills, value)) })}
              />

              <div className="models-agent-template-delegation-card">
                <span>
                  <strong>允许继续委派</strong>
                  <small>允许该子代理继续调用 Agent 形成嵌套委派。默认关闭，避免不可控链式执行。</small>
                </span>
                <label className="mcp-toggle" title={form.allowDelegation ? "已启用" : "已禁用"}>
                  <input
                    type="checkbox"
                    checked={form.allowDelegation}
                    disabled={busy}
                    onChange={(event) => patchForm({ allowDelegation: event.target.checked })}
                  />
                  <span className="mcp-toggle-track" aria-hidden />
                </label>
              </div>
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

function SelectableTokenGroup({
  label,
  options,
  selectedValues,
  disabled,
  tone,
  emptyText = "暂无可选项。",
  onToggle,
}: {
  label: string;
  options: SelectableOption[];
  selectedValues: string[];
  disabled?: boolean | undefined;
  tone?: "danger" | undefined;
  emptyText?: string;
  onToggle: (value: string) => void;
}) {
  const selected = new Set(selectedValues);
  return (
    <section className="models-agent-token-group">
      <div className="models-agent-token-group-head">
        <span>{label}</span>
        <small>{selectedValues.length} 已选</small>
      </div>
      {options.length === 0 ? (
        <p className="models-agent-token-empty">{emptyText}</p>
      ) : (
        <div className="models-agent-token-options">
          {options.map((option) => {
            const active = selected.has(option.value);
            const className = [
              "models-agent-token-option",
              active ? "active" : "",
              tone === "danger" ? "danger" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={option.value}
                type="button"
                className={className}
                disabled={disabled}
                onClick={() => onToggle(option.value)}
                title={option.hint ?? option.label}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </section>
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
  const count = template.defaultTools.allowed.length;
  if (count === 0) {
    return "无默认工具";
  }
  return `${count} tools`;
}

function mergeSelectableOptions(
  baseOptions: SelectableOption[],
  values: readonly string[],
): SelectableOption[] {
  const options = [...baseOptions];
  const seen = new Set(options.map((option) => option.value));
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    options.push({ value: trimmed, label: trimmed, hint: "来自已有模板配置" });
  }
  return options;
}

function buildValueOptions(values: readonly string[]): SelectableOption[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
}

function toggleListValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function formatFormList(values: readonly string[]): string {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join(", ");
}

function sameListValues(left: readonly string[], right: readonly string[]): boolean {
  const leftValues = new Set(left);
  const rightValues = new Set(right);
  if (leftValues.size !== rightValues.size) {
    return false;
  }
  for (const value of leftValues) {
    if (!rightValues.has(value)) {
      return false;
    }
  }
  return true;
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
  if (template.source === "project") {
    return 1;
  }
  return 2;
}
