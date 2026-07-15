import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";

const roles = ["explore", "coder", "tester"];
const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const profileId = process.env.ECO_CODEX_SMOKE_PROFILE_ID ?? "user.custom.profile";
const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "240000", 10);
const marker = process.env.ECO_SMOKE_MARKER ?? String(Date.now());
const databasePath =
  process.env.ECO_DATABASE_PATH ??
  join(homedir(), "Library", "Application Support", "@eco", "desktop", "eco-coding.sqlite");

const browser = await chromium.connectOverCDP(cdpUrl);
try {
  const page = findEcoPage(browser);
  await page.waitForLoadState("domcontentloaded");
  const profile = await page.evaluate(
    async (id) => (await window.eco.listOrchestrationProfiles()).find((candidate) => candidate.id === id),
    profileId,
  );
  if (!profile) throw new Error(`Codex smoke profile was not found: ${profileId}`);

  const runtimeConfig = {
    routeProfileId: profile.id,
    agentProfileId: profile.id,
    subagentEnabled: {
      explore: true,
      architect: false,
      coder: true,
      reviewer: false,
      tester: true,
    },
    mcpServersEnabled: { mongo: false },
    sessionMode: "agent",
    bashReviewMode: "always",
  };
  const prompt = [
    "Spawn exactly three Profile agents explore, coder, tester in parallel.",
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
  console.log(JSON.stringify({ ok: true, profileId, marker, ...summary }, null, 2));
} finally {
  await browser.close();
}

function findEcoPage(browserInstance) {
  const page = browserInstance
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith("http://127.0.0.1:"));
  if (!page) throw new Error("No Eco Electron page is available through CDP.");
  return page;
}

async function waitForCompleteResult(page, threadId, waitMs) {
  const startedAt = Date.now();
  let result;
  while (Date.now() - startedAt < waitMs) {
    result = await readResult(page, threadId);
    if (result.thread?.status === "failed" || result.thread?.status === "blocked") {
      throw new Error(`Codex multi-agent smoke failed: ${result.thread.status} ${result.thread.message}`);
    }
    if (result.thread?.status === "completed" && hasCompleteRoleData(result)) return result;
    await page.waitForTimeout(500);
  }
  throw new Error(
    `Timed out waiting for complete Codex multi-agent accounting: ${JSON.stringify(summarizePending(result))}`,
  );
}

async function readResult(page, threadId) {
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

function hasCompleteRoleData(result) {
  const agents = (result.projection?.agents ?? []).filter((agent) => agent.kind === "subagent");
  return roles.every(
    (role) =>
      agents.some((agent) => agent.role === role && agent.status === "stopped") &&
      result.sessions.some((session) => session.role === role && session.status === "stopped") &&
      result.metrics.some(
        (metric) =>
          metric.role === role &&
          metric.status === "stopped" &&
          metric.contextOccupied > 0 &&
          metric.ecoCostUsd > 0,
      ) &&
      (result.usage?.context?.instances ?? []).some(
        (instance) => instance.role === role && instance.occupied > 0,
      ) &&
      result.ledger.some(
        (event) =>
          event.role === role &&
          event.attributionStatus === "attributed" &&
          event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheCreationTokens > 0,
      ),
  );
}

function assertCompleteResult(result, threadId, markerValue) {
  if (result.thread?.status !== "completed") {
    throw new Error(`Expected completed thread, received ${result.thread?.status ?? "missing"}.`);
  }
  const agents = (result.projection?.agents ?? []).filter((agent) => agent.kind === "subagent");
  const roleSummaries = roles.map((role) => {
    const agent = agents.find((candidate) => candidate.role === role);
    const session = result.sessions.find((candidate) => candidate.role === role);
    const metric = result.metrics.find((candidate) => candidate.role === role);
    const context = result.usage?.context?.instances?.find((candidate) => candidate.role === role);
    const ledger = result.ledger.filter((candidate) => candidate.role === role);
    const expectedMarker = `MULTI_${role.toUpperCase()}_${markerValue}`;
    const eventTypes = agent?.timeline.map((event) => event.eventType) ?? [];
    const finalTexts =
      agent?.timeline.filter((event) => event.eventType === "message.final").map((event) => event.text) ?? [];
    if (agent?.status !== "stopped") throw new Error(`${role}: agent did not stop successfully.`);
    if (!eventTypes.includes("agent.started") || !eventTypes.includes("agent.stopped")) {
      throw new Error(`${role}: lifecycle events are incomplete.`);
    }
    if (!finalTexts.includes(expectedMarker)) throw new Error(`${role}: missing marker ${expectedMarker}.`);
    if (session?.status !== "stopped") throw new Error(`${role}: stopped session is missing.`);
    if (!metric || metric.contextOccupied <= 0 || metric.ecoCostUsd <= 0) {
      throw new Error(`${role}: non-zero metrics are missing.`);
    }
    if (!context || context.occupied <= 0) throw new Error(`${role}: context instance is missing.`);
    if (!ledger.some((event) => event.attributionStatus === "attributed")) {
      throw new Error(`${role}: attributed ledger event is missing.`);
    }
    return {
      role,
      agentId: agent.agentId,
      status: agent.status,
      durationMs: session.durationMs,
      inputTokens: metric.inputTokens,
      outputTokens: metric.outputTokens,
      cacheReadTokens: metric.cacheReadTokens,
      cacheCreationTokens: metric.cacheCreationTokens,
      contextOccupied: metric.contextOccupied,
      contextLimit: metric.contextLimit,
      ecoCostUsd: metric.ecoCostUsd,
      modelId: metric.modelId,
    };
  });
  return { threadId, status: result.thread.status, roles: roleSummaries };
}

function assertSqlitePersistence(path, threadId, roleSummaries) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const agents = db
      .prepare(
        "SELECT agent_id, role, status FROM thread_agent_instances WHERE thread_id = ? AND kind = 'subagent'",
      )
      .all(threadId);
    const sessions = db
      .prepare("SELECT agent_id, role, status FROM thread_subagent_sessions WHERE thread_id = ?")
      .all(threadId);
    const metrics = db
      .prepare(
        "SELECT agent_id, role, status, context_occupied, eco_cost_usd FROM thread_subagent_metrics WHERE thread_id = ?",
      )
      .all(threadId);
    for (const role of roleSummaries) {
      if (!agents.some((row) => row.agent_id === role.agentId && row.status === "stopped")) {
        throw new Error(`${role.role}: SQLite agent instance is missing or not stopped.`);
      }
      if (!sessions.some((row) => row.agent_id === role.agentId && row.status === "stopped")) {
        throw new Error(`${role.role}: SQLite subagent session is missing or not stopped.`);
      }
      if (
        !metrics.some(
          (row) =>
            row.agent_id === role.agentId &&
            row.status === "stopped" &&
            row.context_occupied > 0 &&
            row.eco_cost_usd > 0,
        )
      ) {
        throw new Error(`${role.role}: SQLite subagent metrics are incomplete.`);
      }
    }
    return { databasePath: path, agents: agents.length, sessions: sessions.length, metrics: metrics.length };
  } finally {
    db.close();
  }
}

function summarizePending(result) {
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
