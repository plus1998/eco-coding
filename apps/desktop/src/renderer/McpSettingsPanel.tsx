import {
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Plus,
  Radar,
  Settings2,
  Trash2,
} from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  mcpServerToInput,
  parseMcpArgsList,
  parseMcpEnvEntries,
  serializeMcpArgsList,
  serializeMcpEnvEntries,
} from "../shared/mcp";
import type {
  McpServerCheckResult,
  McpServerConfigInput,
  McpServerConfigView,
  McpTransport,
} from "../shared/ipc";

interface McpSettingsPanelProps {
  servers: McpServerConfigView[];
  busy?: boolean | undefined;
  onSave: (input: McpServerConfigInput) => Promise<void>;
  onDelete: (serverId: string) => Promise<void>;
  onCheck: (input: McpServerConfigInput) => Promise<McpServerCheckResult>;
}

const emptyForm: McpServerConfigInput = {
  name: "",
  transport: "stdio",
  enabled: true,
  command: "",
  argsJson: "[]",
  envJson: "{}",
  url: "",
  headersJson: "{}",
  allowedTools: "",
};

type McpPanelView = "list" | "edit";

type McpCheckState =
  | { status: "checking" }
  | { status: "ok"; result: McpServerCheckResult }
  | { status: "error"; result: McpServerCheckResult };

const editorCheckKey = "__editor__";

export function McpSettingsPanel({ servers, busy, onSave, onDelete, onCheck }: McpSettingsPanelProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<McpPanelView>("list");
  const [form, setForm] = useState<McpServerConfigInput>(emptyForm);
  const [args, setArgs] = useState<string[]>([]);
  const [envEntries, setEnvEntries] = useState<Array<{ key: string; value: string }>>([]);
  const [error, setError] = useState<string>();
  const [checkStates, setCheckStates] = useState<Record<string, McpCheckState>>({});

  useEffect(() => {
    if (view !== "edit") {
      return;
    }
    setArgs(parseMcpArgsList(form.argsJson ?? "[]"));
    setEnvEntries(parseMcpEnvEntries(form.envJson ?? "{}"));
  }, [view, form.id, form.argsJson, form.envJson]);

  function openCreate() {
    setError(undefined);
    setForm({ ...emptyForm, enabled: true });
    setView("edit");
  }

  function openEdit(server: McpServerConfigView) {
    setError(undefined);
    setForm(mcpServerToInput(server));
    setView("edit");
  }

  function closeEditor() {
    setError(undefined);
    setForm(emptyForm);
    setView("list");
  }

  async function handleToggle(server: McpServerConfigView) {
    setError(undefined);
    try {
      await onSave({ ...mcpServerToInput(server), enabled: !server.enabled });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleSave() {
    setError(undefined);
    const payload: McpServerConfigInput = {
      ...form,
      argsJson: serializeMcpArgsList(args),
      envJson: serializeMcpEnvEntries(envEntries),
    };
    try {
      await onSave(payload);
      closeEditor();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleDelete() {
    if (!form.id) {
      return;
    }
    setError(undefined);
    try {
      await onDelete(form.id);
      closeEditor();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function buildCurrentFormPayload(): McpServerConfigInput {
    return {
      ...form,
      argsJson: serializeMcpArgsList(args),
      envJson: serializeMcpEnvEntries(envEntries),
    };
  }

  async function handleCheck(key: string, input: McpServerConfigInput) {
    setError(undefined);
    setCheckStates((current) => ({ ...current, [key]: { status: "checking" } }));
    try {
      const result = await onCheck(input);
      setCheckStates((current) => ({
        ...current,
        [key]: { status: result.ok ? "ok" : "error", result },
      }));
    } catch (caught) {
      const result: McpServerCheckResult = {
        ok: false,
        serverName: input.name.trim() || t("settings.mcp.unnamed"),
        transport: input.transport,
        checkedAt: new Date().toISOString(),
        durationMs: 0,
        message: caught instanceof Error ? caught.message : String(caught),
        capabilities: [],
      };
      setCheckStates((current) => ({ ...current, [key]: { status: "error", result } }));
    }
  }

  if (view === "edit") {
    return (
      <McpServerEditor
        form={form}
        setForm={setForm}
        args={args}
        setArgs={setArgs}
        envEntries={envEntries}
        setEnvEntries={setEnvEntries}
        error={error}
        busy={busy}
        onBack={closeEditor}
        onSave={handleSave}
        onDelete={handleDelete}
        onCheck={() => void handleCheck(editorCheckKey, buildCurrentFormPayload())}
        checkState={checkStates[editorCheckKey]}
      />
    );
  }

  return (
    <>
      <header className="mcp-page-header">
        <h1>{t("settings.mcp.title")}</h1>
        <p className="mcp-page-desc">
          {t("settings.mcp.description")}{" "}
          <a
            href="https://code.claude.com/docs/en/agent-sdk/mcp"
            target="_blank"
            rel="noreferrer"
            className="mcp-learn-more"
          >
            {t("settings.mcp.learnMore")}
          </a>
        </p>
      </header>

      {error && <p className="settings-form-error mcp-list-error">{error}</p>}

      <section className="mcp-list-section settings-list-scroll-section">
        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">{t("settings.mcp.servers")}</span>
          <button type="button" className="mcp-add-button" onClick={openCreate} disabled={busy}>
            <Plus size={16} />
            {t("settings.mcp.add")}
          </button>
        </div>

        {servers.length === 0 ? (
          <p className="mcp-list-empty">{t("settings.mcp.empty")}</p>
        ) : (
          <ul className="mcp-server-list">
            {servers.map((server) => (
              <li key={server.id} className="mcp-server-row">
                <div className="mcp-server-summary">
                  <span className="mcp-server-name">{server.name}</span>
                  <span className="mcp-server-meta">
                    {server.transport}
                    <McpCheckStatus state={checkStates[server.id]} />
                  </span>
                </div>
                <div className="mcp-server-actions">
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => void handleCheck(server.id, mcpServerToInput(server))}
                    aria-label={t("settings.mcp.checkAria", { name: server.name })}
                    title={t("settings.mcp.check")}
                    disabled={busy || checkStates[server.id]?.status === "checking"}
                  >
                    {checkStates[server.id]?.status === "checking" ? (
                      <LoaderCircle size={18} className="mcp-spin" />
                    ) : (
                      <Radar size={18} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => openEdit(server)}
                    aria-label={t("settings.mcp.configureAria", { name: server.name })}
                    disabled={busy}
                  >
                    <Settings2 size={18} />
                  </button>
                  <label
                    className="mcp-toggle"
                    title={server.enabled ? t("settings.mcp.enabled") : t("settings.mcp.disabled")}
                  >
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      disabled={busy}
                      onChange={() => void handleToggle(server)}
                    />
                    <span className="mcp-toggle-track" aria-hidden />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function McpServerEditor({
  form,
  setForm,
  args,
  setArgs,
  envEntries,
  setEnvEntries,
  error,
  busy,
  onBack,
  onSave,
  onDelete,
  onCheck,
  checkState,
}: {
  form: McpServerConfigInput;
  setForm: Dispatch<SetStateAction<McpServerConfigInput>>;
  args: string[];
  setArgs: Dispatch<SetStateAction<string[]>>;
  envEntries: Array<{ key: string; value: string }>;
  setEnvEntries: Dispatch<SetStateAction<Array<{ key: string; value: string }>>>;
  error?: string | undefined;
  busy?: boolean | undefined;
  onBack: () => void;
  onSave: () => void;
  onDelete: () => void;
  onCheck: () => void;
  checkState?: McpCheckState | undefined;
}) {
  const { t } = useTranslation();
  const isEditing = Boolean(form.id);
  const titleName = form.name.trim() || t("settings.mcp.newServer");

  return (
    <>
      <header className="mcp-editor-header">
        <button type="button" className="mcp-back-button" onClick={onBack} disabled={busy}>
          <ChevronLeft size={18} />
          {t("settings.mcp.back")}
        </button>
        {isEditing && (
          <button
            type="button"
            className="mcp-uninstall-button"
            onClick={() => void onDelete()}
            disabled={busy}
          >
            <Trash2 size={16} />
            {t("settings.mcp.uninstall")}
          </button>
        )}
      </header>

      <div className="mcp-editor-title-block">
        <h1>
          {isEditing
            ? t("settings.mcp.updateTitle", { name: titleName })
            : t("settings.mcp.addTitle")}
        </h1>
        {isEditing && (
          <p className="mcp-editor-hint">{t("settings.mcp.switchHint")}</p>
        )}
      </div>

      <div className="mcp-editor-form">
        {!isEditing && (
          <label className="mcp-field">
            <span className="mcp-field-label">{t("settings.mcp.name")}</span>
            <input
              className="mcp-field-input"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="github"
            />
          </label>
        )}

        {!isEditing && (
          <label className="mcp-field">
            <span className="mcp-field-label">{t("settings.mcp.transport")}</span>
            <select
              className="mcp-field-input"
              value={form.transport}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  transport: event.target.value as McpTransport,
                }))
              }
            >
              <option value="stdio">{t("settings.mcp.localProcess")}</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
          </label>
        )}

        {form.transport === "stdio" ? (
          <>
            <label className="mcp-field">
              <span className="mcp-field-label">{t("settings.mcp.command")}</span>
              <input
                className="mcp-field-input"
                value={form.command ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))}
                placeholder="/usr/local/bin/npx"
              />
            </label>

            <div className="mcp-field">
              <span className="mcp-field-label">{t("settings.mcp.arguments")}</span>
              <ul className="mcp-kv-rows">
                {args.map((arg, index) => (
                  <li key={`arg-${index}`} className="mcp-kv-row">
                    <input
                      className="mcp-field-input"
                      value={arg}
                      onChange={(event) =>
                        setArgs((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? event.target.value : entry,
                          ),
                        )
                      }
                      placeholder={t("settings.mcp.argumentValue")}
                    />
                    <button
                      type="button"
                      className="mcp-row-delete"
                      onClick={() => setArgs((current) => current.filter((_, i) => i !== index))}
                      aria-label={t("settings.mcp.deleteArgument")}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mcp-inline-add"
                onClick={() => setArgs((current) => [...current, ""])}
              >
                <Plus size={16} />
                {t("settings.mcp.addArgument")}
              </button>
            </div>

            <div className="mcp-field">
              <span className="mcp-field-label">{t("settings.mcp.environment")}</span>
              <ul className="mcp-kv-rows">
                {envEntries.map((entry, index) => (
                  <li key={`env-${index}`} className="mcp-kv-row mcp-env-row">
                    <input
                      className="mcp-field-input mcp-env-key"
                      value={entry.key}
                      onChange={(event) =>
                        setEnvEntries((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, key: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="KEY"
                    />
                    <input
                      className="mcp-field-input"
                      value={entry.value}
                      onChange={(event) =>
                        setEnvEntries((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder="value"
                    />
                    <button
                      type="button"
                      className="mcp-row-delete"
                      onClick={() => setEnvEntries((current) => current.filter((_, i) => i !== index))}
                      aria-label={t("settings.mcp.deleteEnvironment")}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mcp-inline-add"
                onClick={() => setEnvEntries((current) => [...current, { key: "", value: "" }])}
              >
                <Plus size={16} />
                {t("settings.mcp.addEnvironment")}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="mcp-field">
              <span className="mcp-field-label">URL</span>
              <input
                className="mcp-field-input"
                value={form.url ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://api.example.com/mcp"
              />
            </label>
            <label className="mcp-field">
              <span className="mcp-field-label">{t("settings.mcp.headers")}</span>
              <textarea
                className="mcp-field-input mcp-field-textarea"
                value={form.headersJson ?? "{}"}
                onChange={(event) =>
                  setForm((current) => ({ ...current, headersJson: event.target.value }))
                }
                rows={4}
              />
            </label>
          </>
        )}

        <details className="mcp-advanced">
          <summary>{t("settings.mcp.advanced")}</summary>
          <label className="mcp-field">
            <span className="mcp-field-label">{t("settings.mcp.allowedTools")}</span>
            <input
              className="mcp-field-input"
              value={form.allowedTools ?? ""}
              onChange={(event) =>
                setForm((current) => ({ ...current, allowedTools: event.target.value }))
              }
              placeholder="mcp__github__*"
            />
          </label>
        </details>

        {error && <p className="settings-form-error">{error}</p>}

        {checkState && <McpCheckCard state={checkState} />}

        <div className="mcp-editor-actions">
          <button
            type="button"
            className="mcp-secondary-button"
            onClick={() => void onCheck()}
            disabled={busy || checkState?.status === "checking"}
          >
            {checkState?.status === "checking" ? (
              <LoaderCircle size={16} className="mcp-spin" />
            ) : (
              <Radar size={16} />
            )}
            {t("settings.mcp.check")}
          </button>
          <button type="button" className="mcp-save-button" onClick={() => void onSave()} disabled={busy}>
            {t("common.save")}
          </button>
        </div>
      </div>
    </>
  );
}

function McpCheckStatus({ state }: { state?: McpCheckState | undefined }) {
  const { t } = useTranslation();
  if (!state) {
    return null;
  }
  if (state.status === "checking") {
    return (
      <span className="mcp-check-status is-checking">
        <LoaderCircle size={13} className="mcp-spin" />
        {t("settings.mcp.checking")}
      </span>
    );
  }
  const result = state.result;
  return (
    <span
      className={result.ok ? "mcp-check-status is-ok" : "mcp-check-status is-error"}
      title={result.details || result.message}
    >
      {result.ok ? <CircleCheck size={13} /> : <CircleAlert size={13} />}
      {formatCheckSummary(result, t)}
    </span>
  );
}

function McpCheckCard({ state }: { state: McpCheckState }) {
  const { t } = useTranslation();
  if (state.status === "checking") {
    return (
      <div className="mcp-check-card is-checking">
        <LoaderCircle size={16} className="mcp-spin" />
        <span>{t("settings.mcp.handshaking")}</span>
      </div>
    );
  }
  const result = state.result;
  return (
    <div className={result.ok ? "mcp-check-card is-ok" : "mcp-check-card is-error"}>
      <div className="mcp-check-card-heading">
        {result.ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
        <span>{result.message}</span>
      </div>
      <div className="mcp-check-card-meta">
        <span>{result.transport}</span>
        <span>{result.durationMs}ms</span>
        {result.protocolVersion && (
          <span>{t("settings.mcp.protocol", { version: result.protocolVersion })}</span>
        )}
        {result.serverInfo?.name && <span>{result.serverInfo.name}</span>}
      </div>
      {result.toolNames && result.toolNames.length > 0 && (
        <p className="mcp-check-card-detail">
          {t("settings.mcp.tools", { tools: result.toolNames.join(", ") })}
        </p>
      )}
      {!result.ok && result.details && <p className="mcp-check-card-detail">{result.details}</p>}
    </div>
  );
}

function formatCheckSummary(result: McpServerCheckResult, t: TFunction): string {
  if (!result.ok) {
    return t("settings.mcp.failed", { message: result.message });
  }
  if (typeof result.toolsCount === "number") {
    return t("settings.mcp.passedWithTools", {
      count: result.toolsCount,
      duration: result.durationMs,
    });
  }
  return t("settings.mcp.passed", { duration: result.durationMs });
}
