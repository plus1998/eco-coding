import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { CursorAgentInfo, CursorBuiltinSubagentType } from "../shared/ipc";

export interface CursorAgentsRosterCardBodyProps {
  agents: readonly CursorAgentInfo[];
  builtins: readonly CursorBuiltinSubagentType[];
}

function formatSourceLabel(agent: CursorAgentInfo, t: TFunction): string {
  const scope =
    agent.source === "project"
      ? t("workspaceCards.cursorAgents.sourceProject")
      : t("workspaceCards.cursorAgents.sourceUser");
  return t("workspaceCards.cursorAgents.sourceLayout", {
    scope,
    layout: agent.layout,
  });
}

export function CursorAgentsRosterCardBody({ agents, builtins }: CursorAgentsRosterCardBodyProps) {
  const { t } = useTranslation();

  return (
    <div className="composer-agent-models-card-body is-embedded">
      <div className="composer-agents-list">
        {builtins.map((type) => (
          <div key={`builtin:${type}`} className="composer-mcp-row">
            <div className="composer-mcp-row-main">
              <span className="composer-mcp-row-name">{type}</span>
              <span className="composer-mcp-row-transport">
                {t("workspaceCards.cursorAgents.builtin")}
              </span>
            </div>
            <span className="composer-mcp-row-status">{t("workspaceCards.cursorAgents.readOnly")}</span>
          </div>
        ))}
        {agents.map((agent) => {
          const meta = [
            formatSourceLabel(agent, t),
            agent.model?.trim() || undefined,
            agent.readonly ? t("workspaceCards.cursorAgents.readonlyFlag") : undefined,
            agent.isBackground ? t("workspaceCards.cursorAgents.backgroundFlag") : undefined,
          ]
            .filter(Boolean)
            .join(" · ");
          const description = agent.description.trim();
          return (
            <div key={`${agent.source}:${agent.layout}:${agent.filePath}`} className="composer-mcp-row">
              <div className="composer-mcp-row-main">
                <span className="composer-mcp-row-name" title={description || agent.filePath}>
                  {agent.name}
                </span>
                <span className="composer-mcp-row-transport" title={agent.filePath}>
                  {meta}
                </span>
                {description ? (
                  <span className="composer-mcp-row-transport workspace-cursor-agent-description">
                    {description}
                  </span>
                ) : null}
              </div>
              <span className="composer-mcp-row-status">{t("workspaceCards.cursorAgents.readOnly")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
