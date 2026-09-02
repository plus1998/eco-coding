import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RunAttemptPhase, RunAttemptStatus } from "../main/usage-ledger";
import type { ThreadRunEvent } from "../shared/ipc";
import type { ThreadRunProjectionSnapshot } from "../shared/thread-run-projection";
import type { ConversationRoundFixture } from "./conversation-round-fixture";
import { replayConversationRound } from "./conversation-round-replay";
import {
  cellKey,
  discoverGatewayClientRoundCells,
  type GatewayClientId,
  type GatewayClientRoundCell,
  type GatewayProfileId,
  hasRpcLog,
  loadAgentEventsFromCell,
  loadGatewayClientRoundCell,
  parseFeedReplaySelector,
  RECORDING_CELL_SPECS,
} from "./gateway-client-round-fixture";
import { evaluateReplayScenarioChecklist } from "./replay-scenario-checklist";
import { replaySdkAgentEventsToFeed } from "./sdk-feed-replay";

export interface GatewayClientRoundFeedReplayResult {
  cell: GatewayClientRoundCell;
  threadId: string;
  projection: ThreadRunProjectionSnapshot;
  fullProjection: ThreadRunProjectionSnapshot;
  persistedEvents: ThreadRunEvent[];
  feedTimelineIds: string[];
  scenarioChecklistOk: boolean;
  scenarioFailed: string[];
}

function loadCodexCellFixture(cell: GatewayClientRoundCell): ConversationRoundFixture {
  const rpcLog = readFileSync(path.join(cell.dir, "rpc-log.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const summary = { marker: cell.marker, runId: cell.runId };
  const workspaceFiles = cell.workspaceFiles;
  const skillsPath = path.join(cell.dir, "skills-list.json");
  const skillsListResult = existsSync(skillsPath) ? JSON.parse(readFileSync(skillsPath, "utf8")) : undefined;
  return {
    dir: cell.dir,
    runId: cell.runId,
    marker: cell.marker,
    rpcLog,
    summary,
    meta: {},
    workspaceFiles,
    skillsListResult,
    prompt: cell.prompt,
  };
}

function threadIdForCell(cell: GatewayClientRoundCell): string {
  return `thr_gw_replay_${cell.client}_${cell.profileId}`;
}

function evaluateCellReplayScenario(
  cell: GatewayClientRoundCell,
  persistedEvents: ThreadRunEvent[],
  agents: ThreadRunProjectionSnapshot["agents"],
): { ok: boolean; failed: string[] } {
  const replayScenario = evaluateReplayScenarioChecklist({
    persistedEvents,
    agents,
    workspaceFiles: cell.workspaceFiles,
    marker: cell.marker,
    skillsListResult: cell.skillsListResult,
  });
  return replayScenario;
}

export async function replayGatewayClientRoundCellFeed(
  cell: GatewayClientRoundCell,
): Promise<GatewayClientRoundFeedReplayResult> {
  const threadId = threadIdForCell(cell);

  if (cell.client === "codex" && hasRpcLog(cell)) {
    const fixture = loadCodexCellFixture(cell);
    const codexResult = await replayConversationRound({
      fixture,
      ecoThreadId: threadId,
    });
    const { feedProjection, fullProjection } = await buildCodexProjectionFromReplay(codexResult, threadId);
    const replayScenario = evaluateCellReplayScenario(
      cell,
      codexResult.persistedEvents,
      fullProjection.agents,
    );

    return {
      cell,
      threadId,
      projection: feedProjection,
      fullProjection,
      persistedEvents: codexResult.persistedEvents,
      feedTimelineIds: codexResult.feedTimelineIds.length
        ? codexResult.feedTimelineIds
        : feedProjection.timeline.map((item) => item.id),
      scenarioChecklistOk: cell.checklistOk && replayScenario.ok,
      scenarioFailed: cell.checklistOk
        ? replayScenario.failed
        : ["recorded_checklist_failed", ...replayScenario.failed],
    };
  }

  const agentEvents = loadAgentEventsFromCell(cell);
  const sdkResult = await replaySdkAgentEventsToFeed({
    threadId,
    title: `${cell.client} · ${cell.profileId}`,
    prompt: cell.prompt,
    agentEvents,
  });
  const replayScenario = evaluateCellReplayScenario(
    cell,
    sdkResult.persistedEvents,
    sdkResult.fullProjection.agents,
  );

  return {
    cell,
    threadId,
    projection: sdkResult.projection,
    fullProjection: sdkResult.fullProjection,
    persistedEvents: sdkResult.persistedEvents,
    feedTimelineIds: sdkResult.projection.timeline.map((item) => item.id),
    scenarioChecklistOk: cell.checklistOk && replayScenario.ok,
    scenarioFailed: cell.checklistOk
      ? replayScenario.failed
      : ["recorded_checklist_failed", ...replayScenario.failed],
  };
}

async function buildCodexProjectionFromReplay(
  codexResult: Awaited<ReturnType<typeof replayConversationRound>>,
  threadId: string,
): Promise<{ feedProjection: ThreadRunProjectionSnapshot; fullProjection: ThreadRunProjectionSnapshot }> {
  const { buildThreadRunProjection } = await import("../main/thread-run-projection");
  const { trimProjectionForFeed } = await import("../main/thread-run-projection-feed");
  const fullProjection = buildThreadRunProjection({
    threadId,
    status: "idle",
    attempts: codexResult.attempts.map((attempt) => ({
      threadId,
      attemptId: attempt.attemptId,
      phase: attempt.phase as RunAttemptPhase,
      retryIndex: attempt.retryIndex,
      status: attempt.status as RunAttemptStatus,
      startedAt: attempt.startedAt,
      ...(attempt.endedAt ? { endedAt: attempt.endedAt } : {}),
    })),
    agents: codexResult.agents,
    events: codexResult.persistedEvents,
    historyComplete: true,
  });
  return {
    fullProjection,
    feedProjection: trimProjectionForFeed(fullProjection),
  };
}

export async function replayGatewayClientRoundFeedSelector(
  selector = process.env.ECO_DEMO_FEED_REPLAY,
): Promise<GatewayClientRoundFeedReplayResult[]> {
  const parsed = parseFeedReplaySelector(selector);
  const fixtureRoot = parsed.fixtureRoot;

  if (parsed.mode === "single" && parsed.client && parsed.profileId) {
    const cell = loadGatewayClientRoundCell({
      client: parsed.client,
      profileId: parsed.profileId,
      ...(fixtureRoot && { fixtureRoot }),
    });
    return [await replayGatewayClientRoundCellFeed(cell)];
  }

  const cells = discoverGatewayClientRoundCells(fixtureRoot);
  const results: GatewayClientRoundFeedReplayResult[] = [];

  const replayCell = async (client: GatewayClientId, profileId: GatewayProfileId) => {
    const cell = cells.get(cellKey(client, profileId));
    if (cell) {
      results.push(await replayGatewayClientRoundCellFeed(cell));
    }
  };

  if (parsed.mode === "client-row" && parsed.client && parsed.profileIds) {
    for (const profileId of parsed.profileIds) {
      await replayCell(parsed.client, profileId);
    }
    return results;
  }

  if (parsed.mode === "client-all" && parsed.client) {
    for (const profileId of ["packy_responses", "packy_anthropic", "longcat_chat"] as const) {
      await replayCell(parsed.client, profileId);
    }
    return results;
  }

  if (parsed.mode === "profile-column" && parsed.profileId) {
    for (const client of ["codex", "claude", "pi"] as const) {
      await replayCell(client, parsed.profileId);
    }
    return results;
  }

  for (const spec of RECORDING_CELL_SPECS) {
    await replayCell(spec.client, spec.profileId);
  }
  return results;
}

export function listDiscoveredMatrixCells(fixtureRoot?: string): GatewayClientRoundCell[] {
  const cells = discoverGatewayClientRoundCells(fixtureRoot);
  return RECORDING_CELL_SPECS.flatMap((spec) => {
    const cell = cells.get(cellKey(spec.client, spec.profileId));
    return cell ? [cell] : [];
  });
}
