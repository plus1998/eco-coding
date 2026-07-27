import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  type MainAgentConfigResource,
  type MainAgentPromptResource,
  resolveAgentTemplateCatalog,
  type SubagentOrchestrationResource,
} from "../shared/agent-orchestration";
import type { McpServerConfigView, ModelSettingsSnapshot } from "../shared/ipc";
import {
  buildMainAgentConfigFromForm,
  buildMainAgentPromptFromForm,
  buildSubagentOrchestrationFromForm,
  createBlankMainAgentConfigForm,
  createBlankMainAgentPromptForm,
  createBlankSubagentOrchestrationForm,
  createCopiedMainAgentConfigForm,
  createCopiedMainAgentPromptForm,
  createCopiedSubagentOrchestrationForm,
  mainAgentConfigToForm,
  mainAgentPromptToForm,
  subagentOrchestrationToForm,
  type AgentResourceFormState,
} from "./agent-resource-form";
import {
  AgentResourceEditorModal,
  type AgentCompositionEditorMode,
  type AgentCompositionEditorScope,
} from "./agent-resource-editor-modal";

interface AgentCompositionResourcesSectionProps {
  settings: ModelSettingsSnapshot;
  mcpServers?: McpServerConfigView[] | undefined;
  busy?: boolean | undefined;
  onRegistryChange: () => Promise<void> | void;
  onSavingChange?: ((saving: boolean) => void) | undefined;
}

interface CompositionEditorSession {
  scope: AgentCompositionEditorScope;
  mode: AgentCompositionEditorMode;
  form: AgentResourceFormState;
}

export function AgentCompositionResourcesSection({
  settings,
  mcpServers = [],
  busy = false,
  onRegistryChange,
  onSavingChange,
}: AgentCompositionResourcesSectionProps) {
  const [error, setError] = useState("");
  const [editorSession, setEditorSession] = useState<CompositionEditorSession>();

  const clearError = useCallback(() => {
    setError("");
  }, []);

  const handleAsyncOperation = useCallback(
    async (operation: () => Promise<unknown>) => {
      if (!window.eco) {
        return;
      }
      onSavingChange?.(true);
      clearError();
      try {
        await operation();
        await Promise.resolve(onRegistryChange());
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
      } finally {
        onSavingChange?.(false);
      }
    },
    [onRegistryChange, onSavingChange, clearError],
  );

  const mainAgentConfigs = settings.mainAgentConfigs ?? [];
  const mainAgentPrompts = settings.mainAgentPrompts ?? [];
  const subagentOrchestrations = settings.subagentOrchestrations ?? [];

  const templates = useMemo(
    () => resolveAgentTemplateCatalog(settings.agentTemplates),
    [settings.agentTemplates],
  );

  const formOptions = useMemo(
    () => ({
      providers: settings.providers,
      templates,
      existingIds: [
        ...mainAgentConfigs.map((entry) => entry.id),
        ...mainAgentPrompts.map((entry) => entry.id),
        ...subagentOrchestrations.map((entry) => entry.id),
      ],
      existingNames: [
        ...mainAgentConfigs.map((entry) => entry.name),
        ...mainAgentPrompts.map((entry) => entry.name),
        ...subagentOrchestrations.map((entry) => entry.name),
      ],
    }),
    [mainAgentConfigs, mainAgentPrompts, settings.providers, subagentOrchestrations, templates],
  );

  const userMainAgentConfigs = useMemo(
    () => mainAgentConfigs.filter((config) => config.source !== "built_in"),
    [mainAgentConfigs],
  );

  const userMainPrompts = useMemo(
    () => mainAgentPrompts.filter((prompt) => prompt.mode === "custom_append" && prompt.source !== "built_in"),
    [mainAgentPrompts],
  );

  const userSubagentOrchestrationResources = useMemo(
    () => subagentOrchestrations.filter((orchestration) => orchestration.source !== "built_in"),
    [subagentOrchestrations],
  );

  const openCreateEditor = useCallback(
    (scope: AgentCompositionEditorScope) => {
      clearError();
      const form =
        scope === "mainConfig"
          ? createBlankMainAgentConfigForm(formOptions)
          : scope === "prompt"
            ? createBlankMainAgentPromptForm(formOptions)
            : createBlankSubagentOrchestrationForm(formOptions);
      setEditorSession({ scope, mode: "create", form });
    },
    [clearError, formOptions],
  );

  const openEditEditor = useCallback(
    (
      scope: AgentCompositionEditorScope,
      resource: MainAgentConfigResource | MainAgentPromptResource | SubagentOrchestrationResource,
    ) => {
      clearError();
      const form =
        scope === "mainConfig"
          ? mainAgentConfigToForm(resource as MainAgentConfigResource)
          : scope === "prompt"
            ? mainAgentPromptToForm(resource as MainAgentPromptResource)
            : subagentOrchestrationToForm(resource as SubagentOrchestrationResource, templates);
      setEditorSession({ scope, mode: "edit", form });
    },
    [clearError, templates],
  );

  const saveEditorSession = useCallback(async () => {
    if (!editorSession) {
      return;
    }
    const { scope, form } = editorSession;
    await handleAsyncOperation(async () => {
      if (scope === "mainConfig") {
        const existing = mainAgentConfigs.find((entry) => entry.id === form.id);
        const config = buildMainAgentConfigFromForm(form, existing ? { existing } : {});
        await window.eco!.saveMainAgentConfig(config);
      } else if (scope === "prompt") {
        const existing = mainAgentPrompts.find((entry) => entry.id === form.id);
        const prompt = buildMainAgentPromptFromForm(form, existing ? { existing } : {});
        await window.eco!.saveMainAgentPrompt(prompt);
      } else {
        const existing = subagentOrchestrations.find((entry) => entry.id === form.id);
        const orchestration = buildSubagentOrchestrationFromForm(form, {
          ...(existing ? { existing } : {}),
          templates,
        });
        await window.eco!.saveSubagentOrchestration(orchestration);
      }
      setEditorSession(undefined);
    });
  }, [editorSession, handleAsyncOperation, mainAgentConfigs, mainAgentPrompts, subagentOrchestrations, templates]);

  const handleCopyMainAgent = useCallback(
    async (config: MainAgentConfigResource) => {
      const copied = buildMainAgentConfigFromForm(
        createCopiedMainAgentConfigForm(config, formOptions),
      );
      await handleAsyncOperation(() => window.eco!.saveMainAgentConfig(copied));
    },
    [formOptions, handleAsyncOperation],
  );

  const handleDeleteMainAgent = useCallback(
    async (config: MainAgentConfigResource) => {
      if (!window.confirm(`确定要删除主代理配置「${config.name}」吗？`)) {
        return;
      }
      await handleAsyncOperation(() => window.eco!.deleteMainAgentConfig(config.id));
    },
    [handleAsyncOperation],
  );

  const handleCopyMainPrompt = useCallback(
    async (prompt: MainAgentPromptResource) => {
      const copied = buildMainAgentPromptFromForm(
        createCopiedMainAgentPromptForm(prompt, formOptions),
      );
      await handleAsyncOperation(() => window.eco!.saveMainAgentPrompt(copied));
    },
    [formOptions, handleAsyncOperation],
  );

  const handleDeleteMainPrompt = useCallback(
    async (prompt: MainAgentPromptResource) => {
      if (!window.confirm(`确定删除提示词「${prompt.name}」吗？`)) {
        return;
      }
      await handleAsyncOperation(() => window.eco!.deleteMainAgentPrompt(prompt.id));
    },
    [handleAsyncOperation],
  );

  const handleCopySubagentOrchestration = useCallback(
    async (orchestration: SubagentOrchestrationResource) => {
      const copied = buildSubagentOrchestrationFromForm(
        createCopiedSubagentOrchestrationForm(orchestration, formOptions),
        { templates },
      );
      await handleAsyncOperation(() => window.eco!.saveSubagentOrchestration(copied));
    },
    [formOptions, handleAsyncOperation, templates],
  );

  const handleDeleteSubagentOrchestration = useCallback(
    async (orchestration: SubagentOrchestrationResource) => {
      if (!window.confirm(`确定删除子代理编排「${orchestration.name}」吗？`)) {
        return;
      }
      await handleAsyncOperation(() => window.eco!.deleteSubagentOrchestration(orchestration.id));
    },
    [handleAsyncOperation],
  );

  return (
    <div className="composition-resources-panel">
      {error && <p className="settings-form-error mcp-list-error">{error}</p>}

      <section className="mcp-list-section composition-resources-block">
        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">主代理配置</span>
          <button
            type="button"
            className="mcp-add-button"
            onClick={() => openCreateEditor("mainConfig")}
            aria-label="新增主代理配置"
            disabled={busy}
          >
            <Plus size={18} /> 新增
          </button>
        </div>
        {userMainAgentConfigs.length === 0 ? (
          <p className="mcp-list-empty">暂无主代理配置。点击「新增」配置模型、工具与 MCP 能力。</p>
        ) : (
          <ul className="mcp-server-list">
            {userMainAgentConfigs.map((config) => (
              <li key={config.id} className="mcp-server-row">
                <div className="mcp-server-summary">
                  <span className="mcp-server-name">{config.name}</span>
                  <span className="mcp-server-meta">
                    {config.domain} · {config.modelRef.providerId}:{config.modelRef.modelId}
                  </span>
                </div>
                <div className="mcp-server-actions">
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => openEditEditor("mainConfig", config)}
                    aria-label={`编辑 ${config.name}`}
                    disabled={busy}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => void handleCopyMainAgent(config)}
                    aria-label={`复制 ${config.name}`}
                    disabled={busy}
                  >
                    <Copy size={18} />
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button danger"
                    onClick={() => void handleDeleteMainAgent(config)}
                    aria-label={`删除 ${config.name}`}
                    disabled={busy}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mcp-list-section composition-resources-block">
        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">主提示词</span>
          <button
            type="button"
            className="mcp-add-button"
            onClick={() => openCreateEditor("prompt")}
            aria-label="新增提示词"
            disabled={busy}
          >
            <Plus size={18} /> 新增
          </button>
        </div>
        {userMainPrompts.length === 0 ? (
          <p className="mcp-list-empty">
            暂无自定义提示词。「跟随核心内置提示词」不是持久化资源，请在 Composer 中选择内置模式。
          </p>
        ) : (
          <ul className="mcp-server-list">
            {userMainPrompts.map((prompt) => (
              <li key={prompt.id} className="mcp-server-row">
                <div className="mcp-server-summary">
                  <span className="mcp-server-name">{prompt.name}</span>
                  <span className="mcp-server-meta">
                    {prompt.prompt.slice(0, 48)}
                    {prompt.prompt.length > 48 ? "…" : ""}
                  </span>
                </div>
                <div className="mcp-server-actions">
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => openEditEditor("prompt", prompt)}
                    aria-label={`编辑 ${prompt.name}`}
                    disabled={busy}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => void handleCopyMainPrompt(prompt)}
                    aria-label={`复制 ${prompt.name}`}
                    disabled={busy}
                  >
                    <Copy size={18} />
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button danger"
                    onClick={() => void handleDeleteMainPrompt(prompt)}
                    aria-label={`删除 ${prompt.name}`}
                    disabled={busy}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mcp-list-section composition-resources-block">
        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">子代理编排</span>
          <button
            type="button"
            className="mcp-add-button"
            onClick={() => openCreateEditor("orchestration")}
            aria-label="新增子代理编排"
            disabled={busy}
          >
            <Plus size={18} /> 新增
          </button>
        </div>
        {userSubagentOrchestrationResources.length === 0 ? (
          <p className="mcp-list-empty">暂无子代理编排。点击「新增」配置子代理 roster、模型与工具。</p>
        ) : (
          <ul className="mcp-server-list">
            {userSubagentOrchestrationResources.map((orchestration) => (
              <li key={orchestration.id} className="mcp-server-row">
                <div className="mcp-server-summary">
                  <span className="mcp-server-name">{orchestration.name}</span>
                  <span className="mcp-server-meta">
                    {orchestration.domain} · {orchestration.agents.length} 个子代理
                  </span>
                </div>
                <div className="mcp-server-actions">
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => openEditEditor("orchestration", orchestration)}
                    aria-label={`编辑 ${orchestration.name}`}
                    disabled={busy}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => void handleCopySubagentOrchestration(orchestration)}
                    aria-label={`复制 ${orchestration.name}`}
                    disabled={busy}
                  >
                    <Copy size={18} />
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button danger"
                    onClick={() => void handleDeleteSubagentOrchestration(orchestration)}
                    aria-label={`删除 ${orchestration.name}`}
                    disabled={busy}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editorSession ? (
        <AgentResourceEditorModal
          form={editorSession.form}
          setForm={(updater) =>
            setEditorSession((current) => {
              if (!current) {
                return current;
              }
              const nextForm =
                typeof updater === "function" ? updater(current.form) : updater;
              return { ...current, form: nextForm };
            })
          }
          scope={editorSession.scope}
          mode={editorSession.mode}
          providers={settings.providers}
          templates={templates}
          mcpServers={mcpServers}
          error={error || undefined}
          busy={busy}
          onClose={() => setEditorSession(undefined)}
          onSave={() => void saveEditorSession()}
        />
      ) : null}
    </div>
  );
}
