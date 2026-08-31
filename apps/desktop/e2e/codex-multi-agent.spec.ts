import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./fixtures/electron-app";

const roles = ["explore", "coder", "tester"] as const;

test("Codex multi-agent orchestration persists metrics and sqlite rows", async ({ ecoPage: page }) => {
  const mainAgentConfigId = requireEnvironmentValue("ECO_CODEX_SMOKE_MAIN_AGENT_CONFIG_ID");
  const mainPromptId = process.env.ECO_CODEX_SMOKE_MAIN_PROMPT_ID?.trim();
  const subagentOrchestrationId = requireEnvironmentValue("ECO_CODEX_SMOKE_SUBAGENT_ORCHESTRATION_ID");
  const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "240000", 10);
  const marker = process.env.ECO_SMOKE_MARKER ?? String(Date.now());
  const databasePath =
    process.env.ECO_DATABASE_PATH ??
    join(homedir(), "Library", "Application Support", "@eco", "desktop", "eco-coding.sqlite");

  const settings = await page.evaluate(async () => window.eco.getModelSettings());
  requireResource(settings.mainAgentConfigs, mainAgentConfigId, "main-agent config");
  if (mainPromptId) {
    requireResource(settings.mainAgentPrompts, mainPromptId, "main-agent prompt");
  }
  requireResource(settings.subagentOrchestrations, subagentOrchestrationId, "subagent orchestration");

  const orchestrationSelection = {
    mainAgentConfigId,
    mainPrompt: mainPromptId
      ? { mode: "custom_append" as const, promptId: mainPromptId }
      : { mode: "builtin" as const },
    subagents: { mode: "orchestration" as const, orchestrationId: subagentOrchestrationId },
  };

  const runtimeConfig = {
    orchestrationSelection,
    subagentEnabled: {
      explore: true,
      architect: false,
      coder: true,
      reviewer: false,
      tester: true,
    },
    mcpServersEnabled: { mongo: false },
    sessionMode: "agent" as const,
    bashReviewMode: "always" as const,
  };

  const prompt = [
    "Spawn exactly three orchestration agents explore, coder, tester in parallel.",
    `explore must reply exactly MULTI_EXPLORE_${marker} and call no tools.`,
    `coder must reply exactly MULTI_CODER_${marker} and call no tools.`,
    `tester must reply exactly MULTI_TESTER_${marker} and call no tools.`,
    `Wait for all three, then reply exactly MULTI_DONE_${marker}.`,
  ].join(" ");

  const started = await page.evaluate((input) => window.eco.startThread(input), {
    workspacePath: "/Users/plus/.eco/projects/home",
    prompt,
    coreKind: "codex",
    runtimeConfig,
  });

  const result = await waitForCompleteResult(page, started.thread.id, timeoutMs);
  const summary = assertCompleteResult(result, started.thread.id, marker);
  summary.sqlite = assertSqlitePersistence(databasePath, started.thread.id, summary.roles);

  console.log(JSON.stringify({ ok: true, orchestrationSelection, marker, ...summary }, null, 2));
});

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requireResource(resources: Array<{ id: string }>, id: string, label: string): void {
  if (!resources.some((resource) => resource.id === id)) {
    throw new Error(`Codex smoke ${label} was not found: ${id}`);
  }
}

type MultiAgentResult = {
  thread?: { id: string; status?: string; message?: string };
  projection?: {
    agents?: Array<{
      kind?: string;
      role?: string;
      status?: string;
      agentId?: string;
      timeline?: Array<{ eventType?: string; text?: string }>;
    }>;
  };
  sessions?: Array<{ role?: string; status?: string; durationMs?: number }>;
  metrics?: Array<{
    role?: string;
    status?: string;
    contextOccupied?: number;
    ecoCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    modelId?: string;
  }>;
  usage?: { context?: { instances?: Array<{ role?: string; occupied?: number }> } };
  ledger?: Array<{
    role?: string;
    attributionStatus?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  }>;
};

async function waitForCompleteResult(
  page: import("@playwright/test").Page,
  threadId: string,
  waitMs: number,
): Promise<MultiAgentResult> {
  const startedAt = Date.now();
  let result: MultiAgentResult | undefined;
  while (Date.now() - startedAt < waitMs) {
    result = await readResult(page, threadId);
    if (result.thread?.status === "failed" || result.thread?.status === "blocked") {
      throw new Error(`Codex multi-agent smoke failed: ${result.thread.status} ${result.thread.message}`);
    }
    if (result.thread?.status === "completed" && hasCompleteRoleData(result)) {
      return result;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `Timed out waiting for complete Codex multi-agent accounting: ${JSON.stringify(summarizePending(result))}`,
  );
}

async function readResult(page: import("@playwright/test").Page, threadId: string): Promise<MultiAgentResult> {
  return page.evaluate(async (id) => {
    const [thread, projection, sessions, metrics, usage, ledger] = await Promise.all([
      window.eco.getThread(id),
      window.eco.getThreadRunProjection(id),
      window.eco.listSubagentSessions(id),
      window.eco.listSubagentMetrics(id),
      window.eco.getThreadUsageSnapshot(id),
      window.eco.listUsageLedgerEvents(id),
    ]);
    return { thread, projection, sessions, metrics, usage, ledger };
  }, threadId);
}

function hasCompleteRoleData(result: MultiAgentResult): boolean {
  const agents = (result.projection?.agents ?? []).filter((agent) => agent.kind === "subagent");
  return roles.every(
    (role) =>
      agents.some((agent) => agent.role === role && agent.status === "stopped") &&
      (result.sessions ?? []).some((session) => session.role === role && session.status === "stopped") &&
      (result.metrics ?? []).some(
        (metric) =>
          metric.role === role &&
          metric.status === "stopped" &&
          (metric.contextOccupied ?? 0) > 0 &&
          (metric.ecoCostUsd ?? 0) > 0,
      ) &&
      (result.usage?.context?.instances ?? []).some(
        (instance) => instance.role === role && (instance.occupied ?? 0) > 0,
      ) &&
      (result.ledger ?? []).some(
        (event) =>
          event.role === role &&
          event.attributionStatus === "attributed" &&
          (event.inputTokens ?? 0) +
            (event.outputTokens ?? 0) +
            (event.cacheReadTokens ?? 0) +
            (event.cacheCreationTokens ?? 0) >
            0,
      ),
  );
}

function assertCompleteResult(result: MultiAgentResult, threadId: string, markerValue: string) {
  expect(result.thread?.status).toBe("completed");
  const agents = (result.projection?.agents ?? []).filter((agent) => agent.kind === "subagent");
  const roleSummaries = roles.map((role) => {
    const agent = agents.find((candidate) => candidate.role === role);
    const session = (result.sessions ?? []).find((candidate) => candidate.role === role);
    const metric = (result.metrics ?? []).find((candidate) => candidate.role === role);
    const context = result.usage?.context?.instances?.find((candidate) => candidate.role === role);
    const ledger = (result.ledger ?? []).filter((candidate) => candidate.role === role);
    const expectedMarker = `MULTI_${role.toUpperCase()}_${markerValue}`;
    const eventTypes = agent?.timeline?.map((event) => event.eventType) ?? [];
    const finalTexts =
      agent?.timeline?.filter((event) => event.eventType === "message.final").map((event) => event.text) ?? [];
    expect(agent?.status, `${role}: agent did not stop successfully.`).toBe("stopped");
    expect(eventTypes.includes("agent.started") && eventTypes.includes("agent.stopped"), `${role}: lifecycle events are incomplete.`).toBe(true);
    expect(finalTexts.includes(expectedMarker), `${role}: missing marker ${expectedMarker}.`).toBe(true);
    expect(session?.status, `${role}: stopped session is missing.`).toBe("stopped");
    expect(metric && (metric.contextOccupied ?? 0) > 0 && (metric.ecoCostUsd ?? 0) > 0, `${role}: non-zero metrics are missing.`).toBe(true);
    expect(context && (context.occupied ?? 0) > 0, `${role}: context instance is missing.`).toBe(true);
    expect(ledger.some((event) => event.attributionStatus === "attributed"), `${role}: attributed ledger event is missing.`).toBe(true);
    return {
      role,
      agentId: agent!.agentId!,
      status: agent!.status!,
      durationMs: session!.durationMs,
      inputTokens: metric!.inputTokens,
      outputTokens: metric!.outputTokens,
      cacheReadTokens: metric!.cacheReadTokens,
      cacheCreationTokens: metric!.cacheCreationTokens,
      contextOccupied: metric!.contextOccupied,
      contextLimit: metric!.contextLimit,
      ecoCostUsd: metric!.ecoCostUsd,
      modelId: metric!.modelId,
    };
  });
  return { threadId, status: result.thread!.status, roles: roleSummaries };
}

function assertSqlitePersistence(
  dbPath: string,
  threadId: string,
  roleSummaries: Array<{ role: string; agentId: string }>,
) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const agents = db
      .prepare(
        "SELECT agent_id, role, status FROM thread_agent_instances WHERE thread_id = ? AND kind = 'subagent'",
      )
      .all(threadId) as Array<{ agent_id: string; role: string; status: string }>;
    const sessions = db
      .prepare("SELECT agent_id, role, status FROM thread_subagent_sessions WHERE thread_id = ?")
      .all(threadId) as Array<{ agent_id: string; role: string; status: string }>;
    const metrics = db
      .prepare(
        "SELECT agent_id, role, status, context_occupied, eco_cost_usd FROM thread_subagent_metrics WHERE thread_id = ?",
      )
      .all(threadId) as Array<{
      agent_id: string;
      role: string;
      status: string;
      context_occupied: number;
      eco_cost_usd: number;
    }>;
    for (const role of roleSummaries) {
      expect(agents.some((row) => row.agent_id === role.agentId && row.status === "stopped")).toBe(true);
      expect(sessions.some((row) => row.agent_id === role.agentId && row.status === "stopped")).toBe(true);
      expect(
        metrics.some(
          (row) =>
            row.agent_id === role.agentId &&
            row.status === "stopped" &&
            row.context_occupied > 0 &&
            row.eco_cost_usd > 0,
        ),
      ).toBe(true);
    }
    return { databasePath: dbPath, agents: agents.length, sessions: sessions.length, metrics: metrics.length };
  } finally {
    db.close();
  }
}

function summarizePending(result: MultiAgentResult | undefined) {
  return {
    status: result?.thread?.status,
    agents: result?.projection?.agents
      ?.filter((agent) => agent.kind === "subagent")
      .map((agent) => ({ role: agent.role, status: agent.status })),
    sessions: result?.sessions?.map((session) => ({ role: session.role, status: session.status })),
    metrics: result?.metrics?.map((metric) => ({
      role: metric.role,
      status: metric.status,
      contextOccupied: metric.contextOccupied,
      ecoCostUsd: metric.ecoCostUsd,
    })),
  };
}
