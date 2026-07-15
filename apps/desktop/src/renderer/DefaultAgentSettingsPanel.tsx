import type { CoreKind } from "@eco/runtime/core-runtime";
import { Check, Code2, TerminalSquare } from "lucide-react";

interface DefaultAgentSettingsPanelProps {
  defaultCoreKind: CoreKind;
  codexAvailable: boolean;
  codexUnavailableReason?: string;
  busy?: boolean;
  onChange: (coreKind: CoreKind) => void;
}

const agentOptions = [
  {
    kind: "claude" as const,
    label: "Claude Code",
    description: "新会话默认使用 Claude Code。",
    icon: Code2,
  },
  {
    kind: "codex" as const,
    label: "Codex",
    description: "新会话默认使用 Codex。",
    icon: TerminalSquare,
  },
];

export function DefaultAgentSettingsPanel({
  defaultCoreKind,
  codexAvailable,
  codexUnavailableReason,
  busy,
  onChange,
}: DefaultAgentSettingsPanelProps) {
  return (
    <>
      <header className="settings-page-header">
        <h1>默认 Agent</h1>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">新会话 Agent</span>
            <p className="settings-section-subtitle">新建对话时默认使用的编码 Agent。</p>
          </div>
        </div>

        <div className="default-agent-options" role="radiogroup" aria-label="默认 Agent">
          {agentOptions.map((option) => {
            const Icon = option.icon;
            const selected = option.kind === defaultCoreKind;
            const unavailable = option.kind === "codex" && !codexAvailable;
            return (
              <label
                key={option.kind}
                className={selected ? "default-agent-option is-selected" : "default-agent-option"}
                title={unavailable ? codexUnavailableReason : undefined}
              >
                <input
                  type="radio"
                  name="default-agent"
                  value={option.kind}
                  checked={selected}
                  disabled={busy || unavailable}
                  onChange={() => onChange(option.kind)}
                />
                <span className="default-agent-option-icon" aria-hidden>
                  <Icon size={18} />
                </span>
                <span className="default-agent-option-body">
                  <strong>{option.label}</strong>
                  <small>{unavailable ? codexUnavailableReason || "当前不可用" : option.description}</small>
                </span>
                <span className="default-agent-option-state" aria-hidden>
                  {selected ? <Check size={15} /> : null}
                </span>
              </label>
            );
          })}
        </div>
      </section>
    </>
  );
}
