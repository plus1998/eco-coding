import { X } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { UPSTREAM_API_COMPAT_OPTIONS } from "../shared/api-compat";
import type {
  AgentTemplate,
  CandidateModelView,
  McpServerConfigView,
  ProviderConfigView,
} from "../shared/ipc";
import {
  type AgentResourceAgentFormState,
  type AgentResourceFormState,
  agentCapabilityFromAgentForm,
  agentCapabilityPatchToAgentForm,
  createResourceAgentFormFromTemplate,
  mainCapabilityFromResourceForm,
  mainCapabilityPatchToResourceForm,
} from "./agent-resource-form";
import { formatAgentDomainLabel } from "./orchestration-summary";
import { AGENT_DOMAIN_OPTIONS, buildAgentTemplateCapabilityOptions } from "./agent-template-form";
import { AgentThemeColorField } from "./agent-theme-color-field";
import { CandidateModelSpecPanel } from "./ModelSpecSummary";
import { ToolCapabilityPanel } from "./ToolCapabilityPanel";
import { SubagentOrchestrationRosterEditor } from "./SubagentOrchestrationRosterEditor";

export type AgentCompositionEditorScope = "mainConfig" | "prompt" | "orchestration";
export type AgentCompositionEditorMode = "create" | "edit" | "copy";

type AgentResourceSelectedNode = { kind: "agent"; agentKey: string };

function selectPresetDefaultProvider(
  providers: readonly ProviderConfigView[],
): ProviderConfigView | undefined {
  return (
    providers.find((provider) => provider.enabled && provider.defaultModel.trim()) ??
    providers.find((provider) => provider.defaultModel.trim())
  );
}

export function AgentResourceEditorModal({
  form,
  setForm,
  providers,
  templates,
  mcpServers,
  error,
  busy,
  mode,
  scope,
  onClose,
  onSave,
}: {
  form: AgentResourceFormState;
  setForm: Dispatch<SetStateAction<AgentResourceFormState>>;
  providers: ProviderConfigView[];
  templates: AgentTemplate[];
  mcpServers: McpServerConfigView[];
  error?: string | undefined;
  busy?: boolean | undefined;
  mode: AgentCompositionEditorMode;
  scope: AgentCompositionEditorScope;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const scopeTitle =
    scope === "mainConfig"
      ? mode === "edit"
        ? t("settings.models.editor.mainConfigEdit")
        : mode === "copy"
          ? t("settings.models.editor.mainConfigCopy")
          : t("settings.models.editor.mainConfigCreate")
      : scope === "prompt"
        ? mode === "edit"
          ? t("settings.models.editor.promptEdit")
          : mode === "copy"
            ? t("settings.models.editor.promptCopy")
            : t("settings.models.editor.promptCreate")
        : mode === "edit"
          ? t("settings.models.editor.orchestrationEdit")
          : mode === "copy"
            ? t("settings.models.editor.orchestrationCopy")
            : t("settings.models.editor.orchestrationCreate");
  const modalTitle =
    scopeTitle ||
    (mode === "edit"
      ? t("settings.models.editor.editTitle")
      : mode === "copy"
        ? t("settings.models.editor.copyTitle")
        : t("settings.models.editor.createTitle"));
  const modalBadge =
    mode === "edit"
      ? t("common.edit")
      : mode === "copy"
        ? t("settings.models.editor.copyBadge")
        : t("settings.models.editor.newBadge");
  const modalHint =
    mode === "edit"
      ? t("settings.models.editor.editHint")
      : mode === "copy"
        ? t("settings.models.editor.copyHint")
        : t("settings.models.editor.createHint");
  const saveLabel =
    mode === "edit"
      ? t("settings.models.editor.saveChanges")
      : mode === "copy"
        ? t("settings.models.editor.createCopy")
        : t("common.create");
  const [selectedNode, setSelectedNode] = useState<AgentResourceSelectedNode | null>(null);
  const selectedAgentKey = selectedNode?.agentKey;
  const selectedAgentIndex =
    selectedAgentKey !== undefined
      ? form.agents.findIndex((agent) => agent.agentKey === selectedAgentKey)
      : -1;
  const selectedAgent = selectedAgentIndex >= 0 ? form.agents[selectedAgentIndex] : undefined;
  const selectedAgentTemplate = selectedAgent
    ? templates.find((template) => template.id === selectedAgent.templateId)
    : undefined;

  useEffect(() => {
    if (selectedAgentKey !== undefined && selectedAgentIndex === -1) {
      setSelectedNode(null);
    }
  }, [selectedAgentIndex, selectedAgentKey]);

  const mainCapabilityOptions = useMemo(
    () =>
      scope === "mainConfig"
        ? buildAgentTemplateCapabilityOptions({
            templates,
            form: {
              advancedDisallowedTools: form.mainAdvancedDisallowedTools,
              mcpServers: form.mainMcpServers,
              mcpTools: form.mainMcpTools,
            },
            mcpServers,
          })
        : { tools: [], mcpServers: [], mcpTools: [] },
    [
      scope,
      templates,
      form.mainAdvancedDisallowedTools,
      form.mainMcpServers,
      form.mainMcpTools,
      mcpServers,
    ],
  );
  const { candidates: mainCandidates, loading: mainCandidatesLoading } = useCandidateModels(
    scope === "mainConfig" ? form.mainProviderId : "",
  );
  const selectedMainCandidate = mainCandidates.find(
    (candidate) => candidate.id === form.mainCandidateModelId,
  );

  function patchName(name: string) {
    patch(scope === "mainConfig" ? { name, mainName: name } : { name });
  }

  function patch(patch: Partial<AgentResourceFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function patchAgent(index: number, patch: Partial<AgentResourceAgentFormState>) {
    setForm((current) => ({
      ...current,
      agents: current.agents.map((agent, agentIndex) =>
        agentIndex === index ? { ...agent, ...patch } : agent,
      ),
    }));
  }

  function patchMainToolPolicy(toolPatch: Parameters<typeof mainCapabilityPatchToResourceForm>[0]) {
    setForm((current) => ({
      ...current,
      ...mainCapabilityPatchToResourceForm(toolPatch),
    }));
  }

  function addAgent(templateId: string): string | undefined {
    const existingAgent = form.agents.find((agent) => agent.templateId === templateId);
    if (existingAgent) {
      return existingAgent.agentKey;
    }
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) {
      return undefined;
    }
    const provider = selectPresetDefaultProvider(providers);
    const nextAgent = createResourceAgentFormFromTemplate(template, {
      ...(provider && { provider }),
      existingAgentKeys: form.agents.map((agent) => agent.agentKey),
    });
    setForm((current) => {
      if (current.agents.some((agent) => agent.templateId === template.id)) {
        return current;
      }
      return { ...current, agents: [...current.agents, nextAgent] };
    });
    return nextAgent.agentKey;
  }

  function handleAddAgentToRoster(templateId: string) {
    const agentKey = addAgent(templateId);
    if (agentKey) {
      setSelectedNode({ kind: "agent", agentKey });
    }
  }

  function removeAgent(index: number) {
    const removingAgentKey = form.agents[index]?.agentKey;
    setForm((current) => ({
      ...current,
      agents: current.agents.filter((_, agentIndex) => agentIndex !== index),
    }));
    if (selectedAgentKey !== undefined && selectedAgentKey === removingAgentKey) {
      setSelectedNode(null);
    }
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
        className="settings-modal settings-modal-agent-resource"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-resource-modal-title"
      >
        <header className="settings-modal-header">
          <div className="models-agent-resource-modal-heading">
            <div className="models-agent-resource-modal-title-row">
              <h2 id="agent-resource-modal-title" className="settings-modal-title">
                {modalTitle}
              </h2>
              <span className="models-agent-source-badge">{modalBadge}</span>
            </div>
            <p>{modalHint}</p>
          </div>
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

        <div className="settings-modal-body mcp-editor-form models-agent-resource-form">
          <section className="models-agent-resource-form-section">
            <div className="models-agent-resource-meta-grid">
              <label className="mcp-field">
                <span className="mcp-field-label">{t("settings.models.editor.resourceName")}</span>
                <input
                  className="mcp-field-input"
                  value={form.name}
                  disabled={busy}
                  onChange={(event) => patchName(event.target.value)}
                />
              </label>
              {scope !== "prompt" ? (
                <label className="mcp-field">
                  <span className="mcp-field-label">{t("settings.models.editor.domain")}</span>
                  <select
                    className="mcp-field-input"
                    value={form.preset}
                    disabled={busy}
                    onChange={(event) =>
                      patch({ preset: event.target.value as AgentResourceFormState["preset"] })
                    }
                  >
                    {AGENT_DOMAIN_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="models-agent-resource-meta-badges">
                {scope === "prompt" ? null : (
                  <span className="models-agent-domain-badge">{formatAgentDomainLabel(form.preset)}</span>
                )}
                <span className="models-agent-source-badge">
                  {form.source === "project"
                    ? t("settings.models.editor.project")
                    : t("settings.models.editor.user")}
                </span>
              </div>
            </div>
          </section>

          {scope === "prompt" ? (
            <section className="models-agent-resource-form-section composition-editor-section composition-editor-section--prompt">
              <label className="mcp-field composition-guidance-field">
                <span className="mcp-field-label">{t("settings.models.node.mainPrompt")}</span>
                <span className="composition-field-hint">{t("settings.models.editor.promptHint")}</span>
                <textarea
                  className="mcp-field-input mcp-field-textarea composition-guidance-textarea models-agent-prompt-textarea"
                  value={form.mainPrompt}
                  disabled={busy}
                  onChange={(event) => patch({ mainPrompt: event.target.value })}
                  placeholder={t("settings.models.editor.promptPlaceholder")}
                />
              </label>
            </section>
          ) : null}

          {scope === "orchestration" ? (
            <section className="models-agent-resource-form-section composition-editor-section composition-editor-section--guidance">
              <label className="mcp-field composition-guidance-field">
                <span className="mcp-field-label">{t("settings.models.editor.guidanceLabel")}</span>
                <span className="composition-field-hint">{t("settings.models.editor.guidanceHint")}</span>
                <textarea
                  className="mcp-field-input mcp-field-textarea composition-guidance-textarea"
                  value={form.guidancePrompt}
                  disabled={busy}
                  onChange={(event) => patch({ guidancePrompt: event.target.value })}
                  placeholder={t("settings.models.editor.guidancePlaceholder")}
                />
              </label>
            </section>
          ) : null}

          {scope === "mainConfig" ? (
            <section className="models-agent-resource-form-section composition-editor-section composition-editor-section--main">
              <p className="models-subagent-card-desc">{t("settings.models.node.mainDescription")}</p>
              <ResourceNodeCandidateModelFields
                providerId={form.mainProviderId}
                candidateModelId={form.mainCandidateModelId}
                thinkingEffort={form.mainThinkingEffort}
                apiCompat={form.mainApiCompat}
                providers={providers}
                candidates={mainCandidates}
                candidatesLoading={mainCandidatesLoading}
                {...(selectedMainCandidate ? { selectedCandidate: selectedMainCandidate } : {})}
                {...(busy !== undefined ? { busy } : {})}
                onProviderChange={(nextProviderId) => {
                  const provider = providers.find((entry) => entry.id === nextProviderId);
                  patch({
                    mainProviderId: nextProviderId,
                    mainModelId: provider?.defaultModel || form.mainModelId,
                    mainCandidateModelId: "",
                  });
                }}
                onCandidateChange={(candidateId, modelId) =>
                  patch({
                    mainCandidateModelId: candidateId,
                    mainModelId: modelId,
                  })
                }
                onThinkingEffortChange={(value) => patch({ mainThinkingEffort: value })}
                onApiCompatChange={(value) => patch({ mainApiCompat: value })}
              />
              <ToolCapabilityPanel
                values={mainCapabilityFromResourceForm(form)}
                {...(busy !== undefined ? { disabled: busy } : {})}
                capabilityOptions={mainCapabilityOptions}
                showPresets
                onChange={(toolPatch) => patchMainToolPolicy(toolPatch)}
              />
            </section>
          ) : null}

          {scope === "orchestration" ? (
            <section className="models-agent-resource-form-section composition-editor-section composition-editor-section--roster">
              <SubagentOrchestrationRosterEditor
                agents={form.agents}
                templates={templates}
                providers={providers}
                busy={busy}
                onAddAgent={handleAddAgentToRoster}
                onRemoveAgent={removeAgent}
                onEditAgent={(agentKey) => setSelectedNode({ kind: "agent", agentKey })}
                onToggleEnabled={(index, enabled) => patchAgent(index, { enabled })}
              />
            </section>
          ) : null}

          {error && <p className="settings-form-error">{error}</p>}
        </div>

        {selectedNode && scope === "orchestration" && selectedAgent && selectedAgentIndex >= 0 ? (
          <SubagentRosterAgentConfigModal
            agent={selectedAgent}
            agentIndex={selectedAgentIndex}
            template={selectedAgentTemplate}
            templates={templates}
            mcpServers={mcpServers}
            providers={providers}
            busy={busy}
            onClose={() => setSelectedNode(null)}
            onPatchAgent={patchAgent}
          />
        ) : null}

        <footer className="settings-modal-footer">
          <button type="button" className="settings-modal-cancel" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" className="mcp-save-button" disabled={busy} onClick={onSave}>
            {saveLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

function CandidateModelSelectField({
  value,
  candidates,
  loading,
  disabled,
  onChange,
}: {
  value: string;
  candidates: CandidateModelView[];
  loading: boolean;
  disabled?: boolean;
  onChange: (candidateId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mcp-field">
      <span className="mcp-field-label">{t("settings.models.candidateModels")}</span>
      {loading ? (
        <span className="mcp-field-hint">{t("settings.models.loading")}</span>
      ) : candidates.length === 0 ? (
        <span className="mcp-field-hint candidate-model-empty-hint">
          {t("settings.models.addCandidatesFirst")}
        </span>
      ) : (
        <select
          className="mcp-field-input"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t("settings.models.selectCandidate")}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName || c.modelId}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function useCandidateModels(providerId: string): {
  candidates: CandidateModelView[];
  loading: boolean;
} {
  const [candidates, setCandidates] = useState<CandidateModelView[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!providerId) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window
      .eco!.listCandidateModels(providerId)
      .then((result) => {
        if (!cancelled) setCandidates(result);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId]);
  return { candidates, loading };
}

function ThinkingEffortSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="mcp-field">
      <span className="mcp-field-label">{t("settings.models.thinkingEffort")}</span>
      <select className="mcp-field-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("common.default")}</option>
        <option value="off">{t("settings.models.effort.off")}</option>
        <option value="low">{t("settings.models.effort.low")}</option>
        <option value="medium">{t("settings.models.effort.medium")}</option>
        <option value="high">{t("settings.models.effort.high")}</option>
        <option value="xhigh">{t("settings.models.effort.xhigh")}</option>
        <option value="max">{t("settings.models.effort.max")}</option>
      </select>
    </label>
  );
}

function ApiCompatSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="mcp-field">
      <span className="mcp-field-label">{t("settings.models.apiCompat")}</span>
      <select className="mcp-field-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("common.default")}</option>
        {UPSTREAM_API_COMPAT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResourceNodeCandidateModelFields({
  providerId,
  candidateModelId,
  thinkingEffort,
  apiCompat,
  providers,
  candidates,
  candidatesLoading,
  selectedCandidate,
  busy,
  onProviderChange,
  onCandidateChange,
  onThinkingEffortChange,
  onApiCompatChange,
}: {
  providerId: string;
  candidateModelId: string;
  thinkingEffort: string;
  apiCompat: string;
  providers: ProviderConfigView[];
  candidates: CandidateModelView[];
  candidatesLoading: boolean;
  selectedCandidate?: CandidateModelView;
  busy?: boolean;
  onProviderChange: (providerId: string) => void;
  onCandidateChange: (candidateId: string, modelId: string) => void;
  onThinkingEffortChange: (value: string) => void;
  onApiCompatChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="profile-node-model-fields">
      <div className="models-agent-template-form-grid">
        <label className="mcp-field">
          <span className="mcp-field-label">{t("settings.models.providers")}</span>
          <select
            className="mcp-field-input"
            value={providerId}
            disabled={busy}
            onChange={(event) => onProviderChange(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <CandidateModelSelectField
          value={candidateModelId}
          candidates={candidates}
          loading={candidatesLoading}
          {...(busy !== undefined ? { disabled: busy } : {})}
          onChange={(nextCandidateId) => {
            const candidate = candidates.find((entry) => entry.id === nextCandidateId);
            onCandidateChange(nextCandidateId, candidate?.modelId ?? "");
          }}
        />
        <ThinkingEffortSelect
          value={thinkingEffort}
          {...(busy !== undefined ? { disabled: busy } : {})}
          onChange={onThinkingEffortChange}
        />
        <ApiCompatSelect
          value={apiCompat}
          {...(busy !== undefined ? { disabled: busy } : {})}
          onChange={onApiCompatChange}
        />
      </div>
      <CandidateModelSpecPanel {...(selectedCandidate ? { candidate: selectedCandidate } : {})} />
    </div>
  );
}

function SubagentRosterAgentConfigModal({
  agent,
  agentIndex,
  template,
  templates,
  mcpServers,
  providers,
  busy,
  onClose,
  onPatchAgent,
}: {
  agent: AgentResourceAgentFormState;
  agentIndex: number;
  template?: AgentTemplate | undefined;
  templates: AgentTemplate[];
  mcpServers: McpServerConfigView[];
  providers: ProviderConfigView[];
  busy?: boolean | undefined;
  onClose: () => void;
  onPatchAgent: (index: number, patch: Partial<AgentResourceAgentFormState>) => void;
}) {
  const { t } = useTranslation();
  const { candidates: nodeCandidates, loading: nodeCandidatesLoading } = useCandidateModels(agent.providerId);
  const selectedCandidate = nodeCandidates.find((candidate) => candidate.id === agent.candidateModelId);
  const nodeTitle = t("settings.models.node.agentTitle", {
    name: template?.name ?? agent.displayName ?? agent.agentKey ?? t("settings.models.node.subagent"),
  });
  const agentCapabilityOptions = useMemo(
    () =>
      buildAgentTemplateCapabilityOptions({
        templates,
        form: {
          advancedDisallowedTools: agent.advancedDisallowedTools,
          mcpServers: agent.mcpServers,
          mcpTools: agent.mcpTools,
        },
        mcpServers,
      }),
    [agent, templates, mcpServers],
  );

  function handleProviderChange(nextProviderId: string, fallbackModelId: string) {
    return {
      providerId: nextProviderId,
      modelId: fallbackModelId,
      candidateModelId: "",
    };
  }

  return (
    <div className="settings-modal-backdrop settings-modal-node-config-backdrop">
      <button
        type="button"
        className="settings-modal-backdrop-close"
        onClick={onClose}
        aria-label={t("settings.models.node.close")}
        title={t("settings.models.node.close")}
        disabled={busy}
      />
      <div
        className="settings-modal settings-modal-agent-node-config"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-resource-node-config-title"
      >
        <header className="settings-modal-header">
          <h2 id="agent-resource-node-config-title" className="settings-modal-title">
            {nodeTitle}
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

        <div className="settings-modal-body mcp-editor-form models-agent-resource-node-config-form">
          <div className="models-agent-resource-template-summary">
            <div className="models-agent-resource-title-row">
              <span className="models-route-role">{template?.name ?? agent.displayName ?? agent.agentKey}</span>
              {template ? (
                <span className="models-agent-domain-badge">{formatAgentDomainLabel(template.domain)}</span>
              ) : (
                <span className="models-agent-source-badge">{t("settings.models.editor.templateMissing")}</span>
              )}
              <span className="models-route-role-id">{agent.agentKey}</span>
            </div>
            <p className="models-subagent-card-desc">
              {template?.description ??
                t("settings.models.node.templateReference", {
                  id: agent.templateId,
                })}
            </p>
          </div>

          <ResourceNodeCandidateModelFields
            providerId={agent.providerId}
            candidateModelId={agent.candidateModelId}
            thinkingEffort={agent.thinkingEffort}
            apiCompat={agent.apiCompat}
            providers={providers}
            candidates={nodeCandidates}
            candidatesLoading={nodeCandidatesLoading}
            {...(selectedCandidate ? { selectedCandidate } : {})}
            {...(busy !== undefined ? { busy } : {})}
            onProviderChange={(nextProviderId) => {
              const provider = providers.find((entry) => entry.id === nextProviderId);
              onPatchAgent(agentIndex, {
                ...handleProviderChange(nextProviderId, provider?.defaultModel || agent.modelId || ""),
              });
            }}
            onCandidateChange={(candidateId, modelId) =>
              onPatchAgent(agentIndex, {
                candidateModelId: candidateId,
                modelId,
              })
            }
            onThinkingEffortChange={(value) => onPatchAgent(agentIndex, { thinkingEffort: value })}
            onApiCompatChange={(value) => onPatchAgent(agentIndex, { apiCompat: value })}
          />

          <AgentThemeColorField
            label={t("settings.models.node.themeColor")}
            agentKey={agent.agentKey}
            value={agent.themeColor}
            {...(busy !== undefined ? { disabled: busy } : {})}
            onChange={(value) => onPatchAgent(agentIndex, { themeColor: value })}
          />

          <ToolCapabilityPanel
            values={{ ...agentCapabilityFromAgentForm(agent), allowDelegation: false }}
            {...(busy !== undefined ? { disabled: busy } : {})}
            capabilityOptions={agentCapabilityOptions}
            showDelegation={false}
            onChange={(patch) => onPatchAgent(agentIndex, agentCapabilityPatchToAgentForm(patch))}
          />
        </div>

        <footer className="settings-modal-footer">
          <button type="button" className="settings-modal-cancel" onClick={onClose} disabled={busy}>
            {t("common.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}

