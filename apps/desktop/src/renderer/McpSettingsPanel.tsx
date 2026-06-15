import { ChevronLeft, Plus, Settings2, Trash2 } from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  mcpServerToInput,
  parseMcpArgsList,
  parseMcpEnvEntries,
  serializeMcpArgsList,
  serializeMcpEnvEntries,
} from "../shared/mcp";
import type { McpServerConfigInput, McpServerConfigView, McpTransport } from "../shared/ipc";

interface McpSettingsPanelProps {
  servers: McpServerConfigView[];
  busy?: boolean | undefined;
  onSave: (input: McpServerConfigInput) => Promise<void>;
  onDelete: (serverId: string) => Promise<void>;
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

export function McpSettingsPanel({ servers, busy, onSave, onDelete }: McpSettingsPanelProps) {
  const [view, setView] = useState<McpPanelView>("list");
  const [form, setForm] = useState<McpServerConfigInput>(emptyForm);
  const [args, setArgs] = useState<string[]>([]);
  const [envEntries, setEnvEntries] = useState<Array<{ key: string; value: string }>>([]);
  const [error, setError] = useState<string>();

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
      />
    );
  }

  return (
    <>
      <header className="mcp-page-header">
        <h1>MCP 服务器</h1>
        <p className="mcp-page-desc">
          连接外部工具和数据源。
          <a
            href="https://code.claude.com/docs/en/agent-sdk/mcp"
            target="_blank"
            rel="noreferrer"
            className="mcp-learn-more"
          >
            了解更多
          </a>
        </p>
      </header>

      {error && <p className="settings-form-error mcp-list-error">{error}</p>}

      <section className="mcp-list-section">
        <div className="mcp-list-toolbar">
          <span className="mcp-list-toolbar-label">服务器</span>
          <button type="button" className="mcp-add-button" onClick={openCreate} disabled={busy}>
            <Plus size={16} />
            添加服务器
          </button>
        </div>

        {servers.length === 0 ? (
          <p className="mcp-list-empty">尚未添加 MCP 服务器</p>
        ) : (
          <ul className="mcp-server-list">
            {servers.map((server) => (
              <li key={server.id} className="mcp-server-row">
                <span className="mcp-server-name">{server.name}</span>
                <div className="mcp-server-actions">
                  <button
                    type="button"
                    className="mcp-icon-button"
                    onClick={() => openEdit(server)}
                    aria-label={`配置 ${server.name}`}
                    disabled={busy}
                  >
                    <Settings2 size={18} />
                  </button>
                  <label className="mcp-toggle" title={server.enabled ? "已启用" : "已禁用"}>
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
}) {
  const isEditing = Boolean(form.id);
  const titleName = form.name.trim() || "新服务器";

  return (
    <>
      <header className="mcp-editor-header">
        <button type="button" className="mcp-back-button" onClick={onBack} disabled={busy}>
          <ChevronLeft size={18} />
          返回
        </button>
        {isEditing && (
          <button
            type="button"
            className="mcp-uninstall-button"
            onClick={() => void onDelete()}
            disabled={busy}
          >
            <Trash2 size={16} />
            卸载
          </button>
        )}
      </header>

      <div className="mcp-editor-title-block">
        <h1>{isEditing ? `更新 ${titleName} MCP` : "添加 MCP 服务器"}</h1>
        {isEditing && (
          <p className="mcp-editor-hint">如需切换 MCP 服务器类型，请先卸载当前配置。</p>
        )}
      </div>

      <div className="mcp-editor-form">
        {!isEditing && (
          <label className="mcp-field">
            <span className="mcp-field-label">名称</span>
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
            <span className="mcp-field-label">传输类型</span>
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
              <option value="stdio">stdio（本地进程）</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
          </label>
        )}

        {form.transport === "stdio" ? (
          <>
            <label className="mcp-field">
              <span className="mcp-field-label">启动命令</span>
              <input
                className="mcp-field-input"
                value={form.command ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))}
                placeholder="/usr/local/bin/npx"
              />
            </label>

            <div className="mcp-field">
              <span className="mcp-field-label">参数</span>
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
                      placeholder="参数值"
                    />
                    <button
                      type="button"
                      className="mcp-row-delete"
                      onClick={() => setArgs((current) => current.filter((_, i) => i !== index))}
                      aria-label="删除参数"
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
                添加参数
              </button>
            </div>

            <div className="mcp-field">
              <span className="mcp-field-label">环境变量</span>
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
                      aria-label="删除环境变量"
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
                添加环境变量
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
              <span className="mcp-field-label">请求头（JSON）</span>
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
          <summary>高级选项</summary>
          <label className="mcp-field">
            <span className="mcp-field-label">允许的工具（留空则 mcp__名称__*）</span>
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

        <button type="button" className="mcp-save-button" onClick={() => void onSave()} disabled={busy}>
          保存
        </button>
      </div>
    </>
  );
}
