import { Copy, Download, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentDomain, AgentTemplate, McpServerConfigView } from "../shared/ipc";
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
import { i18n } from "./i18n";
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
  const { t } = useTranslation();
  const [editorForm, setEditorForm] = useState<AgentTemplateFormState>();
  const [editingTemplateId, setEditingTemplateId] = useState<string>();
  const [editorError, setEditorError] = useState<string>();
  const [registrySaving, setRegistrySaving] = useState(false);
  const [registryMessage, setRegistryMessage] = useState<string>();

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
      setRegistryMessage(t("subagentSettings.saved", { name: template.name }));
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
    if (!window.confirm(t("subagentSettings.confirmDelete", { name: template.name }))) {
      return;
    }
    setRegistrySaving(true);
    onSavingChange?.(true);
    try {
      await window.eco.deleteAgentTemplate(template.id);
      await onRegistryChange();
      setRegistryMessage(t("subagentSettings.deleted", { name: template.name }));
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
        setRegistryMessage(t("subagentSettings.exported", { count: result.exported }));
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
            ? t("subagentSettings.importedWithErrors", {
                count: result.imported,
                errors: result.errors.length,
              })
            : t("subagentSettings.imported", { count: result.imported }),
        );
      }
    } catch (caught) {
      setRegistryMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRegistrySaving(false);
      onSavingChange?.(false);
    }
  }

  return (
    <>
      <section className="models-agent-library">
        <div className="mcp-list-toolbar mcp-list-toolbar--actions-end">
          <div className="models-section-actions">
            <button
              type="button"
              className="mcp-add-button"
              disabled={registryBusy}
              onClick={openCreateTemplate}
            >
              <Plus size={16} />
              {t("subagentSettings.newTemplate")}
            </button>
            <button
              type="button"
              className="models-section-button"
              disabled={registryBusy}
              onClick={() => void importTemplates()}
            >
              <Upload size={14} />
              {t("subagentSettings.importJson")}
            </button>
            <button
              type="button"
              className="models-section-button"
              disabled={registryBusy}
              onClick={() => void exportTemplates()}
            >
              <Download size={14} />
              {t("subagentSettings.exportJson")}
            </button>
          </div>
        </div>

        {registryMessage ? <p className="models-agent-registry-message">{registryMessage}</p> : null}

        {sortedTemplates.length === 0 ? (
          <p className="mcp-list-empty">{t("subagentSettings.empty")}</p>
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
                      {template.mcpServers.length > 0 ? <span>{template.mcpServers.length} 个连接器</span> : null}
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
                      aria-label={t("subagentSettings.copyNamed", { name: template.name })}
                      title={t("subagentSettings.copyNamed", { name: template.name })}
                      disabled={registryBusy}
                    >
                      <Copy size={18} />
                    </button>
                    <button
                      type="button"
                      className="mcp-icon-button"
                      onClick={() => void exportTemplates([template.id])}
                      aria-label={t("subagentSettings.exportNamed", { name: template.name })}
                      title={t("subagentSettings.exportNamed", { name: template.name })}
                      disabled={registryBusy}
                    >
                      <Download size={18} />
                    </button>
                    <button
                      type="button"
                      className="mcp-icon-button"
                      onClick={() => openEditTemplate(template)}
                      aria-label={
                        editable
                          ? t("subagentSettings.editNamed", { name: template.name })
                          : t("subagentSettings.copyNamed", { name: template.name })
                      }
                      title={
                        editable
                          ? t("subagentSettings.editNamed", { name: template.name })
                          : t("subagentSettings.copyNamed", { name: template.name })
                      }
                      disabled={registryBusy}
                    >
                      <Pencil size={18} />
                    </button>
                    {editable ? (
                      <button
                        type="button"
                        className="mcp-icon-button"
                        onClick={() => void deleteTemplate(template)}
                        aria-label={t("subagentSettings.deleteNamed", { name: template.name })}
                        title={t("subagentSettings.deleteNamed", { name: template.name })}
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
  const { t } = useTranslation();
  const title = editing
    ? t("subagentSettings.editTitle", {
        name: form.name.trim() || t("subagentSettings.templateFallback"),
      })
    : t("subagentSettings.createTitle");
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
        aria-label={t("common.close")}
        title={t("common.close")}
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
            aria-label={t("common.close")}
            title={t("common.close")}
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
                  <span className="mcp-field-label">{t("subagentSettings.templateId")}</span>
                  <input
                    className="mcp-field-input"
                    value={form.id}
                    disabled={busy || editing}
                    onChange={(event) => patchForm({ id: event.target.value })}
                  />
                </label>
                <label className="mcp-field">
                  <span className="mcp-field-label">{t("subagentSettings.name")}</span>
                  <input
                    className="mcp-field-input"
                    value={form.name}
                    disabled={busy}
                    onChange={(event) => patchForm({ name: event.target.value })}
                  />
                </label>
                <label className="mcp-field">
                  <span className="mcp-field-label">{t("subagentSettings.domain")}</span>
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
                <span className="mcp-field-label">{t("subagentSettings.description")}</span>
                <input
                  className="mcp-field-input"
                  value={form.description}
                  disabled={busy}
                  onChange={(event) => patchForm({ description: event.target.value })}
                />
              </label>

              <label className="mcp-field">
                <span className="mcp-field-label">{t("subagentSettings.whenToUse")}</span>
                <input
                  className="mcp-field-input"
                  value={form.whenToUse}
                  disabled={busy}
                  onChange={(event) => patchForm({ whenToUse: event.target.value })}
                />
              </label>

              <label className="mcp-field">
                <span className="mcp-field-label">{t("subagentSettings.prompt")}</span>
                <textarea
                  className="mcp-field-input mcp-field-textarea models-agent-prompt-textarea"
                  value={form.prompt}
                  disabled={busy}
                  onChange={(event) => patchForm({ prompt: event.target.value })}
                />
              </label>

              <label className="mcp-field">
                <span className="mcp-field-label">{t("subagentSettings.outputContract")}</span>
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
                <span className="models-route-profile-section-title">
                  {t("subagentSettings.permissions")}
                </span>
                <p>{t("subagentSettings.permissionsHint")}</p>
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
            {t("common.cancel")}
          </button>
          <button type="button" className="mcp-save-button" disabled={busy} onClick={onSave}>
            {t("common.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function formatModelBinding(template: AgentTemplate): string {
  if (template.modelRequirements?.capabilities.length) {
    return i18n.t("subagentSettings.modelRequirements", {
      capabilities: template.modelRequirements.capabilities.join("/"),
    });
  }
  return i18n.t("subagentSettings.orchestrationBindsModel");
}

function formatTools(template: AgentTemplate): string {
  const disallowedCount = template.defaultTools.disallowed.length;
  if (disallowedCount === 0) {
    return i18n.t("subagentSettings.toolsAllowed");
  }
  return i18n.t("subagentSettings.toolsDisabled", { count: disallowedCount });
}

function sourceRank(template: AgentTemplate): number {
  if (template.builtIn || template.source === "built_in") {
    return 0;
  }
  return 1;
}
