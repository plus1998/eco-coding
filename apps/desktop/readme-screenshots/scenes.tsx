import { ActivityLogView } from "../src/renderer/ActivityLogView";
import { SubagentOrchestrationRosterEditor } from "../src/renderer/SubagentOrchestrationRosterEditor";
import { UsageBreakdownPanel } from "../src/renderer/UsageBreakdownPanel";
import { DemoSettingsFrame, DemoShell } from "./DemoShell";
import {
  demoAgentDisplayNames,
  demoBillingSnapshot,
  demoProductOverviewProjection,
  demoProvider,
  demoRosterAgents,
  demoTemplates,
} from "./fixtures";

export type ReadmeDemoScene = "product-overview" | "agent-team" | "cost-cache";

export function resolveReadmeDemoScene(raw: string | null): ReadmeDemoScene {
  if (raw === "agent-team" || raw === "cost-cache" || raw === "product-overview") {
    return raw;
  }
  return "product-overview";
}

export function ReadmeDemoSceneView({ scene }: { scene: ReadmeDemoScene }) {
  if (scene === "agent-team") {
    return (
      <main className="shell readme-demo-root shell-settings-open">
        <DemoSettingsFrame title="发布核验 · Demo Team">
          <SubagentOrchestrationRosterEditor
            agents={demoRosterAgents}
            templates={demoTemplates}
            providers={[demoProvider]}
            busy={false}
            onAddAgent={() => undefined}
            onRemoveAgent={() => undefined}
            onEditAgent={() => undefined}
            onToggleEnabled={() => undefined}
          />
        </DemoSettingsFrame>
      </main>
    );
  }

  if (scene === "cost-cache") {
    return (
      <div className="readme-demo-cost-frame">
        <div className="readme-demo-cost-card">
          <UsageBreakdownPanel
            variant="full"
            billing={demoBillingSnapshot}
            agentDisplayNames={demoAgentDisplayNames}
          />
        </div>
      </div>
    );
  }

  return (
    <DemoShell activeThreadTitle="Supabase Center 配对 UI">
      <ActivityLogView
        projection={demoProductOverviewProjection}
        agentDisplayNames={demoAgentDisplayNames}
        onOpenSubagent={() => undefined}
      />
    </DemoShell>
  );
}
