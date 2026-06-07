import { shortenModelId } from "@eco/runtime";
import { SUBAGENT_ROLES, type AgentRole, type SubagentEnabledSettings, type SubagentRole } from "../shared/ipc";

const ROLE_LABELS: Record<AgentRole, string> = {
  planner: "主代理",
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

function isSubagentRole(role: AgentRole): role is SubagentRole {
  return (SUBAGENT_ROLES as readonly string[]).includes(role);
}

function tagClassName(options: {
  subagent: boolean;
  enabled: boolean;
  clickable: boolean;
  locked: boolean;
  planner: boolean;
}): string {
  const parts = ["composer-agent-tag"];
  if (options.planner) {
    parts.push("is-main", "is-active");
    return parts.join(" ");
  }
  if (options.subagent) {
    parts.push(options.enabled ? "is-active" : "is-disabled");
    if (options.clickable && !options.locked) {
      parts.push("is-clickable");
    }
    if (options.locked) {
      parts.push("is-locked");
    }
  }
  return parts.join(" ");
}

interface ComposerAgentModelsProps {
  labels: Array<{ role: AgentRole; modelId?: string | undefined; title: string }>;
  subagentSettings: SubagentEnabledSettings | null;
  canEditSubagents: boolean;
  subagentSaving?: boolean | undefined;
  onToggleSubagent?: (role: SubagentRole, enabled: boolean) => void;
}

function AgentTagContent({ role, modelShort }: { role: AgentRole; modelShort: string }) {
  return (
    <>
      <span className="composer-agent-tag-role">{ROLE_LABELS[role]}</span>
      <span className="composer-agent-tag-sep" aria-hidden>
        /
      </span>
      <span className="composer-agent-tag-model">{modelShort}</span>
    </>
  );
}

export function ComposerAgentModels({
  labels,
  subagentSettings,
  canEditSubagents,
  subagentSaving,
  onToggleSubagent,
}: ComposerAgentModelsProps) {
  return (
    <div className="composer-agents-strip" aria-label="各 Agent 模型">
      {labels.map(({ role, modelId, title }) => {
        const planner = role === "planner";
        const subagent = isSubagentRole(role);
        const enabled = subagent && subagentSettings ? subagentSettings[role] : true;
        const locked = role === "coder";
        const clickable = Boolean(
          canEditSubagents && subagent && subagentSettings && onToggleSubagent && !locked,
        );
        const modelShort = modelId?.trim() ? shortenModelId(modelId.trim()) : "—";
        const className = tagClassName({ subagent, enabled, clickable, locked, planner });
        const content = <AgentTagContent role={role} modelShort={modelShort} />;
        const tip = planner
          ? title
          : locked
            ? "编码子代理不可关闭"
            : clickable
              ? enabled
                ? `${title} · 点击关闭`
                : `${title} · 点击开启`
              : title;

        if (clickable && subagent) {
          return (
            <button
              key={role}
              type="button"
              className={className}
              title={tip}
              disabled={subagentSaving}
              aria-pressed={enabled}
              onClick={() => onToggleSubagent?.(role, !enabled)}
            >
              {content}
            </button>
          );
        }

        return (
          <span key={role} className={className} title={tip}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
